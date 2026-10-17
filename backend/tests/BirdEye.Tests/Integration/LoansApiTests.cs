using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace BirdEye.Tests.Integration;

public class LoansApiTests
{
    private static DateOnly Today => DateOnly.FromDateTime(DateTime.Today);

    /// <summary>A loan that started so that exactly <paramref name="paid"/> instalments are behind it today.</summary>
    private static object Loan(string name, decimal principal, decimal rate, int months, int paid, string currency = "RON", decimal fee = 0) => new
    {
        name, principal, currency, annualRatePercent = rate, months, earlyRepaymentFeePercent = fee,
        startDate = Today.AddMonths(-paid).AddDays(-3).ToString("yyyy-MM-dd"),
    };

    private static async Task<int> Add(HttpClient c, object loan)
    {
        var r = await c.PostAsJsonAsync("/api/loans", loan);
        Assert.Equal(HttpStatusCode.Created, r.StatusCode);
        return (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
    }

    private static async Task<JsonElement> Get(HttpClient c, string url) => await c.GetFromJsonAsync<JsonElement>(url);
    private static async Task<JsonElement> Post(HttpClient c, string url, object body)
    {
        var r = await c.PostAsJsonAsync(url, body);
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        return await r.Content.ReadFromJsonAsync<JsonElement>();
    }

    [Fact]
    public async Task Loans_are_only_for_signed_in_users()
    {
        using var app = new AppFactory();
        var anon = app.Browser();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anon.GetAsync("/api/loans")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anon.PostAsJsonAsync("/api/loans/strategy", new { extraPerMonth = 100 })).StatusCode);
    }

    [Theory]
    [InlineData("", 1000, "RON", 5, 12, 0, "name")]
    [InlineData("x", 0, "RON", 5, 12, 0, "amount borrowed")]
    [InlineData("x", 1000, "RO", 5, 12, 0, "currency")]
    [InlineData("x", 1000, "RON", -1, 12, 0, "interest rate")]
    [InlineData("x", 1000, "RON", 101, 12, 0, "interest rate")]
    [InlineData("x", 1000, "RON", 5, 0, 0, "term")]
    [InlineData("x", 1000, "RON", 5, 601, 0, "term")]
    [InlineData("x", 1000, "RON", 5, 12, 11, "fee")]
    public async Task Invalid_loans_are_refused_with_a_reason(string name, decimal principal, string currency, decimal rate, int months, decimal fee, string mention)
    {
        using var app = new AppFactory();
        var c = await app.FirstUser();
        var r = await c.PostAsJsonAsync("/api/loans", new { name, principal, currency, annualRatePercent = rate, months, earlyRepaymentFeePercent = fee, startDate = "2026-01-01" });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Contains(mention, (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString(), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task The_list_shows_where_each_loan_stands_and_totals_in_ron()
    {
        using var app = new AppFactory();
        var c = await app.FirstUser();
        await Add(c, Loan("Car", 50000, 9, 60, paid: 12));
        await Add(c, Loan("Phone", 2000, 0, 10, paid: 4, currency: "EUR"));   // the test FX turns any foreign amount into RON at 5x

        var list = await Get(c, "/api/loans");
        var loans = list.GetProperty("loans").EnumerateArray().ToList();
        Assert.Equal(2, loans.Count);

        var car = loans.Single(l => l.GetProperty("name").GetString() == "Car");
        Assert.Equal(1037.92m, car.GetProperty("payment").GetDecimal());
        Assert.Equal(12, car.GetProperty("status").GetProperty("paid").GetInt32());
        Assert.Equal(48, car.GetProperty("status").GetProperty("remaining").GetInt32());
        Assert.True(car.GetProperty("paidPercent").GetDecimal() > 15);

        var phone = loans.Single(l => l.GetProperty("name").GetString() == "Phone");
        Assert.Equal(200m, phone.GetProperty("payment").GetDecimal());          // 2000 / 10 at 0%
        Assert.Equal(1200m, phone.GetProperty("status").GetProperty("balance").GetDecimal());   // 6 of 10 left

        var totals = list.GetProperty("totals");
        var expectedBalance = car.GetProperty("status").GetProperty("balance").GetDecimal() + 1200m * 5m;
        Assert.Equal(expectedBalance, totals.GetProperty("balanceRon").GetDecimal());
        Assert.Equal(1037.92m + 200m * 5m, totals.GetProperty("monthlyPaymentRon").GetDecimal());
        Assert.True(totals.GetProperty("next").GetProperty("amountRon").GetDecimal() > 0);
    }

    [Fact]
    public async Task A_loan_can_be_edited_and_deleted()
    {
        using var app = new AppFactory();
        var c = await app.FirstUser();
        var id = await Add(c, Loan("Car", 50000, 9, 60, paid: 12));

        var edit = await c.PutAsJsonAsync($"/api/loans/{id}", Loan("Car (renamed)", 50000, 8, 60, paid: 12));
        Assert.Equal(HttpStatusCode.NoContent, edit.StatusCode);
        var loan = (await Get(c, "/api/loans")).GetProperty("loans")[0];
        Assert.Equal("Car (renamed)", loan.GetProperty("name").GetString());
        Assert.Equal(8m, loan.GetProperty("annualRatePercent").GetDecimal());

        Assert.Equal(HttpStatusCode.NoContent, (await c.DeleteAsync($"/api/loans/{id}")).StatusCode);
        Assert.Empty((await Get(c, "/api/loans")).GetProperty("loans").EnumerateArray());
        Assert.Equal(HttpStatusCode.NotFound, (await c.DeleteAsync($"/api/loans/{id}")).StatusCode);
    }

    [Fact]
    public async Task The_schedule_marks_the_paid_instalments_and_ends_at_zero()
    {
        using var app = new AppFactory();
        var c = await app.FirstUser();
        var id = await Add(c, Loan("Car", 50000, 9, 60, paid: 12));

        var rows = (await Get(c, $"/api/loans/{id}/schedule")).GetProperty("installments").EnumerateArray().ToList();
        Assert.Equal(60, rows.Count);
        Assert.Equal(12, rows.Count(r => r.GetProperty("paid").GetBoolean()));
        Assert.Equal(0m, rows[^1].GetProperty("balance").GetDecimal());
        Assert.Equal(50000m, rows.Sum(r => r.GetProperty("principal").GetDecimal()));
    }

    [Fact]
    public async Task Early_repayment_shows_both_ways_next_to_the_current_situation()
    {
        using var app = new AppFactory();
        var c = await app.FirstUser();
        var id = await Add(c, Loan("Car", 50000, 9, 60, paid: 12, fee: 1m));

        var r = await Post(c, $"/api/loans/{id}/early-repayment", new { amount = 10000, when = (string?)null });
        var current = r.GetProperty("current");
        var shorten = r.GetProperty("shorten");
        var reduce = r.GetProperty("reduce");

        Assert.Equal(48, current.GetProperty("remainingMonths").GetInt32());
        Assert.Equal(1037.92m, shorten.GetProperty("newPayment").GetDecimal());            // shortening keeps the instalment...
        Assert.True(shorten.GetProperty("monthsSaved").GetInt32() > 10);                    // ...and finishes sooner
        Assert.Equal(0, reduce.GetProperty("monthsSaved").GetInt32());                      // reducing keeps the end date...
        Assert.True(reduce.GetProperty("newPayment").GetDecimal() < 1037.92m);              // ...and lowers the instalment
        Assert.Equal(100m, shorten.GetProperty("fee").GetDecimal());                        // 1% of 10 000
        Assert.True(shorten.GetProperty("interestSaved").GetDecimal() > reduce.GetProperty("interestSaved").GetDecimal());
        Assert.Equal(shorten.GetProperty("interestSaved").GetDecimal() - 100m, shorten.GetProperty("netSaving").GetDecimal());
    }

    [Fact]
    public async Task The_chart_series_start_from_todays_balance_and_end_at_zero()
    {
        using var app = new AppFactory();
        var c = await app.FirstUser();
        var id = await Add(c, Loan("Car", 50000, 9, 60, paid: 12));

        var r = await Post(c, $"/api/loans/{id}/early-repayment", new { amount = 10000, when = (string?)null });
        var balanceNow = r.GetProperty("current").GetProperty("balance").GetDecimal();
        foreach (var series in new[] { "current", "shorten", "reduce" })
        {
            var points = r.GetProperty("chart").GetProperty(series).EnumerateArray().ToList();
            Assert.Equal(balanceNow, points[0].GetProperty("balance").GetDecimal());
            Assert.Equal(0m, points[^1].GetProperty("balance").GetDecimal());
        }
        Assert.True(r.GetProperty("chart").GetProperty("shorten").GetArrayLength() < r.GetProperty("chart").GetProperty("current").GetArrayLength());
        Assert.Equal(r.GetProperty("chart").GetProperty("current").GetArrayLength(), r.GetProperty("chart").GetProperty("reduce").GetArrayLength());
    }

    [Fact]
    public async Task Early_repayment_refuses_bad_input_and_paid_off_loans()
    {
        using var app = new AppFactory();
        var c = await app.FirstUser();
        var live = await Add(c, Loan("Car", 50000, 9, 60, paid: 12));
        var done = await Add(c, Loan("Old", 1000, 5, 6, paid: 24));
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsJsonAsync($"/api/loans/{live}/early-repayment", new { amount = 0, when = (string?)null })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsJsonAsync($"/api/loans/{live}/early-repayment", new { amount = -5, when = (string?)null })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsJsonAsync($"/api/loans/{done}/early-repayment", new { amount = 100, when = (string?)null })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await c.PostAsJsonAsync("/api/loans/9999/early-repayment", new { amount = 100, when = (string?)null })).StatusCode);
    }

    [Fact]
    public async Task An_extra_amount_every_month_shortens_the_loan()
    {
        using var app = new AppFactory();
        var c = await app.FirstUser();
        var id = await Add(c, Loan("Car", 50000, 9, 60, paid: 12));
        var r = await Post(c, $"/api/loans/{id}/extra-monthly", new { extraPerMonth = 300 });
        Assert.True(r.GetProperty("scenario").GetProperty("monthsSaved").GetInt32() > 5);
        Assert.Equal(1037.92m + 300m, r.GetProperty("scenario").GetProperty("newPayment").GetDecimal());
        Assert.True(r.GetProperty("scenario").GetProperty("interestSaved").GetDecimal() > 0);
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsJsonAsync($"/api/loans/{id}/extra-monthly", new { extraPerMonth = 0 })).StatusCode);
    }

    [Fact]
    public async Task The_strategy_comparison_orders_the_debts_the_way_each_strategy_should()
    {
        using var app = new AppFactory();
        var c = await app.FirstUser();
        await Add(c, Loan("SmallCheap", 1200, 5, 24, paid: 2));
        await Add(c, Loan("BigDear", 9000, 20, 48, paid: 2));

        var r = await Post(c, "/api/loans/strategy", new { extraPerMonth = 300 });
        Assert.Equal(2, r.GetProperty("debts").GetArrayLength());
        var snowball = r.GetProperty("snowball");
        var avalanche = r.GetProperty("avalanche");
        var minimums = r.GetProperty("minimums");

        Assert.Equal("SmallCheap", snowball.GetProperty("order")[0].GetProperty("name").GetString());
        Assert.Equal("BigDear", avalanche.GetProperty("order")[0].GetProperty("name").GetString());
        Assert.True(avalanche.GetProperty("totalInterest").GetDecimal() <= snowball.GetProperty("totalInterest").GetDecimal());
        Assert.True(snowball.GetProperty("months").GetInt32() < minimums.GetProperty("months").GetInt32());
        Assert.True(avalanche.GetProperty("interestSaved").GetDecimal() > 0);
        Assert.Equal(0m, minimums.GetProperty("monthsSaved").GetDecimal());
        Assert.Equal(0m, avalanche.GetProperty("balances").EnumerateArray().Last().GetDecimal());
    }

    [Fact]
    public async Task The_strategy_converts_foreign_loans_to_ron_and_skips_paid_off_ones()
    {
        using var app = new AppFactory();
        var c = await app.FirstUser();
        await Add(c, Loan("Euro loan", 1000, 0, 10, paid: 0, currency: "EUR"));
        await Add(c, Loan("Old", 1000, 5, 6, paid: 24));

        var r = await Post(c, "/api/loans/strategy", new { extraPerMonth = 0 });
        var debts = r.GetProperty("debts").EnumerateArray().ToList();
        Assert.Single(debts);
        Assert.Equal(5000m, debts[0].GetProperty("balance").GetDecimal());    // 1000 EUR at the test rate of 5
        Assert.Equal(500m, debts[0].GetProperty("minimumPayment").GetDecimal());
    }

    [Fact]
    public async Task With_no_open_loans_the_strategy_comparison_is_empty_not_an_error()
    {
        using var app = new AppFactory();
        var c = await app.FirstUser();
        var r = await Post(c, "/api/loans/strategy", new { extraPerMonth = 100 });
        Assert.Equal(0, r.GetProperty("debts").GetArrayLength());
        Assert.Equal(JsonValueKind.Null, r.GetProperty("snowball").ValueKind);
    }

    [Fact]
    public async Task One_user_cannot_see_or_use_anothers_loans()
    {
        using var app = new AppFactory(allowRegistration: true);
        var alice = await app.FirstUser("alice@example.com");
        var bob = await app.AnotherUser("bob@example.com");
        var id = await Add(alice, Loan("Alice car", 50000, 9, 60, paid: 12));

        Assert.Empty((await Get(bob, "/api/loans")).GetProperty("loans").EnumerateArray());
        Assert.Equal(HttpStatusCode.NotFound, (await bob.GetAsync($"/api/loans/{id}/schedule")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.PostAsJsonAsync($"/api/loans/{id}/early-repayment", new { amount = 100, when = (string?)null })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.PostAsJsonAsync($"/api/loans/{id}/extra-monthly", new { extraPerMonth = 100 })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.PutAsJsonAsync($"/api/loans/{id}", Loan("Hijacked", 1, 1, 1, paid: 0))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.DeleteAsync($"/api/loans/{id}")).StatusCode);
        Assert.Equal(0, (await Post(bob, "/api/loans/strategy", new { extraPerMonth = 100 })).GetProperty("debts").GetArrayLength());

        Assert.Equal("Alice car", (await Get(alice, "/api/loans")).GetProperty("loans")[0].GetProperty("name").GetString());
    }

    // ---- payments ----

    private static string Iso(DateOnly d) => d.ToString("yyyy-MM-dd");
    private static Task<HttpResponseMessage> Pay(HttpClient c, int id, DateOnly date, decimal amount, string? note = null) =>
        c.PostAsJsonAsync($"/api/loans/{id}/payments", new { date = Iso(date), amount, note });

    [Fact]
    public async Task Recorded_payments_drive_the_balance_and_what_is_left_to_pay()
    {
        using var app = new AppFactory();
        var c = await app.FirstUser();
        var id = await Add(c, Loan("Car", 10000, 12, 12, paid: 3));
        var before = (await Get(c, "/api/loans")).GetProperty("loans")[0].GetProperty("status");
        Assert.False(before.GetProperty("tracked").GetBoolean());

        // Recording anything switches from the assumed instalments to the real payments: only this 2 000 counts as paid now.
        Assert.Equal(HttpStatusCode.Created, (await Pay(c, id, Today.AddDays(-1), 2000, "bonus")).StatusCode);

        var list = await Get(c, $"/api/loans/{id}/payments");
        Assert.Single(list.GetProperty("payments").EnumerateArray());
        var st = (await Get(c, "/api/loans")).GetProperty("loans")[0].GetProperty("status");
        Assert.True(st.GetProperty("tracked").GetBoolean());
        Assert.Equal(2000m, st.GetProperty("paidTotal").GetDecimal());
        Assert.True(st.GetProperty("remainingTotal").GetDecimal() > 0);
    }

    [Fact]
    public async Task Recording_the_instalments_so_far_then_an_extra_payment_ends_the_loan_sooner()
    {
        using var app = new AppFactory();
        var c = await app.FirstUser();
        var id = await Add(c, Loan("Car", 10000, 12, 12, paid: 3));
        var plain = (await Get(c, "/api/loans")).GetProperty("loans")[0].GetProperty("status");

        var filled = await Post(c, $"/api/loans/{id}/payments/scheduled", new { });
        Assert.Equal(3, filled.GetProperty("recorded").GetInt32());
        var same = (await Get(c, "/api/loans")).GetProperty("loans")[0].GetProperty("status");
        Assert.True(same.GetProperty("tracked").GetBoolean());
        Assert.Equal(plain.GetProperty("balance").GetDecimal(), same.GetProperty("balance").GetDecimal());
        Assert.Equal(plain.GetProperty("endDate").GetString(), same.GetProperty("endDate").GetString());
        Assert.Equal(plain.GetProperty("paidTotal").GetDecimal(), same.GetProperty("paidTotal").GetDecimal());
        Assert.Equal(plain.GetProperty("remainingTotal").GetDecimal(), same.GetProperty("remainingTotal").GetDecimal());

        Assert.Equal(HttpStatusCode.Created, (await Pay(c, id, Today, 3000)).StatusCode);
        var after = (await Get(c, "/api/loans")).GetProperty("loans")[0].GetProperty("status");
        Assert.True(after.GetProperty("balance").GetDecimal() < same.GetProperty("balance").GetDecimal() - 2900m);
        Assert.True(string.CompareOrdinal(after.GetProperty("endDate").GetString(), same.GetProperty("endDate").GetString()) < 0);
        Assert.True(after.GetProperty("remaining").GetInt32() < same.GetProperty("remaining").GetInt32());
        Assert.True(after.GetProperty("remainingTotal").GetDecimal() < same.GetProperty("remainingTotal").GetDecimal());

        // The schedule shows what is still ahead from the real balance, and the early repayment tab starts from it as well.
        var sched = await Get(c, $"/api/loans/{id}/schedule");
        Assert.True(sched.GetProperty("tracked").GetBoolean());
        Assert.Equal(after.GetProperty("remaining").GetInt32(), sched.GetProperty("installments").GetArrayLength());
        var early = await Post(c, $"/api/loans/{id}/early-repayment", new { amount = 500, when = (string?)null });
        Assert.Equal(after.GetProperty("balance").GetDecimal(), early.GetProperty("current").GetProperty("balance").GetDecimal());
    }

    [Fact]
    public async Task The_instalments_so_far_can_only_be_recorded_once()
    {
        using var app = new AppFactory();
        var c = await app.FirstUser();
        var id = await Add(c, Loan("Car", 10000, 12, 12, paid: 3));
        await Post(c, $"/api/loans/{id}/payments/scheduled", new { });
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsync($"/api/loans/{id}/payments/scheduled", null)).StatusCode);
        Assert.Equal(3, (await Get(c, $"/api/loans/{id}/payments")).GetProperty("payments").GetArrayLength());

        var fresh = await Add(c, new { name = "New", principal = 1000, currency = "RON", annualRatePercent = 5, months = 12, earlyRepaymentFeePercent = 0, startDate = Iso(Today) });
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsync($"/api/loans/{fresh}/payments/scheduled", null)).StatusCode);   // nothing is due yet
    }

    [Fact]
    public async Task Deleting_a_payment_goes_back_to_the_previous_figures()
    {
        using var app = new AppFactory();
        var c = await app.FirstUser();
        var id = await Add(c, Loan("Car", 10000, 12, 12, paid: 3));
        await Post(c, $"/api/loans/{id}/payments/scheduled", new { });
        var balance = (await Get(c, "/api/loans")).GetProperty("loans")[0].GetProperty("status").GetProperty("balance").GetDecimal();

        var pid = (await (await Pay(c, id, Today, 1000)).Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
        Assert.True((await Get(c, "/api/loans")).GetProperty("loans")[0].GetProperty("status").GetProperty("balance").GetDecimal() < balance - 900m);
        Assert.Equal(HttpStatusCode.NoContent, (await c.DeleteAsync($"/api/loans/{id}/payments/{pid}")).StatusCode);
        Assert.Equal(balance, (await Get(c, "/api/loans")).GetProperty("loans")[0].GetProperty("status").GetProperty("balance").GetDecimal());
        Assert.Equal(HttpStatusCode.NotFound, (await c.DeleteAsync($"/api/loans/{id}/payments/{pid}")).StatusCode);
    }

    [Fact]
    public async Task Bad_payments_are_refused_with_a_reason()
    {
        using var app = new AppFactory();
        var c = await app.FirstUser();
        var id = await Add(c, Loan("Car", 10000, 12, 12, paid: 3));
        var start = (await Get(c, "/api/loans")).GetProperty("loans")[0].GetProperty("startDate").GetString()!;

        foreach (var (date, amount, mention) in new[] { (Today, 0m, "amount"), (Today, -5m, "amount"), (Today.AddDays(1), 10m, "future"), (DateOnly.Parse(start).AddDays(-1), 10m, "started") })
        {
            var r = await Pay(c, id, date, amount);
            Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
            Assert.Contains(mention, (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString(), StringComparison.OrdinalIgnoreCase);
        }
        Assert.Equal(HttpStatusCode.NotFound, (await Pay(c, id + 99, Today, 10)).StatusCode);
        Assert.Equal(0, (await Get(c, $"/api/loans/{id}/payments")).GetProperty("payments").GetArrayLength());
    }

    [Fact]
    public async Task Paying_everything_off_marks_the_loan_as_paid_and_deleting_the_loan_removes_its_payments()
    {
        using var app = new AppFactory();
        var c = await app.FirstUser();
        var id = await Add(c, Loan("Car", 10000, 12, 12, paid: 3));
        await Pay(c, id, Today, 20000);
        var st = (await Get(c, "/api/loans")).GetProperty("loans")[0].GetProperty("status");
        Assert.True(st.GetProperty("finished").GetBoolean());
        Assert.Equal(0m, st.GetProperty("balance").GetDecimal());

        Assert.Equal(HttpStatusCode.NoContent, (await c.DeleteAsync($"/api/loans/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await c.GetAsync($"/api/loans/{id}/payments")).StatusCode);
    }

    [Fact]
    public async Task One_user_cannot_see_add_or_delete_payments_on_anothers_loan()
    {
        using var app = new AppFactory(allowRegistration: true);
        var alice = await app.FirstUser("alice@example.com");
        var bob = await app.AnotherUser("bob@example.com");
        var id = await Add(alice, Loan("Alice car", 10000, 12, 12, paid: 3));
        var pid = (await (await Pay(alice, id, Today, 100)).Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();

        Assert.Equal(HttpStatusCode.NotFound, (await bob.GetAsync($"/api/loans/{id}/payments")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Pay(bob, id, Today, 100)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.PostAsync($"/api/loans/{id}/payments/scheduled", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.DeleteAsync($"/api/loans/{id}/payments/{pid}")).StatusCode);
        Assert.Equal(1, (await Get(alice, $"/api/loans/{id}/payments")).GetProperty("payments").GetArrayLength());
    }

    [Fact]
    public async Task Payments_are_only_for_signed_in_users()
    {
        using var app = new AppFactory();
        var anon = app.Browser();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anon.GetAsync("/api/loans/1/payments")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anon.PostAsJsonAsync("/api/loans/1/payments", new { date = "2026-01-01", amount = 1 })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anon.DeleteAsync("/api/loans/1/payments/1")).StatusCode);
    }
}
