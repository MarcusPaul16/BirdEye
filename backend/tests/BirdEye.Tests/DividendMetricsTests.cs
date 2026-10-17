using BirdEye.Domain.Investments;
using BirdEye.Domain.MarketData;

namespace BirdEye.Tests;

public class DividendMetricsTests
{
    private static DividendPayment Div(string exDate, decimal amount, string? pay = null) =>
        new(DateOnly.Parse(exDate), pay is null ? null : DateOnly.Parse(pay), amount, "USD");

    [Fact]
    public void Annual_totals_group_by_payment_year_when_known()
    {
        var totals = DividendMetrics.AnnualTotals([Div("2024-12-30", 1m, "2025-01-10"), Div("2025-03-01", 1m), Div("2024-06-01", 2m)]);
        Assert.Equal(2m, totals[2024]);
        Assert.Equal(2m, totals[2025]);
    }

    [Fact]
    public void Trailing_covers_exactly_the_last_twelve_months()
    {
        var today = new DateOnly(2026, 6, 15);
        var ttm = DividendMetrics.TrailingPerShare([Div("2025-06-15", 9m), Div("2025-06-16", 1m), Div("2026-06-15", 2m), Div("2026-06-16", 9m)], today);
        Assert.Equal(3m, ttm);
    }

    [Fact]
    public void Cagr_compounds_over_the_period()
    {
        // 100 -> 121 over 2 years is 10% a year.
        Assert.Equal(10m, Math.Round(DividendMetrics.Cagr(121m, 100m, 2)!.Value, 6));
    }

    [Fact]
    public void Growth_is_null_without_a_positive_base_or_missing_year()
    {
        var totals = new Dictionary<int, decimal> { [2025] = 2m, [2024] = 0m };
        Assert.Null(DividendMetrics.Growth(totals, 2025, 1));
        Assert.Null(DividendMetrics.Growth(totals, 2025, 5));
    }

    [Fact]
    public void Dividend_cut_to_zero_is_minus_100_percent() =>
        Assert.Equal(-100m, DividendMetrics.Cagr(0m, 1m, 1));
}
