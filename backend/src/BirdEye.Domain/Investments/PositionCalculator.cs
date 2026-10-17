namespace BirdEye.Domain.Investments;

public static class PositionCalculator
{
    /// <summary>Builds positions using the average-cost method. Fees are added to buy cost and subtracted from sell proceeds.</summary>
    public static IReadOnlyList<Position> Calculate(IEnumerable<StockTransaction> transactions) =>
        transactions
            .GroupBy(t => t.Symbol, StringComparer.OrdinalIgnoreCase)
            .Select(g => ForSymbol(g.Key.ToUpperInvariant(), g))
            .Where(p => p.Quantity > 0 || p.RealizedGain != 0)
            .OrderBy(p => p.Symbol)
            .ToList();

    private static Position ForSymbol(string symbol, IEnumerable<StockTransaction> transactions)
    {
        decimal quantity = 0, costBasis = 0, realized = 0;

        foreach (var t in transactions.OrderBy(t => t.Date).ThenBy(t => t.Id))
        {
            if (t.Type == TransactionType.Buy)
            {
                quantity += t.Quantity;
                costBasis += t.Quantity * t.Price + t.Fees;
                continue;
            }

            if (t.Quantity > quantity)
                throw new InvalidOperationException($"Cannot sell {t.Quantity} {symbol} on {t.Date}; only {quantity} held.");

            var avg = costBasis / quantity;
            realized += t.Quantity * t.Price - t.Fees - t.Quantity * avg;
            quantity -= t.Quantity;
            costBasis -= t.Quantity * avg;
        }

        return new Position(symbol, quantity, quantity == 0 ? 0 : costBasis / quantity, costBasis, realized);
    }
}
