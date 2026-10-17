using BirdEye.Domain.MarketData;
using BirdEye.Domain.Valuation;
using Microsoft.AspNetCore.Mvc;

namespace BirdEye.Api.Controllers;

[ApiController]
[Route("api/valuation/{symbol}")]
public class ValuationController(IMarketDataProvider market, IFxRateProvider fx) : ControllerBase
{
    /// <summary>
    /// Runs every valuation model for a company. Assumption overrides are percentages (8.5 = 8.5%); anything omitted uses the
    /// defaults derived from the company's own data, which the response also returns so the UI can show what was assumed.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> Get(
        string symbol, decimal? discountRate, decimal? terminalGrowth, decimal? growth, decimal? dividendGrowth, decimal? bondYield, CancellationToken ct)
    {
        var quote = await market.GetQuoteAsync(symbol, ct);
        var fundamentals = await market.GetFundamentalsAsync(symbol, ct);
        var dividends = await market.GetDividendsAsync(symbol, ct);
        var today = DateOnly.FromDateTime(DateTime.Today);
        var prices = await market.GetPriceHistoryAsync(symbol, new DateOnly(1970, 1, 1), today, ct);

        string? name = null, sector = null;
        try
        {
            var profile = await market.GetProfileAsync(symbol, ct);
            (name, sector) = (profile.Name, profile.Sector);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            // Funds have no company profile; the models still run, just without sector-based reliability rules.
        }

        var extraWarnings = new List<string>();
        if (fundamentals.Currency is { } statementCurrency && !statementCurrency.Equals(quote.Currency, StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                fundamentals = ToCurrency(fundamentals, await fx.ConvertAsync(1m, statementCurrency, quote.Currency, ct));
                extraWarnings.Add($"Financial statements are reported in {statementCurrency}; figures were converted to {quote.Currency} at today's BNR rate.");
            }
            catch (NotSupportedException)
            {
                extraWarnings.Add($"Financial statements are in {statementCurrency}, which cannot be converted to {quote.Currency}; per-share models may be off.");
            }
        }

        var report = ValuationEngine.Run(
            new ValuationInput(quote.Symbol, quote.Price, quote.Currency, sector, fundamentals, dividends, prices, today),
            new AssumptionOverrides(Fraction(discountRate), Fraction(terminalGrowth), Fraction(growth), Fraction(dividendGrowth), Fraction(bondYield)));

        return Ok(new { name = name ?? quote.Symbol, sector, report = report with { Warnings = [.. extraWarnings, .. report.Warnings] } });
    }

    private static decimal? Fraction(decimal? percent) => percent / 100m;

    private static CompanyFundamentals ToCurrency(CompanyFundamentals f, decimal rate) => f with
    {
        Currency = null,
        FreeCashFlowTtm = f.FreeCashFlowTtm * rate,
        TotalDebt = f.TotalDebt * rate,
        TotalCash = f.TotalCash * rate,
        TrailingEps = f.TrailingEps * rate,
        ForwardEps = f.ForwardEps * rate,
        BookValuePerShare = f.BookValuePerShare * rate,
        FreeCashFlowHistory = f.FreeCashFlowHistory.Select(a => a with { Value = a.Value * rate }).ToList(),
        EpsHistory = f.EpsHistory.Select(a => a with { Value = a.Value * rate }).ToList(),
    };
}
