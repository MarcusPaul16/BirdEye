using BirdEye.Domain.Expenses;

namespace BirdEye.Tests;

public class ExpenseScheduleTests
{
    private static Expense E(string date, Recurrence r, string? end = null, decimal amount = 100m) =>
        new() { Name = "x", Amount = amount, Date = DateOnly.Parse(date), Recurrence = r, EndDate = end is null ? null : DateOnly.Parse(end) };

    [Fact]
    public void A_one_off_expense_occurs_only_in_its_own_month()
    {
        var e = E("2026-03-15", Recurrence.OneTime);
        Assert.Equal(new DateOnly(2026, 3, 15), ExpenseSchedule.OccurrenceIn(e, 2026, 3));
        Assert.Null(ExpenseSchedule.OccurrenceIn(e, 2026, 2));
        Assert.Null(ExpenseSchedule.OccurrenceIn(e, 2026, 4));
        Assert.Null(ExpenseSchedule.OccurrenceIn(e, 2027, 3));
    }

    [Fact]
    public void A_monthly_expense_repeats_every_month_from_its_start_on_the_same_day()
    {
        var e = E("2026-01-05", Recurrence.Monthly);
        Assert.Null(ExpenseSchedule.OccurrenceIn(e, 2025, 12));
        Assert.Equal(new DateOnly(2026, 1, 5), ExpenseSchedule.OccurrenceIn(e, 2026, 1));
        Assert.Equal(new DateOnly(2026, 11, 5), ExpenseSchedule.OccurrenceIn(e, 2026, 11));
        Assert.Equal(new DateOnly(2027, 6, 5), ExpenseSchedule.OccurrenceIn(e, 2027, 6));
    }

    [Fact]
    public void Quarterly_and_yearly_expenses_skip_the_months_in_between()
    {
        var q = E("2026-02-10", Recurrence.Quarterly);
        Assert.Equal([2, 5, 8, 11], Enumerable.Range(1, 12).Where(m => ExpenseSchedule.OccurrenceIn(q, 2026, m) is not null));
        var y = E("2026-07-20", Recurrence.Yearly);
        Assert.Equal([7], Enumerable.Range(1, 12).Where(m => ExpenseSchedule.OccurrenceIn(y, 2027, m) is not null));
        Assert.Null(ExpenseSchedule.OccurrenceIn(y, 2026, 8));
    }

    [Theory]
    [InlineData(2026, 2, 28)]  // not a leap year
    [InlineData(2028, 2, 29)]  // leap year
    [InlineData(2026, 4, 30)]  // 30-day month
    [InlineData(2026, 5, 31)]
    public void The_31st_is_clamped_to_the_length_of_the_month(int year, int month, int day)
    {
        var e = E("2026-01-31", Recurrence.Monthly);
        Assert.Equal(new DateOnly(year, month, day), ExpenseSchedule.OccurrenceIn(e, year, month));
    }

    [Fact]
    public void A_recurring_expense_stops_after_its_end_date()
    {
        var e = E("2026-01-10", Recurrence.Monthly, end: "2026-06-15");
        Assert.NotNull(ExpenseSchedule.OccurrenceIn(e, 2026, 6));   // 10 June is on or before 15 June
        Assert.Null(ExpenseSchedule.OccurrenceIn(e, 2026, 7));
    }

    [Fact]
    public void Ending_before_the_day_of_the_month_removes_that_months_occurrence()
    {
        // Stopped on 5 June, but it is charged on the 10th: June's charge no longer happens.
        var e = E("2026-01-10", Recurrence.Monthly, end: "2026-06-05");
        Assert.NotNull(ExpenseSchedule.OccurrenceIn(e, 2026, 5));
        Assert.Null(ExpenseSchedule.OccurrenceIn(e, 2026, 6));
    }

    [Fact]
    public void Monthly_equivalent_spreads_quarterly_and_yearly_costs_and_ignores_one_offs()
    {
        Assert.Equal(100m, ExpenseSchedule.MonthlyEquivalent(E("2026-01-01", Recurrence.Monthly)));
        Assert.Equal(40m, ExpenseSchedule.MonthlyEquivalent(E("2026-01-01", Recurrence.Quarterly, amount: 120m)));
        Assert.Equal(100m, ExpenseSchedule.MonthlyEquivalent(E("2026-01-01", Recurrence.Yearly, amount: 1200m)));
        Assert.Equal(0m, ExpenseSchedule.MonthlyEquivalent(E("2026-01-01", Recurrence.OneTime)));
    }

    [Fact]
    public void Active_means_started_and_not_yet_ended_in_that_month()
    {
        var e = E("2026-03-20", Recurrence.Monthly, end: "2026-08-10");
        Assert.False(ExpenseSchedule.IsActiveIn(e, 2026, 2));
        Assert.True(ExpenseSchedule.IsActiveIn(e, 2026, 3));
        Assert.True(ExpenseSchedule.IsActiveIn(e, 2026, 8));    // ends on the 10th, so it was still running that month
        Assert.False(ExpenseSchedule.IsActiveIn(e, 2026, 9));
        Assert.False(ExpenseSchedule.IsActiveIn(E("2026-03-20", Recurrence.OneTime), 2026, 3));
    }
}
