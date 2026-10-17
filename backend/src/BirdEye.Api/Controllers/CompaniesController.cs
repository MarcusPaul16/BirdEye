using BirdEye.Domain.MarketData;
using Microsoft.AspNetCore.Mvc;

namespace BirdEye.Api.Controllers;

[ApiController]
[Route("api/companies/{symbol}")]
public class CompaniesController(IMarketDataProvider market) : ControllerBase
{
    [HttpGet]
    public Task<CompanyProfile> Profile(string symbol, CancellationToken ct) => market.GetProfileAsync(symbol, ct);

    [HttpGet("quote")]
    public Task<Quote> Quote(string symbol, CancellationToken ct) => market.GetQuoteAsync(symbol, ct);

    [HttpGet("dividends")]
    public Task<IReadOnlyList<DividendPayment>> Dividends(string symbol, CancellationToken ct) => market.GetDividendsAsync(symbol, ct);

    [HttpGet("history")]
    public Task<IReadOnlyList<PricePoint>> History(string symbol, DateOnly? from, DateOnly? to, CancellationToken ct) =>
        market.GetPriceHistoryAsync(symbol, from ?? DateOnly.FromDateTime(DateTime.Today.AddYears(-5)), to ?? DateOnly.FromDateTime(DateTime.Today), ct);
}
