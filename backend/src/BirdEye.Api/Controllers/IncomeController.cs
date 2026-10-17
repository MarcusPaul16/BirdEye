using BirdEye.Domain.Income;
using BirdEye.Domain.Investments;
using BirdEye.Domain.MarketData;
using BirdEye.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace BirdEye.Api.Controllers;

public record IncomeRequest(
    int PersonId, string Name, IncomeType Type, decimal Amount, string Currency,
    IncomeFrequency Frequency);

[ApiController]
[Route("api/income")]
public class IncomeController(BirdEyeDbContext db, IFxRateProvider fx, IMarketDataProvider market, IConfiguration config) : ControllerBase
{
    [HttpGet]
    public async Task<IEnumerable<IncomeSource>> List(int? personId, CancellationToken ct) =>
        await db.IncomeSources.AsNoTracking()
            .Where(i => personId == null || i.PersonId == personId)
            .OrderBy(i => i.PersonId).ThenBy(i => i.Name)
            .ToListAsync(ct);

    /// <summary>Monthly income per person and for the household, converted to RON at BNR rates.</summary>
    [HttpGet("summary")]
    public async Task<IActionResult> Summary(CancellationToken ct)
    {
        var sources = await db.IncomeSources.AsNoTracking().Include(i => i.Person).ToListAsync(ct);

        var converted = new List<(int PersonId, string Person, decimal Ron)>();
        foreach (var i in sources)
            converted.Add((i.PersonId, i.Person!.Name, await fx.ConvertAsync(i.MonthlyEquivalent, i.Currency, "RON", ct)));

        var dividends = await PortfolioDividendsAsync(ct);

        return Ok(new
        {
            currency = "RON",
            householdMonthly = converted.Sum(c => c.Ron) + dividends.Monthly,
            perPerson = converted.GroupBy(c => new { c.PersonId, c.Person })
                .Select(g => new { g.Key.PersonId, person = g.Key.Person, monthly = g.Sum(c => c.Ron) }),
            dividends = new
            {
                available = dividends.Error is null, error = dividends.Error, taxRate = dividends.TaxRate,
                grossMonthly = dividends.GrossMonthly, monthly = dividends.Monthly, holdings = dividends.Holdings
            }
        });
    }

    private record DividendHolding(string Symbol, decimal Quantity, decimal DividendPerShare, string Currency, decimal GrossMonthly, decimal Monthly);
    private record PortfolioDividends(decimal GrossMonthly, decimal Monthly, decimal TaxRate, IReadOnlyList<DividendHolding> Holdings, string? Error);

    /// <summary>
    /// Run-rate dividend income from the current holdings: shares held now x dividends per share paid over the last 12 months,
    /// converted to RON, then reduced by the dividend tax rate (Taxes:DividendRate). A market-data outage must not break the rest of the income page, so it is reported, not thrown.
    /// </summary>
    private async Task<PortfolioDividends> PortfolioDividendsAsync(CancellationToken ct)
    {
        var taxRate = config.GetValue("Taxes:DividendRate", 0.16m);
        try
        {
            var positions = PositionCalculator.Calculate(await db.StockTransactions.AsNoTracking().ToListAsync(ct))
                .Where(p => p.Quantity > 0);
            var today = DateOnly.FromDateTime(DateTime.Today);
            var from = today.AddYears(-1);
            var holdings = new List<DividendHolding>();

            foreach (var p in positions)
            {
                var paid = (await market.GetDividendsAsync(p.Symbol, ct)).Where(d => d.ExDate > from && d.ExDate <= today).ToList();
                if (paid.Count == 0) continue;

                var perShare = paid.Sum(d => d.AmountPerShare);
                var currency = paid[0].Currency;
                var annualRon = await fx.ConvertAsync(p.Quantity * perShare, currency, "RON", ct);
                var gross = annualRon / 12m;
                holdings.Add(new DividendHolding(p.Symbol, p.Quantity, perShare, currency, gross, gross * (1 - taxRate)));
            }
            return new PortfolioDividends(holdings.Sum(h => h.GrossMonthly), holdings.Sum(h => h.Monthly), taxRate, holdings, null);
        }
        catch (Exception e) when (e is HttpRequestException or KeyNotFoundException or NotSupportedException)
        {
            return new PortfolioDividends(0m, 0m, taxRate, [], e.Message);
        }
    }

    [HttpPost]
    public async Task<IActionResult> Create(IncomeRequest r, CancellationToken ct)
    {
        if (!await db.People.AnyAsync(p => p.Id == r.PersonId, ct)) return BadRequest("Unknown person.");
        var src = new IncomeSource
        {
            PersonId = r.PersonId, Name = r.Name, Type = r.Type, Amount = r.Amount,
            Currency = r.Currency, Frequency = r.Frequency
        };
        db.IncomeSources.Add(src);
        await db.SaveChangesAsync(ct);
        return Created($"api/income/{src.Id}", src);
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, IncomeRequest r, CancellationToken ct)
    {
        var src = await db.IncomeSources.FirstOrDefaultAsync(i => i.Id == id, ct);
        if (src is null) return NotFound();
        (src.PersonId, src.Name, src.Type, src.Amount, src.Currency, src.Frequency) =
            (r.PersonId, r.Name, r.Type, r.Amount, r.Currency, r.Frequency);
        await db.SaveChangesAsync(ct);
        return Ok(src);
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken ct) =>
        await db.IncomeSources.Where(i => i.Id == id).ExecuteDeleteAsync(ct) == 0 ? NotFound() : NoContent();
}
