namespace BirdEye.Domain.Valuation;

public record KeyValue(string Label, string Value);

/// <summary>Outcome of one valuation model. <see cref="Reliable"/> false means it ran but is a poor fit for this kind of company.</summary>
public record ModelResult(
    string Id,
    string Name,
    bool Applicable,
    bool Reliable,
    decimal? FairValue,
    decimal? Low,
    decimal? High,
    string Description,
    IReadOnlyList<KeyValue> Inputs,
    string? Note);

/// <summary>Rates are fractions (0.08 = 8%).</summary>
public record Assumptions(decimal DiscountRate, decimal TerminalGrowth, decimal Growth, decimal DividendGrowth, decimal BondYield, int ProjectionYears = 10);

public record AssumptionOverrides(decimal? DiscountRate, decimal? TerminalGrowth, decimal? Growth, decimal? DividendGrowth, decimal? BondYield);

/// <summary>The pure maths of each model, free of data access so it can be tested against hand-worked examples.</summary>
public static class ValuationModels
{
    /// <summary>
    /// Free-cash-flow DCF. Cash flow grows at <paramref name="growth"/> for the first half of the projection, then fades linearly to
    /// <paramref name="terminalGrowth"/> by the last year; a Gordon-growth terminal value follows. Returns value per share, or null
    /// if the inputs cannot work.
    /// </summary>
    public static decimal? Dcf(decimal fcf, decimal growth, decimal terminalGrowth, decimal discountRate, int years, decimal netDebt, decimal shares)
    {
        if (fcf <= 0 || shares <= 0 || years < 2 || discountRate <= terminalGrowth) return null;

        var hold = years / 2;
        decimal cash = fcf, discount = 1m, pv = 0m;
        for (var t = 1; t <= years; t++)
        {
            var g = t <= hold ? growth : growth + (terminalGrowth - growth) * (t - hold) / (years - hold);
            cash *= 1 + g;
            discount *= 1 + discountRate;
            pv += cash / discount;
        }
        pv += cash * (1 + terminalGrowth) / (discountRate - terminalGrowth) / discount;

        var equity = pv - netDebt;
        return equity > 0 ? equity / shares : null;
    }

    /// <summary>
    /// The year-1 growth rate the DCF needs for its value to equal <paramref name="price"/> (a "reverse DCF": what the market is pricing in).
    /// Null when no rate between 0% and 60% gets there.
    /// </summary>
    public static decimal? ImpliedGrowth(decimal price, decimal fcf, decimal terminalGrowth, decimal discountRate, int years, decimal netDebt, decimal shares)
    {
        decimal lo = 0m, hi = 0.60m;
        var top = Dcf(fcf, hi, terminalGrowth, discountRate, years, netDebt, shares);
        var bottom = Dcf(fcf, lo, terminalGrowth, discountRate, years, netDebt, shares);
        if (top is null || bottom is null || price > top || price < bottom) return null;

        for (var n = 0; n < 40; n++)
        {
            var mid = (lo + hi) / 2;
            if (Dcf(fcf, mid, terminalGrowth, discountRate, years, netDebt, shares)!.Value < price) lo = mid; else hi = mid;
        }
        return (lo + hi) / 2;
    }

    /// <summary>Two-stage dividend discount model: five years of dividend growth, then perpetual terminal growth.</summary>
    public static decimal? Ddm(decimal dividend, decimal growth, decimal terminalGrowth, decimal discountRate, int highGrowthYears = 5)
    {
        if (dividend <= 0 || discountRate <= terminalGrowth) return null;

        decimal d = dividend, discount = 1m, pv = 0m;
        for (var t = 1; t <= highGrowthYears; t++)
        {
            d *= 1 + growth;
            discount *= 1 + discountRate;
            pv += d / discount;
        }
        return pv + d * (1 + terminalGrowth) / (discountRate - terminalGrowth) / discount;
    }

    /// <summary>Benjamin Graham's ceiling price: sqrt(22.5 x EPS x book value per share), i.e. P/E up to 15 and P/B up to 1.5.</summary>
    public static decimal? GrahamNumber(decimal eps, decimal bookValuePerShare) =>
        eps > 0 && bookValuePerShare > 0 ? (decimal)Math.Sqrt((double)(22.5m * eps * bookValuePerShare)) : null;

    /// <summary>Graham's growth formula: EPS x (8.5 + 2g) x 4.4 / Y, with g and Y in percent (4.4 is the bond yield Graham started from).</summary>
    public static decimal? GrahamGrowth(decimal eps, decimal growth, decimal bondYield) =>
        eps > 0 && bondYield > 0 ? eps * (8.5m + 2m * growth * 100m) * 4.4m / (bondYield * 100m) : null;

    /// <summary>Linear-interpolated percentile of unsorted values; <paramref name="p"/> in [0, 1].</summary>
    public static decimal Percentile(IEnumerable<decimal> values, decimal p)
    {
        var v = values.OrderBy(x => x).ToList();
        if (v.Count == 0) throw new ArgumentException("No values.", nameof(values));
        var pos = p * (v.Count - 1);
        var lo = (int)Math.Floor(pos);
        var hi = Math.Min(lo + 1, v.Count - 1);
        return v[lo] + (v[hi] - v[lo]) * (pos - lo);
    }
}
