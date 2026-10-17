using BirdEye.Domain.Investments;
using BirdEye.Domain.MarketData;
using BirdEye.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace BirdEye.Api.Controllers;

public record TransactionRequest(
    string Symbol, TransactionType Type, decimal Quantity, decimal Price, decimal Fees, string Currency, DateOnly Date);

[ApiController]
[Route("api/portfolio")]
public class PortfolioController(BirdEyeDbContext db, IMarketDataProvider market, IFxRateProvider fx) : ControllerBase
{
    [HttpGet("transactions")]
    public async Task<IEnumerable<StockTransaction>> Transactions(CancellationToken ct) =>
        await db.StockTransactions.AsNoTracking().OrderByDescending(t => t.Date).ToListAsync(ct);

    [HttpPost("transactions")]
    public async Task<IActionResult> Add(TransactionRequest r, CancellationToken ct)
    {
        var tx = new StockTransaction
        {
            Symbol = r.Symbol.Trim().ToUpperInvariant(), Type = r.Type, Quantity = r.Quantity,
            Price = r.Price, Fees = r.Fees, Currency = r.Currency, Date = r.Date
        };

        var existing = await db.StockTransactions.Where(t => t.Symbol == tx.Symbol).ToListAsync(ct);
        try { PositionCalculator.Calculate(existing.Append(tx)); }
        catch (InvalidOperationException e) { return BadRequest(e.Message); }

        db.StockTransactions.Add(tx);
        await db.SaveChangesAsync(ct);
        return Created($"api/portfolio/transactions/{tx.Id}", tx);
    }

    [HttpDelete("transactions/{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken ct) =>
        await db.StockTransactions.Where(t => t.Id == id).ExecuteDeleteAsync(ct) == 0 ? NotFound() : NoContent();

    /// <summary>Positions with cost basis only (no market data needed).</summary>
    [HttpGet("positions")]
    public async Task<IReadOnlyList<Position>> Positions(CancellationToken ct) =>
        PositionCalculator.Calculate(await db.StockTransactions.AsNoTracking().ToListAsync(ct));

    /// <summary>Positions valued at current price, including dividends received while held. Totals are in USD (BNR rates).</summary>
    [HttpGet("valuation")]
    public async Task<IActionResult> Valuation(CancellationToken ct)
    {
        var txs = await db.StockTransactions.AsNoTracking().ToListAsync(ct);
        var rows = new List<object>();
        decimal totalValueUsd = 0, totalCostUsd = 0, totalReturnUsd = 0;

        foreach (var p in PositionCalculator.Calculate(txs).Where(p => p.Quantity > 0))
        {
            var quote = await market.GetQuoteAsync(p.Symbol, ct);
            var dividends = await market.GetDividendsAsync(p.Symbol, ct);
            var v = p.Value(quote.Price, DividendsReceived(txs.Where(t => t.Symbol == p.Symbol), dividends));

            totalValueUsd += await fx.ConvertAsync(v.MarketValue, quote.Currency, "USD", ct);
            totalCostUsd += await fx.ConvertAsync(p.CostBasis, quote.Currency, "USD", ct);
            totalReturnUsd += await fx.ConvertAsync(v.TotalReturn, quote.Currency, "USD", ct);
            rows.Add(new { currency = quote.Currency, valuation = v });
        }

        return Ok(new
        {
            positions = rows,
            totals = new
            {
                currency = "USD", marketValue = totalValueUsd, costBasis = totalCostUsd, totalReturn = totalReturnUsd,
                totalReturnPercent = totalCostUsd == 0 ? 0 : totalReturnUsd / totalCostUsd * 100m
            }
        });
    }

    /// <summary>
    /// Dividend yield, yield on cost and dividend growth per position and for the whole portfolio. Portfolio figures are in USD
    /// (BNR rates) and growth is like-for-like: current share counts valued at each year's dividend per share and one FX rate,
    /// so it reflects the dividends themselves, not currency moves or purchases.
    /// </summary>
    [HttpGet("dividends")]
    public async Task<IActionResult> DividendMetricsAsync(CancellationToken ct)
    {
        var txs = await db.StockTransactions.AsNoTracking().ToListAsync(ct);
        var today = DateOnly.FromDateTime(DateTime.Today);
        var lastYear = today.Year - 1;
        int[] horizons = [1, 3, 5, 10];

        var rows = new List<object>();
        decimal incomeUsd = 0, valueUsd = 0, costUsd = 0;
        var lastByH = horizons.ToDictionary(h => h, _ => 0m);
        var baseByH = horizons.ToDictionary(h => h, _ => 0m);

        foreach (var p in PositionCalculator.Calculate(txs).Where(p => p.Quantity > 0))
        {
            var quote = await market.GetQuoteAsync(p.Symbol, ct);
            var divs = await market.GetDividendsAsync(p.Symbol, ct);
            var usd = await fx.ConvertAsync(1m, quote.Currency, "USD", ct);

            var perShare = DividendMetrics.TrailingPerShare(divs, today);
            var totals = DividendMetrics.AnnualTotals(divs);
            var income = p.Quantity * perShare;

            incomeUsd += income * usd;
            valueUsd += p.Quantity * quote.Price * usd;
            costUsd += p.CostBasis * usd;

            foreach (var h in horizons)
            {
                if (!totals.TryGetValue(lastYear - h, out var b) || b <= 0) continue;
                lastByH[h] += p.Quantity * totals.GetValueOrDefault(lastYear) * usd;
                baseByH[h] += p.Quantity * b * usd;
            }

            rows.Add(new
            {
                p.Symbol, currency = quote.Currency, p.Quantity, price = quote.Price, averageCost = p.AverageCost,
                dividendPerShare = perShare, annualIncome = income,
                yield = quote.Price == 0 ? 0 : perShare / quote.Price * 100m,
                yieldOnCost = p.AverageCost == 0 ? 0 : perShare / p.AverageCost * 100m,
                growth = GrowthOf(h => DividendMetrics.Growth(totals, lastYear, h))
            });
        }

        return Ok(new
        {
            currency = "USD",
            positions = rows,
            totals = new
            {
                annualIncome = incomeUsd,
                yield = valueUsd == 0 ? 0 : incomeUsd / valueUsd * 100m,
                yieldOnCost = costUsd == 0 ? 0 : incomeUsd / costUsd * 100m,
                growth = GrowthOf(h => DividendMetrics.Cagr(lastByH[h], baseByH[h], h)),
                growthYear = lastYear
            }
        });

        object GrowthOf(Func<int, decimal?> f) => new { yoy = f(1), cagr3 = f(3), cagr5 = f(5), cagr10 = f(10) };
    }

    /// <summary>
    /// How the portfolio is spread over positions, sectors, countries and currencies, weighted by market value (USD at BNR rates).
    /// Sector and country come from the company profile; ETFs and anything the data source cannot classify are "Unclassified".
    /// </summary>
    [HttpGet("diversification")]
    public async Task<IActionResult> Diversification(CancellationToken ct)
    {
        var txs = await db.StockTransactions.AsNoTracking().ToListAsync(ct);
        var rows = new List<(string Symbol, string Sector, string Country, string Currency, decimal Value)>();

        foreach (var p in PositionCalculator.Calculate(txs).Where(p => p.Quantity > 0))
        {
            var quote = await market.GetQuoteAsync(p.Symbol, ct);
            var value = await fx.ConvertAsync(p.Quantity * quote.Price, quote.Currency, "USD", ct);

            string sector = "Unclassified", country = "Unclassified";
            try
            {
                var profile = await market.GetProfileAsync(p.Symbol, ct);
                sector = string.IsNullOrWhiteSpace(profile.Sector) ? sector : profile.Sector;
                country = string.IsNullOrWhiteSpace(profile.Country) ? country : profile.Country;
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                // Funds and some listings have no company profile; they stay unclassified instead of failing the whole view.
            }
            rows.Add((p.Symbol, sector, country, quote.Currency, value));
        }

        var total = rows.Sum(r => r.Value);
        var byPosition = DiversificationMetrics.Group(rows.Select(r => (r.Symbol, r.Value)));
        var weights = byPosition.Select(s => s.WeightPercent / 100m).ToList();
        var hhi = DiversificationMetrics.Hhi(weights);

        return Ok(new
        {
            currency = "USD",
            totalValue = total,
            holdings = rows.Count,
            largestPosition = byPosition.FirstOrDefault(),
            top3Percent = byPosition.Take(3).Sum(s => s.WeightPercent),
            effectiveHoldings = DiversificationMetrics.EffectiveHoldings(hhi),
            byPosition,
            bySector = DiversificationMetrics.Group(rows.Select(r => (r.Sector, r.Value))),
            byCountry = DiversificationMetrics.Group(rows.Select(r => (r.Country, r.Value))),
            byCurrency = DiversificationMetrics.Group(rows.Select(r => (r.Currency, r.Value)))
        });
    }

    private static decimal DividendsReceived(IEnumerable<StockTransaction> txs, IEnumerable<DividendPayment> dividends)
    {
        var list = txs.OrderBy(t => t.Date).ToList();
        return dividends.Sum(d =>
        {
            var held = list.Where(t => t.Date < d.ExDate).Sum(t => t.Type == TransactionType.Buy ? t.Quantity : -t.Quantity);
            return held > 0 ? held * d.AmountPerShare : 0m;
        });
    }
}
