using BirdEye.Domain.MarketData;
using BirdEye.Domain.Valuation;

namespace BirdEye.Tests;

public class ValuationModelsTests
{
    [Fact]
    public void Dcf_of_a_flat_cash_flow_equals_the_perpetuity_value()
    {
        // 100 a year forever at 10% is worth 1000; 10 shares -> 100 each.
        var v = ValuationModels.Dcf(fcf: 100m, growth: 0m, terminalGrowth: 0m, discountRate: 0.10m, years: 2, netDebt: 0m, shares: 10m);
        Assert.Equal(100m, Math.Round(v!.Value, 6));
    }

    [Fact]
    public void Dcf_with_growth_equal_to_terminal_growth_is_a_gordon_perpetuity()
    {
        // 100 growing 5% forever at 10%: 100 x 1.05 / (0.10 - 0.05) = 2100, whatever the projection length.
        Assert.Equal(2100m, Math.Round(ValuationModels.Dcf(100m, 0.05m, 0.05m, 0.10m, 10, 0m, 1m)!.Value, 6));
    }

    [Fact]
    public void Dcf_holds_growth_for_half_the_horizon_then_fades_to_terminal()
    {
        // 2-year horizon: year 1 keeps the 10% growth (cash 110, PV 100); year 2 is already at terminal growth 0% (cash 110, PV 90.909);
        // terminal value 110 / 0.10 discounted two years = 909.091. Total 1100, over 10 shares = 110.
        Assert.Equal(110m, Math.Round(ValuationModels.Dcf(100m, 0.10m, 0m, 0.10m, 2, 0m, 10m)!.Value, 6));
    }

    [Fact]
    public void Implied_growth_reproduces_the_price_it_was_solved_for()
    {
        var price = ValuationModels.Dcf(100m, 0.12m, 0.025m, 0.09m, 10, 50m, 10m)!.Value;
        var g = ValuationModels.ImpliedGrowth(price, 100m, 0.025m, 0.09m, 10, 50m, 10m)!.Value;
        Assert.Equal(0.12m, Math.Round(g, 4));
    }

    [Fact]
    public void Implied_growth_is_null_when_the_price_is_out_of_reach() =>
        Assert.Null(ValuationModels.ImpliedGrowth(1_000_000m, 100m, 0.025m, 0.09m, 10, 0m, 1m));

    [Fact]
    public void Dcf_subtracts_net_debt_before_dividing_by_shares()
    {
        var v = ValuationModels.Dcf(100m, 0m, 0m, 0.10m, 5, netDebt: 200m, shares: 10m);
        Assert.Equal(80m, Math.Round(v!.Value, 6));
    }

    [Theory]
    [InlineData(-5, 0.10, 0.02)]   // negative cash flow
    [InlineData(100, 0.02, 0.03)]  // discount rate below terminal growth
    [InlineData(100, 0.03, 0.03)]  // equal: Gordon growth blows up
    public void Dcf_is_null_when_it_cannot_work(double fcf, double rate, double terminal) =>
        Assert.Null(ValuationModels.Dcf((decimal)fcf, 0.05m, (decimal)terminal, (decimal)rate, 10, 0m, 1m));

    [Fact]
    public void Dcf_is_null_when_debt_exceeds_the_value_of_the_business() =>
        Assert.Null(ValuationModels.Dcf(1m, 0m, 0m, 0.10m, 5, netDebt: 1000m, shares: 1m));

    [Fact]
    public void Higher_discount_rate_lowers_value()
    {
        var low = ValuationModels.Dcf(100m, 0.05m, 0.02m, 0.07m, 10, 0m, 1m)!.Value;
        var high = ValuationModels.Dcf(100m, 0.05m, 0.02m, 0.09m, 10, 0m, 1m)!.Value;
        Assert.True(low > high);
    }

    [Fact]
    public void Ddm_of_a_flat_dividend_is_a_perpetuity() =>
        Assert.Equal(10m, Math.Round(ValuationModels.Ddm(1m, 0m, 0m, 0.10m)!.Value, 6));

    [Fact]
    public void Ddm_needs_a_dividend_and_a_sane_discount_rate()
    {
        Assert.Null(ValuationModels.Ddm(0m, 0.05m, 0.02m, 0.08m));
        Assert.Null(ValuationModels.Ddm(1m, 0.05m, 0.05m, 0.04m));
    }

    [Fact]
    public void Graham_number_matches_the_textbook_formula() =>
        Assert.Equal(47.43m, Math.Round(ValuationModels.GrahamNumber(4m, 25m)!.Value, 2)); // sqrt(22.5 * 100)

    [Fact]
    public void Graham_number_is_null_for_negative_book_value() =>
        Assert.Null(ValuationModels.GrahamNumber(4m, -1m));

    [Fact]
    public void Graham_growth_formula_matches_the_textbook_formula() =>
        // 5 x (8.5 + 2 x 5) x 4.4 / 4.4 = 92.5
        Assert.Equal(92.5m, ValuationModels.GrahamGrowth(5m, 0.05m, 0.044m));

    [Fact]
    public void Percentile_interpolates()
    {
        decimal[] v = [5m, 1m, 3m, 2m, 4m];
        Assert.Equal(3m, ValuationModels.Percentile(v, 0.5m));
        Assert.Equal(4.6m, ValuationModels.Percentile(v, 0.9m));
        Assert.Equal(1m, ValuationModels.Percentile(v, 0m));
    }
}

public class YieldChannelTests
{
    private static (List<PricePoint> Prices, List<DividendPayment> Dividends) SteadyPayer(int fromYear, int toYear, decimal price, decimal quarterly)
    {
        var prices = new List<PricePoint>();
        for (var d = new DateOnly(fromYear, 1, 1); d <= new DateOnly(toYear, 12, 31); d = d.AddDays(1)) prices.Add(new PricePoint(d, price));
        var divs = new List<DividendPayment>();
        for (var y = fromYear; y <= toYear; y++)
            foreach (var m in new[] { 1, 4, 7, 10 })
                divs.Add(new DividendPayment(new DateOnly(y, m, 1), null, quarterly, "USD"));
        return (prices, divs);
    }

    [Fact]
    public void Constant_price_and_dividend_give_a_flat_four_percent_channel()
    {
        var (prices, divs) = SteadyPayer(2018, 2025, 100m, 1m);
        var c = YieldChannel.Build(prices, divs)!;
        Assert.Equal(0.04m, c.MedianYield);
        Assert.Equal(0.04m, c.CurrentYield);
        Assert.Equal(100m, c.DividendPerShare / c.MedianYield);
        Assert.All(c.Points, p => Assert.Equal(100m, p.Fair));
    }

    [Fact]
    public void Channel_needs_three_years_of_yield_history()
    {
        var (prices, divs) = SteadyPayer(2024, 2025, 100m, 1m);
        Assert.Null(YieldChannel.Build(prices, divs));
    }

    [Fact]
    public void Cheap_price_is_below_fair_which_is_below_rich()
    {
        var (prices, divs) = SteadyPayer(2016, 2025, 100m, 1m);
        // Make the second half of the history pricier so yields vary.
        var varied = prices.Select(p => p.Date.Year >= 2021 ? p with { Close = 150m } : p).ToList();
        var c = YieldChannel.Build(varied, divs)!;
        var last = c.Points[^1];
        Assert.True(last.Cheap <= last.Fair && last.Fair <= last.Rich);
    }
}

public class YieldChannelSmoothingTests
{
    [Fact]
    public void Median_smoothing_removes_a_short_spike_but_keeps_a_lasting_step()
    {
        // A 3-day blip of 5 in a flat series of 4, then a lasting step up to 5.
        var series = Enumerable.Repeat(4m, 20).Concat([5m, 5m, 5m]).Concat(Enumerable.Repeat(4m, 20)).Concat(Enumerable.Repeat(5m, 40)).ToList();
        var smooth = YieldChannel.MedianSmooth(series, 10);
        Assert.All(smooth.Skip(10).Take(33), v => Assert.Equal(4m, v));   // indices 10..42: blip gone, step (from 43) not yet reached
        Assert.Equal(5m, smooth[^1]);                                       // step kept
    }
}

public class ValuationEngineTests
{
    private static ValuationInput Input(string? sector, CompanyFundamentals f, decimal price = 100m)
    {
        var today = new DateOnly(2026, 6, 30);
        var prices = new List<PricePoint>();
        for (var d = new DateOnly(2014, 1, 1); d <= today; d = d.AddDays(1)) prices.Add(new PricePoint(d, price));
        var divs = new List<DividendPayment>();
        for (var y = 2014; y <= 2026; y++) foreach (var m in new[] { 1, 4, 7, 10 }) if (new DateOnly(y, m, 1) <= today) divs.Add(new DividendPayment(new DateOnly(y, m, 1), null, 1m, "USD"));
        return new ValuationInput("TEST", price, "USD", sector, f, divs, prices, today);
    }

    private static CompanyFundamentals Fundamentals() => new(
        "TEST", "USD", SharesOutstanding: 100m, FreeCashFlowTtm: 1000m, TotalDebt: 500m, TotalCash: 300m, TrailingEps: 8m, ForwardEps: 9m,
        BookValuePerShare: 40m, Beta: 1.0m, EarningsGrowthNextYear: 0.06m, TrailingPe: 12.5m, AnalystTargetPrice: 120m,
        FreeCashFlowHistory: [new(2022, 900m), new(2023, 950m), new(2024, 1000m)],
        EpsHistory: [new(2022, 6m), new(2023, 7m), new(2024, 7.5m), new(2025, 8m)]);

    [Fact]
    public void Runs_every_model_for_a_regular_company()
    {
        var r = ValuationEngine.Run(Input("Industrials", Fundamentals()));
        Assert.Equal(6, r.Models.Count);
        Assert.All(r.Models, m => Assert.True(m.Applicable, $"{m.Id}: {m.Note}"));
        Assert.NotNull(r.BlendedFairValue);
        Assert.NotNull(r.Sensitivity);
    }

    [Fact]
    public void Blended_value_is_the_median_of_reliable_models()
    {
        var r = ValuationEngine.Run(Input("Industrials", Fundamentals()));
        var fair = r.Models.Where(m => m is { Applicable: true, Reliable: true }).Select(m => m.FairValue!.Value).Order().ToList();
        Assert.Equal(ValuationModels.Percentile(fair, 0.5m), r.BlendedFairValue);
    }

    [Fact]
    public void Verdict_follows_the_margin_of_safety()
    {
        var f = Fundamentals();
        var cheap = ValuationEngine.Run(Input("Industrials", f, price: 10m));
        var rich = ValuationEngine.Run(Input("Industrials", f, price: 10_000m));
        Assert.Equal(Verdict.Undervalued, cheap.Verdict);
        Assert.Equal(Verdict.Overvalued, rich.Verdict);
    }

    [Fact]
    public void Dcf_is_excluded_for_banks_but_still_shown()
    {
        var r = ValuationEngine.Run(Input("Financial Services", Fundamentals()));
        var dcf = r.Models.Single(m => m.Id == "dcf");
        Assert.True(dcf.Applicable);
        Assert.False(dcf.Reliable);
        Assert.NotNull(dcf.Note);
    }

    [Fact]
    public void Reits_keep_only_dividend_based_models_in_the_blend()
    {
        var r = ValuationEngine.Run(Input("Real Estate", Fundamentals()));
        var reliable = r.Models.Where(m => m is { Applicable: true, Reliable: true }).Select(m => m.Id).Order().ToList();
        Assert.Equal(["ddm", "yield"], reliable);
    }

    [Fact]
    public void Missing_inputs_make_models_unavailable_not_wrong()
    {
        var f = Fundamentals() with { FreeCashFlowTtm = null, FreeCashFlowHistory = [], TrailingEps = null, BookValuePerShare = null };
        var r = ValuationEngine.Run(Input("Industrials", f));
        Assert.False(r.Models.Single(m => m.Id == "dcf").Applicable);
        Assert.False(r.Models.Single(m => m.Id == "graham-number").Applicable);
        Assert.False(r.Models.Single(m => m.Id == "pe").Applicable);
        Assert.True(r.Models.Single(m => m.Id == "ddm").Applicable);
    }

    [Fact]
    public void Overrides_replace_defaults_and_move_the_result()
    {
        var input = Input("Industrials", Fundamentals());
        var baseline = ValuationEngine.Run(input);
        var stricter = ValuationEngine.Run(input, new AssumptionOverrides(DiscountRate: 0.12m, null, null, null, null));
        Assert.Equal(0.12m, stricter.Assumptions.DiscountRate);
        Assert.Equal(baseline.Defaults.DiscountRate, stricter.Defaults.DiscountRate);
        Assert.True(stricter.Models.Single(m => m.Id == "dcf").FairValue < baseline.Models.Single(m => m.Id == "dcf").FairValue);
    }

    [Fact]
    public void Inconsistent_pe_triggers_a_warning()
    {
        var f = Fundamentals() with { TrailingPe = 40m }; // price 100 / EPS 8 = 12.5x, quoted 40x
        Assert.Contains(ValuationEngine.Run(Input("Industrials", f)).Warnings, w => w.Contains("inconsistent"));
    }

    [Fact]
    public void Dividend_models_are_excluded_for_very_low_yield_stocks()
    {
        // 4 per year on a price of 1000 is a 0.4% yield.
        var r = ValuationEngine.Run(Input("Technology", Fundamentals(), price: 1000m));
        Assert.False(r.Models.Single(m => m.Id == "ddm").Reliable);
        Assert.False(r.Models.Single(m => m.Id == "yield").Reliable);
        Assert.True(r.Models.Single(m => m.Id == "dcf").Reliable);
    }

    [Fact]
    public void Default_growth_is_the_median_of_the_signals_not_the_mean()
    {
        // FCF history collapses (-50%/yr) while EPS (+10%/yr) and the analyst estimate (+8%) are fine.
        var f = Fundamentals() with
        {
            FreeCashFlowHistory = [new(2022, 400m), new(2023, 200m), new(2024, 100m)],
            EpsHistory = [new(2022, 5m), new(2023, 5.5m), new(2024, 6.05m)],
            EarningsGrowthNextYear = 0.08m,
        };
        var a = ValuationEngine.DefaultAssumptions(f, new Dictionary<int, decimal>(), 2025);
        Assert.Equal(0.08m, a.Growth);
    }
}
