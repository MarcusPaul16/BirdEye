using BirdEye.Domain.MarketData;

namespace BirdEye.Domain.Valuation;

/// <summary>One day of the channel: the price and the prices at which the stock would yield its historically high / median / low yield.</summary>
public record ChannelPoint(DateOnly Date, decimal Price, decimal Cheap, decimal Fair, decimal Rich);

public record ChannelResult(
    decimal CurrentYield, decimal CheapYield, decimal MedianYield, decimal RichYield, int LookbackYears,
    decimal DividendPerShare, IReadOnlyList<ChannelPoint> Points);

public static class YieldChannel
{
    private const int MaxLookbackYears = 10;
    private const int MaxPoints = 300;

    /// <summary>
    /// Builds the dividend yield channel from the trailing-12-month yield at every trading day of the last (up to) ten years.
    /// The 90th percentile yield marks "cheap", the median "fair" and the 10th percentile "rich"; each is turned into a price with
    /// that day's trailing dividend. Null when there is less than three years of yield history.
    /// </summary>
    public static ChannelResult? Build(IReadOnlyList<PricePoint> prices, IReadOnlyList<DividendPayment> dividends)
    {
        if (prices.Count < 2 || dividends.Count == 0) return null;

        var divs = dividends.OrderBy(d => d.ExDate).ToList();
        var firstFull = divs[0].ExDate.AddYears(1);
        var days = new List<(DateOnly Date, decimal Price, decimal Dps)>();
        int hi = 0, lo = 0;
        decimal sum = 0;
        foreach (var p in prices.OrderBy(p => p.Date))
        {
            while (hi < divs.Count && divs[hi].ExDate <= p.Date) sum += divs[hi++].AmountPerShare;
            while (lo < hi && divs[lo].ExDate <= p.Date.AddYears(-1)) sum -= divs[lo++].AmountPerShare;
            if (p.Date >= firstFull && p.Close > 0) days.Add((p.Date, p.Close, sum));
        }
        if (days.Count == 0) return null;

        // A payment's ex-date drifts a few days from year to year, so for a few trading days the 12-month window holds one payment
        // too many or too few and the trailing dividend spikes. A rolling median over about a month removes those blips and keeps
        // genuine dividend changes, which persist.
        var smooth = MedianSmooth(days.Select(d => d.Dps).ToList(), 10);
        for (var k = 0; k < days.Count; k++) days[k] = days[k] with { Dps = smooth[k] };

        var last = days[^1];
        var window = days.Where(d => d.Date >= last.Date.AddYears(-MaxLookbackYears)).ToList();
        var years = (int)Math.Round((last.Date.DayNumber - window[0].Date.DayNumber) / 365.25);
        if (years < 3 || last.Dps <= 0) return null;

        var yields = window.Where(d => d.Dps > 0).Select(d => d.Dps / d.Price).ToList();
        var cheap = ValuationModels.Percentile(yields, 0.90m);
        var median = ValuationModels.Percentile(yields, 0.50m);
        var rich = ValuationModels.Percentile(yields, 0.10m);
        if (rich <= 0) return null;

        var step = Math.Max(1, window.Count / MaxPoints);
        var points = window.Where((_, i) => i % step == 0 || i == window.Count - 1)
            .Select(d => new ChannelPoint(d.Date, d.Price, d.Dps / cheap, d.Dps / median, d.Dps / rich))
            .ToList();

        return new ChannelResult(last.Dps / last.Price, cheap, median, rich, years, last.Dps, points);
    }

    /// <summary>Rolling median with the given radius (window of 2 x radius + 1, shrinking at the ends).</summary>
    public static IReadOnlyList<decimal> MedianSmooth(IReadOnlyList<decimal> values, int radius)
    {
        var result = new decimal[values.Count];
        for (var i = 0; i < values.Count; i++)
        {
            var from = Math.Max(0, i - radius);
            var window = values.Skip(from).Take(Math.Min(values.Count - 1, i + radius) - from + 1).Order().ToList();
            result[i] = window[window.Count / 2];
        }
        return result;
    }
}
