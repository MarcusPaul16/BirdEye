using BirdEye.Domain.MarketData;

namespace BirdEye.Domain.Investments;

public static class DividendMetrics
{
    /// <summary>Dividends per share by calendar year of the (estimated) payment date, matching how the UI groups them.</summary>
    public static IReadOnlyDictionary<int, decimal> AnnualTotals(IEnumerable<DividendPayment> dividends) =>
        dividends.GroupBy(d => (d.PaymentDate ?? d.ExDate).Year).ToDictionary(g => g.Key, g => g.Sum(d => d.AmountPerShare));

    /// <summary>Dividends per share with an ex-date in the 12 months up to and including <paramref name="today"/>.</summary>
    public static decimal TrailingPerShare(IEnumerable<DividendPayment> dividends, DateOnly today) =>
        dividends.Where(d => d.ExDate > today.AddYears(-1) && d.ExDate <= today).Sum(d => d.AmountPerShare);

    /// <summary>Compound annual growth (in %) between <paramref name="lastYear"/> and <paramref name="years"/> earlier; null without a positive base.</summary>
    public static decimal? Cagr(decimal last, decimal @base, int years) =>
        @base > 0 && last >= 0 ? (decimal)(Math.Pow((double)(last / @base), 1.0 / years) - 1) * 100m : null;

    public static decimal? Growth(IReadOnlyDictionary<int, decimal> totals, int lastYear, int years) =>
        totals.TryGetValue(lastYear, out var last) && totals.TryGetValue(lastYear - years, out var b) ? Cagr(last, b, years) : null;
}
