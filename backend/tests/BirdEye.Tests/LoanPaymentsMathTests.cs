using BirdEye.Domain.Loans;

namespace BirdEye.Tests;

public class LoanPaymentsMathTests
{
    private static DateOnly D(string s) => DateOnly.Parse(s);

    // 10 000 at 12% over 12 months, started 15 Jan 2026: instalments of 888.49 on the 15th of each month from February.
    private static readonly Loan Loan = new() { Name = "x", Principal = 10000, AnnualRatePercent = 12, Months = 12, StartDate = D("2026-01-15") };
    private static readonly DateOnly Today = D("2026-04-20");   // three instalments are behind: 15 Feb, 15 Mar, 15 Apr

    private static Repayment[] OnTime(int count) =>
        LoanMath.Schedule(Loan).Take(count).Select(i => new Repayment(i.Date, i.Payment)).ToArray();

    [Fact]
    public void Without_payments_the_loan_follows_its_schedule()
    {
        var s = LoanMath.Status(Loan, [], Today);
        var schedule = LoanMath.Schedule(Loan);
        Assert.False(s.Tracked);
        Assert.Equal(schedule[2].Balance, s.Balance);
        Assert.Equal(9, s.Remaining);
        Assert.Equal(schedule.Take(3).Sum(i => i.Payment), s.PaidTotal);
        Assert.Equal(schedule.Skip(3).Sum(i => i.Payment), s.RemainingTotal);
    }

    [Fact]
    public void Paying_every_instalment_on_time_gives_exactly_the_scheduled_balance()
    {
        var s = LoanMath.Status(Loan, OnTime(3), Today);
        Assert.True(s.Tracked);
        Assert.Equal(LoanMath.Schedule(Loan)[2].Balance, s.Balance);
        Assert.Equal(9, s.Remaining);
        Assert.Equal(3 * 888.49m, s.PaidTotal);
        Assert.Equal(s.ScheduledBalance, s.Balance);
        Assert.Equal(s.OriginalEndDate, s.EndDate);
    }

    [Fact]
    public void An_extra_payment_lowers_the_balance_and_brings_the_end_date_forward()
    {
        var payments = OnTime(3).Append(new Repayment(D("2026-04-16"), 2000)).ToArray();
        var s = LoanMath.Status(Loan, payments, Today);
        // The 2 000 is paid before the 4th instalment date, so it counts towards that instalment: it replaces the 888.49 that would be due.
        Assert.Equal(LoanMath.Schedule(Loan)[3].Balance + 888.49m - 2000m, s.Balance);
        Assert.True(s.Remaining < 8);
        Assert.True(s.EndDate < s.OriginalEndDate);
        Assert.Equal(2000m - 888.49m, s.ScheduledBalance - s.Balance);   // ahead by what was paid above the instalment
        Assert.Equal(3 * 888.49m + 2000m, s.PaidTotal);
    }

    [Fact]
    public void A_missed_instalment_leaves_the_balance_higher_and_pushes_the_end_date_back()
    {
        var s = LoanMath.Status(Loan, OnTime(2), Today);   // nothing paid for April
        Assert.True(s.Balance > s.ScheduledBalance);
        Assert.True(s.EndDate > s.OriginalEndDate);
        Assert.Equal(2 * 888.49m, s.PaidTotal);
    }

    [Fact]
    public void A_payment_before_the_next_due_date_counts_towards_that_instalment()
    {
        var today = D("2026-04-10");   // 15 April is still ahead
        var paid = OnTime(2).Append(new Repayment(D("2026-04-08"), 888.49m)).ToArray();
        var s = LoanMath.Status(Loan, paid, today);
        Assert.Equal(LoanMath.Schedule(Loan)[2].Balance, s.Balance);
        Assert.Equal(9, s.Remaining);
        Assert.Equal(D("2026-05-15"), s.Next!.Date);        // April is already covered, so the next one due is May
    }

    [Fact]
    public void The_payment_order_in_the_list_does_not_matter()
    {
        var a = LoanMath.Status(Loan, OnTime(3), Today);
        var b = LoanMath.Status(Loan, OnTime(3).Reverse().ToArray(), Today);
        Assert.Equal(a.Balance, b.Balance);
        Assert.Equal(a.Remaining, b.Remaining);
    }

    [Fact]
    public void Paying_the_whole_schedule_finishes_the_loan_without_a_stray_extra_month()
    {
        var all = OnTime(12);
        var s = LoanMath.Status(Loan, all, D("2027-02-20"));
        Assert.True(s.Finished);
        Assert.Equal(0m, s.Balance);
        Assert.Equal(0, s.Remaining);
        Assert.Equal(0m, s.RemainingTotal);
        Assert.Equal(D("2027-01-15"), s.EndDate);
    }

    [Fact]
    public void Paying_roughly_the_scheduled_amounts_leaves_no_cents_dangling()
    {
        // Rounding the instalment to 888 each time leaves a few units at the end; under one unit counts as paid.
        var s = LoanMath.Status(Loan, LoanMath.Schedule(Loan).Select(i => new Repayment(i.Date, i.Payment - 0.4m)).ToArray(), D("2027-02-20"));
        Assert.True(s.Balance < 6m);   // 12 x 0.4 of missing payments plus the interest on them
        var exact = LoanMath.Status(Loan, LoanMath.Schedule(Loan).Select(i => new Repayment(i.Date, i.Payment - 0.04m)).ToArray(), D("2027-02-20"));
        Assert.True(exact.Finished);
    }

    [Fact]
    public void Paying_more_than_is_owed_stops_at_zero()
    {
        var s = LoanMath.Status(Loan, [new Repayment(D("2026-02-15"), 50000)], Today);
        Assert.True(s.Finished);
        Assert.Equal(0m, s.Balance);
        Assert.Equal(50000m, s.PaidTotal);   // what was really paid is still reported
    }

    [Fact]
    public void Remaining_instalments_after_extra_payments_still_sum_to_the_balance_plus_interest()
    {
        var pos = LoanMath.Position(Loan, OnTime(3).Append(new Repayment(D("2026-04-16"), 1500)).ToArray(), Today);
        Assert.Equal(pos.Balance, pos.Remaining.Sum(i => i.Principal));
        Assert.Equal(0m, pos.Remaining[^1].Balance);
        Assert.Equal(5, pos.Remaining[0].Number);   // the 2 000 settled the 4th instalment ahead of its date
    }

    [Fact]
    public void Early_repayment_scenarios_start_from_the_real_balance()
    {
        var payments = OnTime(3).Append(new Repayment(D("2026-04-16"), 2000)).ToArray();
        var pos = LoanMath.Position(Loan, payments, Today);
        var plain = LoanMath.EarlyRepayment(Loan, Today, 1000, EarlyMode.ShortenTerm, null, pos.Remaining);
        Assert.Equal(pos.Remaining.Count - 1 - plain.RemainingMonths, plain.MonthsSaved);   // the instalment it is applied to is not "saved"
        Assert.Equal(pos.Remaining[0].Number, plain.AtInstallment);
        Assert.True(plain.InterestSaved > 0);

        var reduce = LoanMath.EarlyRepayment(Loan, Today, 1000, EarlyMode.ReducePayment, null, pos.Remaining);
        Assert.Equal(pos.Remaining[^1].Date, reduce.EndDate);   // the end date holds, the instalment shrinks
        Assert.True(reduce.NewPayment < 888.49m);

        var monthly = LoanMath.ExtraEveryMonth(Loan, Today, 100, pos.Remaining);
        Assert.True(monthly.RemainingMonths < pos.Remaining.Count);
    }
}
