using BirdEye.Domain.Loans;

namespace BirdEye.Tests;

public class LoanMathTests
{
    private static DateOnly D(string s) => DateOnly.Parse(s);

    private static Loan L(decimal principal, decimal rate, int months, string start, decimal fee = 0) =>
        new() { Name = "x", Principal = principal, AnnualRatePercent = rate, Months = months, StartDate = D(start), EarlyRepaymentFeePercent = fee };

    // Reference values come from the closed-form annuity formula, computed outside this code base.
    [Theory]
    [InlineData(10000, 12, 12, 888.49)]
    [InlineData(200000, 7.5, 300, 1477.98)]
    [InlineData(50000, 9, 60, 1037.92)]
    public void Payment_matches_the_annuity_formula(decimal principal, decimal rate, int months, decimal expected) =>
        Assert.Equal(expected, LoanMath.Payment(principal, rate, months));

    [Fact]
    public void A_zero_rate_loan_is_just_the_principal_divided_by_the_months()
    {
        Assert.Equal(1000m, LoanMath.Payment(12000, 0, 12));
        var schedule = LoanMath.Schedule(12000, 0, 12, D("2026-01-15"));
        Assert.All(schedule, i => Assert.Equal(0m, i.Interest));
        Assert.Equal(12000m, schedule.Sum(i => i.Payment));
    }

    [Fact]
    public void The_schedule_has_one_instalment_per_month_and_ends_at_exactly_zero()
    {
        foreach (var (p, r, n) in new[] { (10000m, 12m, 12), (200000m, 7.5m, 300), (50000m, 9m, 60), (1234.56m, 3.333m, 7), (75000m, 0.5m, 84) })
        {
            var s = LoanMath.Schedule(p, r, n, D("2026-03-10"));
            Assert.Equal(n, s.Count);
            Assert.Equal(0m, s[^1].Balance);
            Assert.Equal(p, s.Sum(i => i.Principal));                                  // every unit of principal is repaid once
            Assert.Equal(s.Sum(i => i.Payment), p + s.Sum(i => i.Interest));           // payments = principal + interest, to the cent
            Assert.All(s, i => Assert.True(i.Balance >= 0 && i.Principal > 0));
            Assert.Equal(1, s[0].Number);
            Assert.Equal(n, s[^1].Number);
        }
    }

    [Fact]
    public void All_but_the_last_instalment_are_equal_and_the_last_differs_only_by_rounding()
    {
        var s = LoanMath.Schedule(200000, 7.5m, 300, D("2026-01-01"));
        Assert.All(s.Take(299), i => Assert.Equal(1477.98m, i.Payment));
        Assert.InRange(s[^1].Payment, 1477.98m - 5m, 1477.98m + 5m);
    }

    [Fact]
    public void The_first_instalment_charges_a_twelfth_of_the_yearly_rate_on_the_whole_principal()
    {
        var first = LoanMath.Schedule(10000, 12, 12, D("2026-01-15"))[0];
        Assert.Equal(100.00m, first.Interest);                 // 10000 x 1%
        Assert.Equal(888.49m - 100.00m, first.Principal);
        Assert.Equal(10000m - 788.49m, first.Balance);
    }

    [Fact]
    public void The_balance_follows_the_closed_form_within_a_few_cents()
    {
        var s = LoanMath.Schedule(10000, 12, 12, D("2026-01-15"));
        Assert.InRange(s[8].Balance, 2613.03m - 0.10m, 2613.03m + 0.10m);   // after 9 of 12 payments
    }

    [Fact]
    public void Dates_are_whole_months_from_the_start_and_clamp_to_short_months_without_drifting()
    {
        var s = LoanMath.Schedule(3000, 6, 4, D("2026-01-31"));
        Assert.Equal([D("2026-02-28"), D("2026-03-31"), D("2026-04-30"), D("2026-05-31")], s.Select(i => i.Date));
    }

    [Fact]
    public void Status_of_a_loan_part_way_through()
    {
        var loan = L(10000, 12, 12, "2026-01-15");
        var s = LoanMath.Status(loan, D("2026-10-17"));      // payments on 15 Feb ... 15 Oct have happened: nine
        var schedule = LoanMath.Schedule(loan);
        Assert.Equal(9, s.Paid);
        Assert.Equal(3, s.Remaining);
        Assert.Equal(schedule[8].Balance, s.Balance);
        Assert.Equal(D("2026-11-15"), s.Next!.Date);
        Assert.Equal(D("2027-01-15"), s.EndDate);
        Assert.False(s.Finished);
        Assert.False(s.NotStarted);
        Assert.Equal(10000m - s.Balance, s.PaidPrincipal);
        Assert.Equal(schedule.Sum(i => i.Interest), s.PaidInterest + s.RemainingInterest);
        Assert.Equal(schedule.Sum(i => i.Interest), s.TotalInterest);
    }

    [Fact]
    public void A_loan_that_has_not_started_owes_its_whole_principal()
    {
        var s = LoanMath.Status(L(10000, 12, 12, "2027-01-15"), D("2026-10-17"));
        Assert.True(s.NotStarted);
        Assert.Equal(0, s.Paid);
        Assert.Equal(10000m, s.Balance);
        Assert.Equal(12, s.Remaining);
    }

    [Fact]
    public void A_loan_past_its_end_is_finished_and_owes_nothing()
    {
        var s = LoanMath.Status(L(10000, 12, 12, "2024-01-15"), D("2026-10-17"));
        Assert.True(s.Finished);
        Assert.Equal(0m, s.Balance);
        Assert.Equal(0, s.Remaining);
        Assert.Null(s.Next);
        Assert.Equal(0m, s.RemainingInterest);
    }

    // ---- early repayment: 50 000 at 9% over 60 months, started 2025-01-10, today 2026-01-20 (12 paid), 10 000 with the 13th instalment ----
    private static readonly Loan Car = L(50000, 9, 60, "2025-01-10");
    private static readonly DateOnly Today = D("2026-01-20");

    [Fact]
    public void Shortening_the_term_keeps_the_instalment_and_ends_the_loan_sooner()
    {
        var r = LoanMath.EarlyRepayment(Car, Today, 10000, EarlyMode.ShortenTerm);
        Assert.Equal(13, r.AtInstallment);
        Assert.Equal(D("2026-02-10"), r.AtDate);
        Assert.Equal(1037.92m, r.NewPayment);
        Assert.Equal(34, r.RemainingMonths);                       // closed form: 33.92 -> 34 instalments
        Assert.Equal(47 - 34, r.MonthsSaved);
        Assert.Equal(D("2025-01-10").AddMonths(13 + 34), r.EndDate);
        Assert.True(r.InterestSaved > 0);
    }

    [Fact]
    public void Reducing_the_instalment_keeps_the_end_date_and_lowers_the_payment()
    {
        var r = LoanMath.EarlyRepayment(Car, Today, 10000, EarlyMode.ReducePayment);
        Assert.Equal(47, r.RemainingMonths);
        Assert.Equal(0, r.MonthsSaved);
        Assert.Equal(D("2030-01-10"), r.EndDate);
        Assert.InRange(r.NewPayment, 784.66m - 0.02m, 784.66m + 0.02m);   // closed form over the 47 remaining months
        Assert.True(r.NewPayment < 1037.92m);
        Assert.True(r.InterestSaved > 0);
    }

    [Fact]
    public void For_the_same_amount_shortening_saves_more_interest_than_reducing_the_instalment()
    {
        var shorten = LoanMath.EarlyRepayment(Car, Today, 10000, EarlyMode.ShortenTerm);
        var reduce = LoanMath.EarlyRepayment(Car, Today, 10000, EarlyMode.ReducePayment);
        Assert.True(shorten.InterestSaved > reduce.InterestSaved);
    }

    [Fact]
    public void The_remaining_schedule_after_an_early_repayment_clears_exactly_the_reduced_balance()
    {
        foreach (var mode in new[] { EarlyMode.ShortenTerm, EarlyMode.ReducePayment })
        {
            var r = LoanMath.EarlyRepayment(Car, Today, 10000, mode);
            var balanceBefore = LoanMath.Schedule(Car)[r.AtInstallment - 1].Balance;
            Assert.Equal(balanceBefore - 10000m, r.Schedule.Sum(i => i.Principal));
            Assert.Equal(0m, r.Schedule[^1].Balance);
            Assert.Equal(r.RemainingInterest, r.Schedule.Sum(i => i.Interest));
        }
    }

    [Fact]
    public void The_fee_is_a_percentage_of_the_amount_repaid_and_comes_off_the_saving()
    {
        var free = LoanMath.EarlyRepayment(Car, Today, 10000, EarlyMode.ShortenTerm);
        var fee = LoanMath.EarlyRepayment(L(50000, 9, 60, "2025-01-10", fee: 1m), Today, 10000, EarlyMode.ShortenTerm);
        Assert.Equal(100m, fee.Fee);                                  // 1% of 10 000
        Assert.Equal(free.InterestSaved, fee.InterestSaved);           // the fee does not change the loan itself
        Assert.Equal(fee.InterestSaved - 100m, fee.NetSaving);
        Assert.Equal(free.InterestSaved, free.NetSaving);
    }

    [Fact]
    public void An_amount_at_least_the_balance_pays_the_loan_off()
    {
        var r = LoanMath.EarlyRepayment(Car, Today, 1_000_000, EarlyMode.ShortenTerm);
        var balance = LoanMath.Schedule(Car)[12].Balance;
        Assert.Equal(balance, r.Amount);                               // only what is owed is applied
        Assert.Equal(0, r.RemainingMonths);
        Assert.Equal(0m, r.RemainingInterest);
        Assert.Equal(LoanMath.Schedule(Car).Where(i => i.Number > 13).Sum(i => i.Interest), r.InterestSaved);
    }

    [Fact]
    public void The_chosen_date_picks_the_first_instalment_on_or_after_it()
    {
        var r = LoanMath.EarlyRepayment(Car, Today, 5000, EarlyMode.ShortenTerm, when: D("2026-06-11"));
        Assert.Equal(D("2026-07-10"), r.AtDate);                       // 10 June is before 11 June, so the July instalment
        Assert.Equal(18, r.AtInstallment);
        var sooner = LoanMath.EarlyRepayment(Car, Today, 5000, EarlyMode.ShortenTerm);
        Assert.True(sooner.InterestSaved > r.InterestSaved);           // the same sum saves more when paid earlier
    }

    [Fact]
    public void An_early_repayment_cannot_be_applied_to_an_instalment_in_the_past()
    {
        var r = LoanMath.EarlyRepayment(Car, Today, 5000, EarlyMode.ShortenTerm, when: D("2025-03-01"));
        Assert.True(r.AtDate > Today);
    }

    [Fact]
    public void A_finished_loan_has_nothing_to_repay_early_and_bad_amounts_are_refused()
    {
        Assert.Throws<InvalidOperationException>(() => LoanMath.EarlyRepayment(L(1000, 5, 6, "2020-01-01"), Today, 100, EarlyMode.ShortenTerm));
        Assert.Throws<ArgumentOutOfRangeException>(() => LoanMath.EarlyRepayment(Car, Today, 0, EarlyMode.ShortenTerm));
        Assert.Throws<ArgumentOutOfRangeException>(() => LoanMath.EarlyRepayment(Car, Today, -5, EarlyMode.ShortenTerm));
    }

    [Fact]
    public void A_larger_early_repayment_always_saves_more()
    {
        var saved = new[] { 1000m, 5000m, 10000m, 20000m }.Select(a => LoanMath.EarlyRepayment(Car, Today, a, EarlyMode.ShortenTerm).InterestSaved).ToList();
        Assert.Equal(saved.OrderBy(x => x), saved);
        Assert.Equal(saved.Distinct().Count(), saved.Count);
    }

    // ---- an extra amount with every instalment ----

    [Fact]
    public void An_extra_amount_every_month_ends_the_loan_sooner_and_clears_to_zero()
    {
        var r = LoanMath.ExtraEveryMonth(Car, Today, 300);
        var remainingBefore = LoanMath.Schedule(Car).Count(i => i.Date > Today);
        Assert.True(r.RemainingMonths < remainingBefore);
        Assert.Equal(remainingBefore - r.RemainingMonths, r.MonthsSaved);
        Assert.Equal(0m, r.Schedule[^1].Balance);
        Assert.True(r.InterestSaved > 0);
        Assert.Equal(1037.92m + 300m, r.NewPayment);
        Assert.Equal(13, r.AtInstallment);
        // all instalments but the last carry the whole extra amount
        Assert.All(r.Schedule.Take(r.Schedule.Count - 1), i => Assert.Equal(1037.92m + 300m, i.Payment));
    }

    [Fact]
    public void The_fee_on_a_monthly_extra_covers_all_the_extra_principal_actually_paid()
    {
        var r = LoanMath.ExtraEveryMonth(L(50000, 9, 60, "2025-01-10", fee: 1m), Today, 300);
        Assert.Equal(Math.Round(r.Amount * 0.01m, 2), r.Fee);
        Assert.InRange(r.Amount, 300m * (r.RemainingMonths - 1), 300m * r.RemainingMonths);   // the last month needs less than the full extra
    }

    [Fact]
    public void More_extra_every_month_means_fewer_months_and_less_interest()
    {
        var a = LoanMath.ExtraEveryMonth(Car, Today, 100);
        var b = LoanMath.ExtraEveryMonth(Car, Today, 500);
        Assert.True(b.RemainingMonths < a.RemainingMonths);
        Assert.True(b.InterestSaved > a.InterestSaved);
    }
}
