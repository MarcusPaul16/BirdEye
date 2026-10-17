namespace BirdEye.Domain.Investments;

/// <summary>Aggregated holding for one symbol, derived from its transactions (average-cost method).</summary>
public record Position(
    string Symbol,
    decimal Quantity,
    decimal AverageCost,
    decimal CostBasis,
    decimal RealizedGain)
{
    public PositionValuation Value(decimal currentPrice, decimal dividendsReceived = 0m)
    {
        var marketValue = Quantity * currentPrice;
        var unrealized = marketValue - CostBasis;
        var totalReturn = unrealized + RealizedGain + dividendsReceived;
        var returnPct = CostBasis == 0 ? 0 : totalReturn / CostBasis * 100m;
        return new PositionValuation(this, currentPrice, marketValue, unrealized, dividendsReceived, totalReturn, returnPct);
    }
}

public record PositionValuation(
    Position Position,
    decimal CurrentPrice,
    decimal MarketValue,
    decimal UnrealizedGain,
    decimal DividendsReceived,
    decimal TotalReturn,
    decimal TotalReturnPercent);
