using BirdEye.Domain.MarketData;
using Microsoft.AspNetCore.Mvc;

namespace BirdEye.Api.Controllers;

[ApiController]
[Route("api/company-search")]
public class CompanySearchController(IMarketDataProvider market) : ControllerBase
{
    /// <summary>Finds tickers by company name or partial symbol (e.g. "legal and general" -> LGEN.L).</summary>
    [HttpGet]
    public async Task<IReadOnlyList<SymbolMatch>> Search(string q, CancellationToken ct) =>
        string.IsNullOrWhiteSpace(q) ? [] : await market.SearchAsync(q.Trim(), ct);
}
