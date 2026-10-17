using System.Globalization;
using BirdEye.Domain.Investments;
using BirdEye.Domain.MarketData;

namespace BirdEye.Domain.Valuation;

public enum Verdict { Undervalued, Fair, Overvalued }

public record ValuationInput(
    string Symbol, decimal Price, string Currency, string? Sector,
    CompanyFundamentals Fundamentals, IReadOnlyList<DividendPayment> Dividends, IReadOnlyList<PricePoint> Prices, DateOnly Today);

/// <summary>DCF value for a grid of discount rates (rows) and growth rates (columns).</summary>
public record Sensitivity(IReadOnlyList<decimal> DiscountRates, IReadOnlyList<decimal> Growths, IReadOnlyList<IReadOnlyList<decimal?>> Values);

public record ValuationReport(
    string Symbol, string Currency, decimal Price,
    Assumptions Assumptions, Assumptions Defaults,
    IReadOnlyList<ModelResult> Models,
    decimal? BlendedFairValue, decimal? Upside, Verdict? Verdict,
    decimal? AnalystTarget, ChannelResult? Channel, Sensitivity? Sensitivity,
    decimal? ImpliedGrowth,
    IReadOnlyList<string> Warnings);

public static class ValuationEngine
{
    /// <summary>Within this distance of the blended fair value the stock counts as fairly valued.</summary>
    public const decimal FairBand = 0.15m;

    /// <summary>Below this yield the dividend is a minor part of the return and dividend-based models say little about the stock.</summary>
    public const decimal MinDividendYield = 0.015m;

    private const decimal RiskFree = 0.0425m;
    private const decimal EquityRiskPremium = 0.05m;
    private const decimal DefaultTerminalGrowth = 0.025m;
    private const decimal DefaultBondYield = 0.05m;

    public static Assumptions DefaultAssumptions(CompanyFundamentals f, IReadOnlyDictionary<int, decimal> dividendTotals, int lastYear)
    {
        var signals = new List<decimal>();
        if (Cagr(f.FreeCashFlowHistory) is { } fcf) signals.Add(fcf);
        if (Cagr(f.EpsHistory) is { } eps) signals.Add(eps);
        if (f.EarningsGrowthNextYear is { } est) signals.Add(est);
        // Median, not mean: one extreme signal (a one-off cash flow dip, say) should not drag the default growth rate.
        var growth = signals.Count == 0 ? 0.03m : Math.Clamp(ValuationModels.Percentile(signals, 0.5m), 0m, 0.10m);

        var beta = Math.Clamp(f.Beta ?? 1m, 0.6m, 1.6m);
        var discount = RiskFree + beta * EquityRiskPremium;

        var divGrowth = DividendMetrics.Growth(dividendTotals, lastYear, 5) is { } d ? Math.Clamp(d / 100m, 0m, 0.08m) : Math.Min(growth, 0.05m);
        return new Assumptions(Math.Round(discount, 4), DefaultTerminalGrowth, Math.Round(growth, 4), Math.Round(divGrowth, 4), DefaultBondYield);
    }

    public static ValuationReport Run(ValuationInput i, AssumptionOverrides? o = null)
    {
        var f = i.Fundamentals;
        var totals = DividendMetrics.AnnualTotals(i.Dividends);
        var defaults = DefaultAssumptions(f, totals, i.Today.Year - 1);
        var a = new Assumptions(
            o?.DiscountRate ?? defaults.DiscountRate, o?.TerminalGrowth ?? defaults.TerminalGrowth, o?.Growth ?? defaults.Growth,
            o?.DividendGrowth ?? defaults.DividendGrowth, o?.BondYield ?? defaults.BondYield);

        var warnings = new List<string>();
        var dps = DividendMetrics.TrailingPerShare(i.Dividends, i.Today);
        var channel = YieldChannel.Build(i.Prices, i.Dividends);

        if (f.TrailingPe is { } pe && f.TrailingEps is { } e && e > 0)
        {
            var implied = i.Price / e;
            if (Math.Abs(implied / pe - 1) > 0.25m)
                warnings.Add($"Earnings per share looks inconsistent with the quoted P/E ({implied:0.0} vs {pe:0.0}); per-share figures may be in different units or currencies.");
        }

        var models = new List<ModelResult>
        {
            DcfModel(i, a, out var sensitivity, out var impliedGrowth),
            DdmModel(i, a, dps),
            YieldChannelModel(i, channel),
            GrahamNumberModel(i),
            GrahamGrowthModel(i, a),
            HistoricalPeModel(i),
        };

        var usable = models.Where(m => m is { Applicable: true, Reliable: true, FairValue: not null }).Select(m => m.FairValue!.Value).ToList();
        decimal? blended = usable.Count == 0 ? null : ValuationModels.Percentile(usable, 0.5m);
        decimal? upside = blended is { } b && i.Price > 0 ? b / i.Price - 1 : null;
        Verdict? verdict = upside switch
        {
            null => null,
            > FairBand => Valuation.Verdict.Undervalued,
            < -FairBand => Valuation.Verdict.Overvalued,
            _ => Valuation.Verdict.Fair,
        };

        if (usable.Count > 0 && usable.Count < 3) warnings.Add("Fewer than three models apply to this company, so the blended value is a weak signal.");
        if (usable.Count >= 2 && usable.Max() / usable.Min() > 2m) warnings.Add("The models disagree widely (highest is more than twice the lowest). Treat the blended value with caution.");

        return new ValuationReport(i.Symbol, i.Currency, i.Price, a, defaults, models, blended, upside, verdict, f.AnalystTargetPrice, channel, sensitivity, impliedGrowth, warnings);
    }

    // ---- models ----------------------------------------------------------------------------------------------------------------

    private static ModelResult DcfModel(ValuationInput i, Assumptions a, out Sensitivity? sensitivity, out decimal? impliedGrowth)
    {
        sensitivity = null;
        impliedGrowth = null;
        var f = i.Fundamentals;
        const string desc = "Projects free cash flow for 10 years (the growth rate for five years, then fading to the terminal rate), discounts it, adds a terminal value and subtracts net debt.";

        // Base cash flow: average of the last three fiscal years, so one lumpy year does not decide the value. The "TTM" figure the data
        // source gives separately can use a different capex definition than the annual statements (it was 4x lower for Microsoft), so it
        // is only a fallback when no annual history exists.
        var annual = f.FreeCashFlowHistory.OrderBy(h => h.Year).TakeLast(3).Select(h => h.Value).ToList();
        var points = annual.Count > 0 ? annual : f.FreeCashFlowTtm is { } ttm0 ? [ttm0] : [];
        decimal? fcf = points.Count == 0 ? null : points.Average();
        if (fcf is not > 0 || f.SharesOutstanding is not > 0)
            return Unavailable("dcf", "Discounted cash flow", desc, "Needs positive free cash flow and a share count.");

        var netDebt = (f.TotalDebt ?? 0m) - (f.TotalCash ?? 0m);
        decimal? Value(decimal r, decimal g) => ValuationModels.Dcf(fcf.Value, g, a.TerminalGrowth, r, a.ProjectionYears, netDebt, f.SharesOutstanding.Value);

        var fair = Value(a.DiscountRate, a.Growth);
        if (fair is null) return Unavailable("dcf", "Discounted cash flow", desc, "The discount rate must exceed terminal growth and debt must not exceed the cash flows' value.");

        var rates = new[] { -0.02m, -0.01m, 0m, 0.01m, 0.02m }.Select(d => a.DiscountRate + d).Where(r => r > a.TerminalGrowth).ToList();
        var growths = new[] { -0.04m, -0.02m, 0m, 0.02m, 0.04m }.Select(d => Math.Max(0m, a.Growth + d)).Distinct().ToList();
        sensitivity = new Sensitivity(rates, growths, rates.Select(r => (IReadOnlyList<decimal?>)growths.Select(g => Value(r, g)).ToList()).ToList());

        var inputs = new List<KeyValue>
        {
            new(annual.Count > 1 ? $"Free cash flow (avg of last {annual.Count} years)" : "Free cash flow", Big(fcf.Value, i.Currency)),
            new("Net debt", Big(netDebt, i.Currency)),
            new("Shares outstanding", Big(f.SharesOutstanding.Value, null)),
            new("Growth, year 1", Pct(a.Growth)),
            new("Terminal growth", Pct(a.TerminalGrowth)),
            new("Discount rate", Pct(a.DiscountRate)),
        };
        impliedGrowth = ValuationModels.ImpliedGrowth(i.Price, fcf.Value, a.TerminalGrowth, a.DiscountRate, a.ProjectionYears, netDebt, f.SharesOutstanding.Value);
        if (impliedGrowth is { } implied)
            inputs.Add(new("Growth priced in by today's price", Pct(implied)));
        else
            inputs.Add(new("Growth priced in by today's price", "above 60% or below 0%"));
        var reliable = !IsFinancial(i.Sector) && !IsRealEstate(i.Sector);
        return new ModelResult("dcf", "Discounted cash flow", true, reliable, fair, Value(a.DiscountRate + 0.01m, a.Growth), Value(a.DiscountRate - 0.01m, a.Growth), desc, inputs,
            IsFinancial(i.Sector) ? "Free cash flow is not meaningful for banks and insurers, so this model is excluded from the blended value."
            : IsRealEstate(i.Sector) ? "REITs distribute most cash and are normally valued on FFO, which is not available here, so this model is excluded from the blended value."
            : annual.Count > 1 && annual.Max() / Math.Max(annual.Min(), 1m) > 1.5m ? "Free cash flow was volatile over these years (highest more than 1.5x the lowest), so treat this value with caution. Range: discount rate ±1 point."
            : "Range: discount rate ±1 point.");
    }

    private static ModelResult DdmModel(ValuationInput i, Assumptions a, decimal dps)
    {
        const string desc = "Values the stock as the present value of its future dividends: five years of growth, then a perpetual terminal growth rate.";
        if (dps <= 0) return Unavailable("ddm", "Dividend discount model", desc, "The company paid no dividends in the last 12 months.");

        var fair = ValuationModels.Ddm(dps, a.DividendGrowth, a.TerminalGrowth, a.DiscountRate);
        if (fair is null) return Unavailable("ddm", "Dividend discount model", desc, "The discount rate must exceed terminal growth.");

        var inputs = new List<KeyValue>
        {
            new("Dividend per share (TTM)", Money(dps, i.Currency)),
            new("Dividend growth, years 1-5", Pct(a.DividendGrowth)),
            new("Terminal growth", Pct(a.TerminalGrowth)),
            new("Discount rate", Pct(a.DiscountRate)),
        };
        var lowYield = i.Price > 0 && dps / i.Price < MinDividendYield;
        return new ModelResult("ddm", "Dividend discount model", true, !lowYield, fair,
            ValuationModels.Ddm(dps, a.DividendGrowth, a.TerminalGrowth, a.DiscountRate + 0.01m),
            ValuationModels.Ddm(dps, a.DividendGrowth, a.TerminalGrowth, a.DiscountRate - 0.01m), desc, inputs,
            lowYield ? LowYieldNote : "Range: discount rate ±1 point.");
    }

    private static ModelResult YieldChannelModel(ValuationInput i, ChannelResult? c)
    {
        const string desc = "Prices the stock at its own historical dividend yield: today's dividend divided by the median yield of the last ten years.";
        if (c is null) return Unavailable("yield", "Dividend yield channel", desc, "Needs at least three years of dividend and price history.");

        var inputs = new List<KeyValue>
        {
            new("Dividend per share (TTM)", Money(c.DividendPerShare, i.Currency)),
            new("Current yield", Pct(c.CurrentYield)),
            new("Median yield", Pct(c.MedianYield)),
            new("High yield (90th pct)", Pct(c.CheapYield)),
            new("Low yield (10th pct)", Pct(c.RichYield)),
            new("History used", $"{c.LookbackYears} years"),
        };
        var lowYield = c.CurrentYield < MinDividendYield;
        return new ModelResult("yield", "Dividend yield channel", true, !lowYield, c.DividendPerShare / c.MedianYield,
            c.DividendPerShare / c.CheapYield, c.DividendPerShare / c.RichYield, desc, inputs,
            lowYield ? LowYieldNote : "Range: the price at the 90th percentile yield (cheap) to the 10th percentile yield (rich).");
    }

    private static ModelResult GrahamNumberModel(ValuationInput i)
    {
        const string desc = "Graham's ceiling price for a defensive investor: the square root of 22.5 × EPS × book value per share.";
        var f = i.Fundamentals;
        if (f.TrailingEps is not > 0 || f.BookValuePerShare is not > 0)
            return Unavailable("graham-number", "Graham number", desc, "Needs positive earnings and book value per share.");

        var inputs = new List<KeyValue> { new("EPS (TTM)", Money(f.TrailingEps.Value, i.Currency)), new("Book value per share", Money(f.BookValuePerShare.Value, i.Currency)) };
        var reliable = !IsRealEstate(i.Sector);
        return new ModelResult("graham-number", "Graham number", true, reliable, ValuationModels.GrahamNumber(f.TrailingEps.Value, f.BookValuePerShare.Value), null, null, desc, inputs,
            reliable ? "Penalises asset-light companies with high returns on equity (low book value), so it tends to read low for them."
                     : "Book values of REITs are depressed by depreciation, so this model is excluded from the blended value.");
    }

    private static ModelResult GrahamGrowthModel(ValuationInput i, Assumptions a)
    {
        const string desc = "Graham's growth formula: EPS × (8.5 + 2 × growth) × 4.4 ÷ current AAA bond yield.";
        var f = i.Fundamentals;
        if (f.TrailingEps is not > 0) return Unavailable("graham-growth", "Graham growth formula", desc, "Needs positive earnings.");

        var inputs = new List<KeyValue> { new("EPS (TTM)", Money(f.TrailingEps.Value, i.Currency)), new("Growth", Pct(a.Growth)), new("AAA bond yield", Pct(a.BondYield)) };
        var reliable = !IsRealEstate(i.Sector);
        return new ModelResult("graham-growth", "Graham growth formula", true, reliable, ValuationModels.GrahamGrowth(f.TrailingEps.Value, a.Growth, a.BondYield),
            ValuationModels.GrahamGrowth(f.TrailingEps.Value, Math.Max(0m, a.Growth - 0.02m), a.BondYield),
            ValuationModels.GrahamGrowth(f.TrailingEps.Value, a.Growth + 0.02m, a.BondYield), desc, inputs,
            reliable ? "Very sensitive to the growth input. Range: growth ±2 points." : "Earnings of REITs are depressed by depreciation, so this model is excluded from the blended value.");
    }

    private static ModelResult HistoricalPeModel(ValuationInput i)
    {
        const string desc = "Assumes the stock returns to its own average price-to-earnings multiple of past years, applied to current earnings.";
        var f = i.Fundamentals;
        if (f.TrailingEps is not > 0) return Unavailable("pe", "Historical P/E", desc, "Needs positive earnings.");

        var multiples = new List<decimal>();
        foreach (var eps in f.EpsHistory.Where(e => e.Value > 0))
        {
            var close = i.Prices.Where(p => p.Date.Year == eps.Year).OrderBy(p => p.Date).LastOrDefault();
            if (close is not null && eps.Year < i.Today.Year) multiples.Add(close.Close / eps.Value);
        }
        if (multiples.Count < 3) return Unavailable("pe", "Historical P/E", desc, "Needs at least three years of earnings history.");

        var avg = multiples.Average();
        var inputs = new List<KeyValue>
        {
            new("EPS (TTM)", Money(f.TrailingEps.Value, i.Currency)),
            new("Average P/E", $"{avg:0.0}×"),
            new("Lowest / highest P/E", $"{multiples.Min():0.0}× / {multiples.Max():0.0}×"),
            new("Years used", multiples.Count.ToString(CultureInfo.InvariantCulture)),
        };
        var reliable = !IsRealEstate(i.Sector);
        return new ModelResult("pe", "Historical P/E", true, reliable, f.TrailingEps.Value * avg, f.TrailingEps.Value * multiples.Min(), f.TrailingEps.Value * multiples.Max(), desc, inputs,
            reliable ? "Range: lowest to highest year-end P/E in the history. Only a few annual data points are available."
                     : "Earnings of REITs are depressed by depreciation, so this model is excluded from the blended value.");
    }

    // ---- helpers ---------------------------------------------------------------------------------------------------------------

    private const string LowYieldNote = "The dividend yield is below 1.5%, so dividends say little about this company's value. The model is excluded from the blended value.";

    private static ModelResult Unavailable(string id, string name, string desc, string why) =>
        new(id, name, false, false, null, null, null, desc, [], why);

    private static bool IsFinancial(string? sector) => string.Equals(sector, "Financial Services", StringComparison.OrdinalIgnoreCase);
    private static bool IsRealEstate(string? sector) => string.Equals(sector, "Real Estate", StringComparison.OrdinalIgnoreCase);

    /// <summary>Compound annual growth between the first and last positive points, as a fraction.</summary>
    private static decimal? Cagr(IReadOnlyList<AnnualValue> history)
    {
        var pts = history.Where(h => h.Value > 0).OrderBy(h => h.Year).ToList();
        if (pts.Count < 3) return null;
        var years = pts[^1].Year - pts[0].Year;
        return years < 2 ? null : DividendMetrics.Cagr(pts[^1].Value, pts[0].Value, years) / 100m;
    }

    private static string Pct(decimal v) => (v * 100m).ToString("0.0", CultureInfo.InvariantCulture) + "%";
    private static string Money(decimal v, string currency) => $"{v.ToString("0.00##", CultureInfo.InvariantCulture)} {currency}";

    private static string Big(decimal v, string? currency)
    {
        var abs = Math.Abs(v);
        var (div, suffix) = abs >= 1e9m ? (1e9m, "B") : abs >= 1e6m ? (1e6m, "M") : (1m, "");
        return $"{(v / div).ToString("0.##", CultureInfo.InvariantCulture)}{suffix}{(currency is null ? "" : " " + currency)}";
    }
}
