namespace BirdEye.Domain.Expenses;

public enum ExpenseCategory { Housing, Utilities, Groceries, Transport, Health, Subscriptions, Dining, Shopping, Entertainment, Insurance, Education, Loans, Other }

public enum Recurrence { OneTime, Monthly, Quarterly, Yearly }

public class Expense : IOwnedByUser
{
    public string UserId { get; set; } = "";
    public int Id { get; set; }
    public required string Name { get; set; }
    public ExpenseCategory Category { get; set; } = ExpenseCategory.Other;
    public decimal Amount { get; set; }
    public string Currency { get; set; } = "RON";

    /// <summary>The date of a one-off expense, or of the first occurrence of a recurring one (which also fixes the day of the month it repeats on).</summary>
    public DateOnly Date { get; set; }

    public Recurrence Recurrence { get; set; } = Recurrence.OneTime;

    /// <summary>Last day a recurring expense can occur, for a subscription that was cancelled or a loan that ends. Null: it goes on.</summary>
    public DateOnly? EndDate { get; set; }

    public bool IsRecurring => Recurrence != Recurrence.OneTime;
}

public static class ExpenseSchedule
{
    /// <summary>
    /// The date the expense falls on in the given month, or null when it does not occur then. A recurring expense keeps its day of the month,
    /// clamped to the month's length (the 31st becomes the 30th, or the 28th/29th in February), and never occurs after its end date.
    /// </summary>
    public static DateOnly? OccurrenceIn(Expense e, int year, int month)
    {
        var months = (year * 12 + month) - (e.Date.Year * 12 + e.Date.Month);
        if (months < 0) return null;

        var occurs = e.Recurrence switch
        {
            Recurrence.OneTime => months == 0,
            Recurrence.Monthly => true,
            Recurrence.Quarterly => months % 3 == 0,
            Recurrence.Yearly => months % 12 == 0,
            _ => false,
        };
        if (!occurs) return null;

        var date = new DateOnly(year, month, Math.Min(e.Date.Day, DateTime.DaysInMonth(year, month)));
        return e.EndDate is { } end && date > end ? null : date;
    }

    /// <summary>What a recurring expense costs per month on average (quarterly / 3, yearly / 12); zero for one-off expenses.</summary>
    public static decimal MonthlyEquivalent(Expense e) => e.Recurrence switch
    {
        Recurrence.Monthly => e.Amount,
        Recurrence.Quarterly => e.Amount / 3m,
        Recurrence.Yearly => e.Amount / 12m,
        _ => 0m,
    };

    /// <summary>True when a recurring expense is still running in the given month (started, and not past its end date).</summary>
    public static bool IsActiveIn(Expense e, int year, int month)
    {
        if (!e.IsRecurring) return false;
        var first = new DateOnly(year, month, 1);
        var last = first.AddMonths(1).AddDays(-1);
        return e.Date <= last && (e.EndDate is null || e.EndDate >= first);
    }
}
