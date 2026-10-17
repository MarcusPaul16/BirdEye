using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using BirdEye.Domain.Expenses;
using BirdEye.Domain.Income;
using BirdEye.Infrastructure.Persistence;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BirdEye.Tests.Integration;

public class DataIsolationTests
{
    private static async Task<JsonElement[]> List(HttpClient c, string url) => await c.GetFromJsonAsync<JsonElement[]>(url) ?? [];

    private static async Task<int> Create(HttpClient c, string url, object body)
    {
        var r = await c.PostAsJsonAsync(url, body);
        Assert.Equal(HttpStatusCode.Created, r.StatusCode);
        return (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
    }

    private record Ids(int Person, int Income, int Expense, int Transaction);

    /// <summary>One of each kind of data, created by the given user.</summary>
    private static async Task<Ids> Populate(HttpClient c, string label)
    {
        var person = await Create(c, "/api/people", new { name = $"{label} person" });
        var income = await Create(c, "/api/income", new { personId = person, name = $"{label} salary", type = "Salary", amount = 1000, currency = "RON", frequency = "Monthly" });
        var expense = await Create(c, "/api/expenses", new { name = $"{label} rent", category = "Housing", amount = 500, currency = "RON", date = "2026-01-01", recurrence = "Monthly", endDate = (string?)null });
        var tx = await Create(c, "/api/portfolio/transactions", new { symbol = "KO", type = "Buy", quantity = 2, price = 60, fees = 0, currency = "USD", date = "2026-01-02" });
        return new Ids(person, income, expense, tx);
    }

    [Fact]
    public async Task A_user_sees_only_their_own_data_in_every_list()
    {
        using var app = new AppFactory(allowRegistration: true);
        var alice = await app.FirstUser("alice@example.com");
        var bob = await app.AnotherUser("bob@example.com");
        await Populate(alice, "Alice");
        await Populate(bob, "Bob");

        foreach (var (client, own) in new[] { (alice, "Alice"), (bob, "Bob") })
        {
            Assert.Equal([$"{own} person"], (await List(client, "/api/people")).Select(p => p.GetProperty("name").GetString()));
            Assert.Equal([$"{own} salary"], (await List(client, "/api/income")).Select(p => p.GetProperty("name").GetString()));
            Assert.Equal([$"{own} rent"], (await List(client, "/api/expenses")).Select(p => p.GetProperty("name").GetString()));
            Assert.Single(await List(client, "/api/portfolio/transactions"));
        }
    }

    [Fact]
    public async Task Summaries_and_derived_views_only_count_the_users_own_data()
    {
        using var app = new AppFactory(allowRegistration: true);
        var alice = await app.FirstUser("alice@example.com");
        var bob = await app.AnotherUser("bob@example.com");
        await Populate(alice, "Alice");

        var bobExpenses = await bob.GetFromJsonAsync<JsonElement>("/api/expenses/summary?month=2026-03");
        Assert.Equal(0m, bobExpenses.GetProperty("total").GetDecimal());
        var aliceExpenses = await alice.GetFromJsonAsync<JsonElement>("/api/expenses/summary?month=2026-03");
        Assert.Equal(500m, aliceExpenses.GetProperty("total").GetDecimal());

        var bobIncome = await bob.GetFromJsonAsync<JsonElement>("/api/income/summary");
        Assert.Equal(0m, bobIncome.GetProperty("householdMonthly").GetDecimal());
        var aliceIncome = await alice.GetFromJsonAsync<JsonElement>("/api/income/summary");
        Assert.Equal(1000m, aliceIncome.GetProperty("householdMonthly").GetDecimal());

        Assert.Empty(await List(bob, "/api/portfolio/positions"));
        Assert.Single(await List(alice, "/api/portfolio/positions"));
    }

    [Fact]
    public async Task Another_users_rows_cannot_be_read_changed_or_deleted_by_id()
    {
        using var app = new AppFactory(allowRegistration: true);
        var alice = await app.FirstUser("alice@example.com");
        var bob = await app.AnotherUser("bob@example.com");
        var a = await Populate(alice, "Alice");

        Assert.Equal(HttpStatusCode.NotFound, (await bob.DeleteAsync($"/api/people/{a.Person}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.DeleteAsync($"/api/income/{a.Income}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.DeleteAsync($"/api/expenses/{a.Expense}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.DeleteAsync($"/api/portfolio/transactions/{a.Transaction}")).StatusCode);

        var edit = new { name = "Hijacked", category = "Other", amount = 1, currency = "RON", date = "2026-01-01", recurrence = "OneTime", endDate = (string?)null };
        Assert.Equal(HttpStatusCode.NotFound, (await bob.PutAsJsonAsync($"/api/expenses/{a.Expense}", edit)).StatusCode);
        var editIncome = new { personId = a.Person, name = "Hijacked", type = "Salary", amount = 1, currency = "RON", frequency = "Monthly" };
        Assert.Equal(HttpStatusCode.NotFound, (await bob.PutAsJsonAsync($"/api/income/{a.Income}", editIncome)).StatusCode);

        // Alice's data is exactly as she left it.
        Assert.Equal("Alice rent", (await List(alice, "/api/expenses")).Single().GetProperty("name").GetString());
        Assert.Equal(500m, (await List(alice, "/api/expenses")).Single().GetProperty("amount").GetDecimal());
        Assert.Equal("Alice salary", (await List(alice, "/api/income")).Single().GetProperty("name").GetString());
        Assert.Single(await List(alice, "/api/people"));
        Assert.Single(await List(alice, "/api/portfolio/transactions"));
    }

    [Fact]
    public async Task Income_cannot_be_attached_to_another_users_person()
    {
        using var app = new AppFactory(allowRegistration: true);
        var alice = await app.FirstUser("alice@example.com");
        var bob = await app.AnotherUser("bob@example.com");
        var a = await Populate(alice, "Alice");

        var r = await bob.PostAsJsonAsync("/api/income", new { personId = a.Person, name = "Sneaky", type = "Salary", amount = 1, currency = "RON", frequency = "Monthly" });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Single(await List(alice, "/api/income"));
    }

    [Fact]
    public async Task Selling_more_than_you_own_only_counts_your_own_transactions()
    {
        using var app = new AppFactory(allowRegistration: true);
        var alice = await app.FirstUser("alice@example.com");
        var bob = await app.AnotherUser("bob@example.com");
        await Populate(alice, "Alice");   // Alice holds 2 KO

        // Bob holds none, so selling one must be refused even though Alice's shares exist in the same table.
        var r = await bob.PostAsJsonAsync("/api/portfolio/transactions", new { symbol = "KO", type = "Sell", quantity = 1, price = 70, fees = 0, currency = "USD", date = "2026-02-01" });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Deleting_a_person_removes_only_that_users_income()
    {
        using var app = new AppFactory(allowRegistration: true);
        var alice = await app.FirstUser("alice@example.com");
        var bob = await app.AnotherUser("bob@example.com");
        var a = await Populate(alice, "Alice");
        await Populate(bob, "Bob");

        Assert.Equal(HttpStatusCode.NoContent, (await alice.DeleteAsync($"/api/people/{a.Person}")).StatusCode);
        Assert.Empty(await List(alice, "/api/income"));
        Assert.Single(await List(bob, "/api/income"));
    }

    // ---- data that predates accounts ----

    [Fact]
    public async Task Rows_that_predate_accounts_are_invisible_until_the_first_account_claims_them()
    {
        using var app = new AppFactory(allowRegistration: true);
        await app.SeedLegacyRows();

        // Nobody is signed in: nothing is reachable.
        Assert.Equal(HttpStatusCode.Unauthorized, (await app.Browser().GetAsync("/api/people")).StatusCode);
    }

    [Fact]
    public async Task The_first_account_receives_all_the_existing_data_and_reports_what_it_got()
    {
        using var app = new AppFactory(allowRegistration: true);
        await app.SeedLegacyRows();

        var browser = app.Browser();
        var response = await app.Register(browser, "paul@example.com", setupCode: app.SetupCode);
        var claimed = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("claimed");
        Assert.Equal(1, claimed.GetProperty("people").GetInt32());
        Assert.Equal(1, claimed.GetProperty("incomeSources").GetInt32());
        Assert.Equal(1, claimed.GetProperty("transactions").GetInt32());
        Assert.Equal(1, claimed.GetProperty("expenses").GetInt32());

        Assert.Equal("Legacy Paul", (await List(browser, "/api/people")).Single().GetProperty("name").GetString());
        Assert.Equal("Legacy salary", (await List(browser, "/api/income")).Single().GetProperty("name").GetString());
        Assert.Equal("Legacy rent", (await List(browser, "/api/expenses")).Single().GetProperty("name").GetString());
        Assert.Equal("KO", (await List(browser, "/api/portfolio/transactions")).Single().GetProperty("symbol").GetString());
    }

    [Fact]
    public async Task A_later_account_gets_none_of_the_old_data_and_claims_nothing()
    {
        using var app = new AppFactory(allowRegistration: true);
        await app.SeedLegacyRows();
        var owner = await app.FirstUser("paul@example.com");

        var secondResponse = await app.Register(app.Browser(), "second@example.com");
        var second = app.Browser();
        (await second.PostAsJsonAsync("/api/auth/login", new { email = "second@example.com", password = "correct horse battery", rememberMe = false })).EnsureSuccessStatusCode();
        Assert.Equal(JsonValueKind.Null, (await secondResponse.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("claimed").ValueKind);

        Assert.Empty(await List(second, "/api/people"));
        Assert.Empty(await List(second, "/api/expenses"));
        Assert.Single(await List(owner, "/api/people"));   // still the first account's
    }
}

public class OwnershipStampingTests : IDisposable
{
    private readonly SqliteConnection _connection = new("DataSource=:memory:");
    private readonly Signed _user = new();

    private sealed class Signed : ICurrentUser { public string? Id { get; set; } }

    public OwnershipStampingTests()
    {
        _connection.Open();
        using var db = Context();
        db.Database.EnsureCreated();
    }

    private BirdEyeDbContext Context() => new(new DbContextOptionsBuilder<BirdEyeDbContext>().UseSqlite(_connection).Options, _user);

    public void Dispose() => _connection.Dispose();

    [Fact]
    public async Task New_rows_are_stamped_with_the_signed_in_user()
    {
        _user.Id = "user-1";
        await using var db = Context();
        db.Expenses.Add(new Expense { Name = "x", Amount = 1, Date = new DateOnly(2026, 1, 1) });
        db.People.Add(new Person { Name = "p" });
        await db.SaveChangesAsync();
        Assert.All(await db.Expenses.ToListAsync(), e => Assert.Equal("user-1", e.UserId));
        Assert.All(await db.People.ToListAsync(), p => Assert.Equal("user-1", p.UserId));
    }

    [Fact]
    public async Task A_client_supplied_owner_is_overwritten_with_the_signed_in_user()
    {
        _user.Id = "user-1";
        await using var db = Context();
        db.Expenses.Add(new Expense { Name = "x", Amount = 1, Date = new DateOnly(2026, 1, 1), UserId = "someone-else" });
        await db.SaveChangesAsync();
        Assert.Equal("user-1", (await db.Expenses.SingleAsync()).UserId);
    }

    [Fact]
    public async Task Nothing_can_be_saved_with_nobody_signed_in()
    {
        _user.Id = null;
        await using var db = Context();
        db.Expenses.Add(new Expense { Name = "x", Amount = 1, Date = new DateOnly(2026, 1, 1) });
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task The_owner_of_an_existing_row_cannot_be_changed()
    {
        _user.Id = "user-1";
        await using var db = Context();
        db.Expenses.Add(new Expense { Name = "x", Amount = 1, Date = new DateOnly(2026, 1, 1) });
        await db.SaveChangesAsync();

        var expense = await db.Expenses.SingleAsync();
        expense.UserId = "user-2";
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task Queries_with_nobody_signed_in_return_nothing()
    {
        _user.Id = "user-1";
        await using (var db = Context())
        {
            db.Expenses.Add(new Expense { Name = "x", Amount = 1, Date = new DateOnly(2026, 1, 1) });
            await db.SaveChangesAsync();
        }
        _user.Id = null;
        await using var anonymous = Context();
        Assert.Empty(await anonymous.Expenses.ToListAsync());
        Assert.Single(await anonymous.Expenses.IgnoreQueryFilters().ToListAsync()); // the row exists; the filter is what hides it
    }
}
