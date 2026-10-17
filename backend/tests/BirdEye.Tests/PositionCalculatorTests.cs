using BirdEye.Domain.Investments;

namespace BirdEye.Tests;

public class PositionCalculatorTests
{
    private static StockTransaction Tx(TransactionType type, decimal qty, decimal price, int day, decimal fees = 0) =>
        new() { Symbol = "AAPL", Type = type, Quantity = qty, Price = price, Fees = fees, Date = new DateOnly(2025, 1, day), Id = day };

    [Fact]
    public void Buys_produce_average_cost()
    {
        var p = Assert.Single(PositionCalculator.Calculate([Tx(TransactionType.Buy, 10, 100, 1), Tx(TransactionType.Buy, 10, 200, 2)]));
        Assert.Equal(20, p.Quantity);
        Assert.Equal(150, p.AverageCost);
        Assert.Equal(3000, p.CostBasis);
    }

    [Fact]
    public void Sell_realizes_gain_against_average_cost()
    {
        var p = Assert.Single(PositionCalculator.Calculate([Tx(TransactionType.Buy, 10, 100, 1), Tx(TransactionType.Sell, 4, 150, 2)]));
        Assert.Equal(6, p.Quantity);
        Assert.Equal(200, p.RealizedGain);
        Assert.Equal(600, p.CostBasis);
    }

    [Fact]
    public void Selling_more_than_held_throws() =>
        Assert.Throws<InvalidOperationException>(() => PositionCalculator.Calculate([Tx(TransactionType.Sell, 1, 100, 1)]));

    [Fact]
    public void Valuation_includes_dividends_in_total_return()
    {
        var p = Assert.Single(PositionCalculator.Calculate([Tx(TransactionType.Buy, 10, 100, 1)]));
        var v = p.Value(currentPrice: 110, dividendsReceived: 20);
        Assert.Equal(1100, v.MarketValue);
        Assert.Equal(120, v.TotalReturn);
        Assert.Equal(12, v.TotalReturnPercent);
    }
}
