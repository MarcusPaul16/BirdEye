namespace BirdEye.Domain.MarketData;

public record Quote(string Symbol, decimal Price, string Currency, DateTimeOffset AsOf);

public record CompanyProfile(
    string Symbol,
    string Name,
    string? Sector,
    string? Industry,
    string? Country,
    string? Website,
    string? Description,
    decimal? DividendYield);

/// <summary>
/// One dividend. <see cref="PaymentDate"/> is what income is booked on; when the vendor only knows the ex-date
/// it is estimated and <see cref="PaymentDateIsEstimate"/> is true.
/// </summary>
public record DividendPayment(DateOnly ExDate, DateOnly? PaymentDate, decimal AmountPerShare, string Currency, bool PaymentDateIsEstimate = false);

public record PricePoint(DateOnly Date, decimal Close);

public record AnnualValue(int Year, decimal Value);

/// <summary>
/// Financial statement figures behind the valuation models. Money amounts are in <see cref="Currency"/>, which can differ from
/// the trading currency (ADRs, dual listings). Anything the data source does not report is null.
/// </summary>
public record CompanyFundamentals(
    string Symbol,
    string? Currency,
    decimal? SharesOutstanding,
    decimal? FreeCashFlowTtm,
    decimal? TotalDebt,
    decimal? TotalCash,
    decimal? TrailingEps,
    decimal? ForwardEps,
    decimal? BookValuePerShare,
    decimal? Beta,
    decimal? EarningsGrowthNextYear,
    decimal? TrailingPe,
    decimal? AnalystTargetPrice,
    IReadOnlyList<AnnualValue> FreeCashFlowHistory,
    IReadOnlyList<AnnualValue> EpsHistory);

public record SymbolMatch(string Symbol, string Name, string? Exchange, string? Type);

/// <summary>Abstraction over the external market-data vendor so the vendor can be swapped without touching the app.</summary>
public interface IMarketDataProvider
{
    Task<Quote> GetQuoteAsync(string symbol, CancellationToken ct = default);
    Task<CompanyProfile> GetProfileAsync(string symbol, CancellationToken ct = default);
    Task<IReadOnlyList<DividendPayment>> GetDividendsAsync(string symbol, CancellationToken ct = default);
    Task<IReadOnlyList<PricePoint>> GetPriceHistoryAsync(string symbol, DateOnly from, DateOnly to, CancellationToken ct = default);
    Task<CompanyFundamentals> GetFundamentalsAsync(string symbol, CancellationToken ct = default);
    Task<IReadOnlyList<SymbolMatch>> SearchAsync(string query, CancellationToken ct = default);
}
