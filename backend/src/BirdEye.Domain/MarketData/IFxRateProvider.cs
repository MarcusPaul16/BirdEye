namespace BirdEye.Domain.MarketData;

public interface IFxRateProvider
{
    /// <summary>Converts via RON using official BNR reference rates.</summary>
    Task<decimal> ConvertAsync(decimal amount, string from, string to, CancellationToken ct = default);
}
