using BirdEye.Domain.Investments;

namespace BirdEye.Tests;

public class DiversificationMetricsTests
{
    [Fact]
    public void Group_sums_sorts_and_weights()
    {
        var slices = DiversificationMetrics.Group([("Tech", 300m), ("Energy", 100m), ("Tech", 100m), ("Health", 500m)]);
        Assert.Equal(["Health", "Tech", "Energy"], slices.Select(s => s.Label));
        Assert.Equal([50m, 40m, 10m], slices.Select(s => s.WeightPercent));
        Assert.Equal(100m, slices.Sum(s => s.WeightPercent));
    }

    [Fact]
    public void Four_equal_holdings_behave_like_four_holdings()
    {
        var hhi = DiversificationMetrics.Hhi([.25m, .25m, .25m, .25m]);
        Assert.Equal(.25m, hhi);
        Assert.Equal(4m, DiversificationMetrics.EffectiveHoldings(hhi));
    }

    [Fact]
    public void One_dominant_holding_means_low_effective_count() =>
        Assert.True(DiversificationMetrics.EffectiveHoldings(DiversificationMetrics.Hhi([.9m, .05m, .05m])) < 1.25m);

    [Fact]
    public void Empty_portfolio_is_safe()
    {
        Assert.Empty(DiversificationMetrics.Group([]));
        Assert.Equal(0m, DiversificationMetrics.EffectiveHoldings(0m));
    }
}
