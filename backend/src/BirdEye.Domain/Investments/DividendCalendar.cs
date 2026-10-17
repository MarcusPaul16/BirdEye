using BirdEye.Domain.MarketData;

namespace BirdEye.Domain.Investments;

/// <summary>
/// Paid: already paid (to the extent the estimated payment date is in the past). Pending: the ex-date has passed, so the dividend is owed,
/// but it has not been paid yet. Confirmed: a future ex-date known to the data source. Projected: extrapolated from last year's payments.
/// </summary>
public enum DividendEventKind { Paid, Pending, Confirmed, Projected }

public record DividendEvent(
    string Symbol, DateOnly ExDate, DateOnly PaymentDate, decimal AmountPerShare, string Currency, decimal Shares,
    DividendEventKind Kind, bool PaymentDateIsEstimate);

public static class DividendCalendar
{
    /// <summary>Annual growth applied when projecting last year's amounts: the company's own latest growth, kept within sane bounds.</summary>
    private const decimal MinGrowth = 0.90m, MaxGrowth = 1.20m;

    /// <summary>Shares held that earn a dividend with this ex-date: bought before it and not sold before it.</summary>
    public static decimal SharesBefore(IEnumerable<StockTransaction> transactions, string symbol, DateOnly exDate) =>
        transactions.Where(t => string.Equals(t.Symbol, symbol, StringComparison.OrdinalIgnoreCase) && t.Date < exDate)
            .Sum(t => t.Type == TransactionType.Buy ? t.Quantity : -t.Quantity);

    /// <summary>
    /// Every dividend event of one holding between <paramref name="from"/> and <paramref name="to"/>: what was paid or is owed, what the data
    /// source says is coming, and (to fill the rest of the horizon) last year's payments rolled forward by a year.
    /// </summary>
    public static IReadOnlyList<DividendEvent> Build(
        string symbol, IReadOnlyList<StockTransaction> transactions, IReadOnlyList<DividendPayment> dividends,
        UpcomingDividend? upcoming, DateOnly today, DateOnly from, DateOnly to)
    {
        var events = new List<DividendEvent>();
        var divs = dividends.OrderBy(d => d.ExDate).ToList();

        // Past: owed or paid, for the shares held at the time.
        foreach (var d in divs)
        {
            var pay = d.PaymentDate ?? d.ExDate.AddDays(14);
            if (pay < from || d.ExDate > today) continue;
            var shares = SharesBefore(transactions, symbol, d.ExDate);
            if (shares <= 0) continue;
            var kind = pay <= today ? DividendEventKind.Paid : DividendEventKind.Pending;
            events.Add(new DividendEvent(symbol, d.ExDate, pay, d.AmountPerShare, d.Currency, shares, kind, d.PaymentDateIsEstimate));
        }

        // Future: for the shares held on each event's own ex-date, so a purchase dated later than today (or a planned sale) is respected.
        if (divs.Count == 0) return events;

        var yearAgo = today.AddYears(-1);
        var lastYear = divs.Where(d => d.ExDate > yearAgo && d.ExDate <= today).ToList();
        var growth = AnnualGrowth(divs, today);

        var projected = new List<DividendEvent>();
        foreach (var d in lastYear)
        {
            var pay = (d.PaymentDate ?? d.ExDate.AddDays(14)).AddYears(1);
            if (pay <= today || pay > to) continue;
            var exDate = d.ExDate.AddYears(1);
            var shares = SharesBefore(transactions, symbol, exDate);
            if (shares <= 0) continue;
            projected.Add(new DividendEvent(symbol, exDate, pay, Math.Round(d.AmountPerShare * growth, 6), d.Currency, shares, DividendEventKind.Projected, true));
        }

        // A confirmed ex-date replaces the projection it corresponds to (the nearest one, within 45 days), or stands on its own.
        if (upcoming is { } up && up.ExDate > today)
        {
            var match = projected.OrderBy(p => Math.Abs(p.ExDate.DayNumber - up.ExDate.DayNumber)).FirstOrDefault();
            var near = match is not null && Math.Abs(match.ExDate.DayNumber - up.ExDate.DayNumber) <= 45;
            var template = near ? match! : null;
            var amount = template?.AmountPerShare ?? Math.Round(divs[^1].AmountPerShare, 6);
            var currency = template?.Currency ?? divs[^1].Currency;
            var estimate = up.PaymentDate is null || up.PaymentDate < up.ExDate;
            var pay = estimate ? up.ExDate.AddDays(14) : up.PaymentDate!.Value;
            if (template is not null) projected.Remove(template);
            var upShares = SharesBefore(transactions, symbol, up.ExDate);
            if (pay <= to && upShares > 0) projected.Add(new DividendEvent(symbol, up.ExDate, pay, amount, currency, upShares, DividendEventKind.Confirmed, estimate));
        }

        events.AddRange(projected);
        return events.OrderBy(e => e.PaymentDate).ThenBy(e => e.Symbol).ToList();
    }

    /// <summary>Dividends of the last 12 months over those of the 12 months before, clamped; 1 when there is no usable history.</summary>
    public static decimal AnnualGrowth(IReadOnlyList<DividendPayment> dividends, DateOnly today)
    {
        var last = dividends.Where(d => d.ExDate > today.AddYears(-1) && d.ExDate <= today).Sum(d => d.AmountPerShare);
        var before = dividends.Where(d => d.ExDate > today.AddYears(-2) && d.ExDate <= today.AddYears(-1)).Sum(d => d.AmountPerShare);
        return last > 0 && before > 0 ? Math.Clamp(last / before, MinGrowth, MaxGrowth) : 1m;
    }
}
