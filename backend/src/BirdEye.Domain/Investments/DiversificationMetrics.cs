namespace BirdEye.Domain.Investments;

public record Slice(string Label, decimal Value, decimal WeightPercent);

public static class DiversificationMetrics
{
    /// <summary>Sums values per label, largest first, with each label's share of the total in percent.</summary>
    public static IReadOnlyList<Slice> Group(IEnumerable<(string Label, decimal Value)> items)
    {
        var grouped = items.GroupBy(i => i.Label).Select(g => (Label: g.Key, Value: g.Sum(i => i.Value))).ToList();
        var total = grouped.Sum(g => g.Value);
        return grouped
            .OrderByDescending(g => g.Value).ThenBy(g => g.Label)
            .Select(g => new Slice(g.Label, g.Value, total == 0 ? 0 : g.Value / total * 100m))
            .ToList();
    }

    /// <summary>Herfindahl-Hirschman index of position weights (fractions summing to 1): 1 = one holding, 1/n = n equal holdings.</summary>
    public static decimal Hhi(IEnumerable<decimal> weights) => weights.Sum(w => w * w);

    /// <summary>How many equally sized holdings would give the same concentration (1 / HHI).</summary>
    public static decimal EffectiveHoldings(decimal hhi) => hhi == 0 ? 0 : 1m / hhi;
}
