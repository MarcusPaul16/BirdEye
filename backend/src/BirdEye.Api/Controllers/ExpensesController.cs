using BirdEye.Domain.Expenses;
using BirdEye.Domain.Investments;
using BirdEye.Domain.MarketData;
using BirdEye.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace BirdEye.Api.Controllers;

public record ExpenseRequest(string Name, ExpenseCategory Category, decimal Amount, string Currency, DateOnly Date, Recurrence Recurrence, DateOnly? EndDate);

[ApiController]
[Route("api/expenses")]
public class ExpensesController(BirdEyeDbContext db, IFxRateProvider fx) : ControllerBase
{
    [HttpGet]
    public async Task<IEnumerable<Expense>> List(CancellationToken ct) =>
        await db.Expenses.AsNoTracking().OrderByDescending(e => e.Date).ThenBy(e => e.Name).ToListAsync(ct);

    /// <summary>The recurring expenses with what each costs per month on average (RON, today's BNR rate) and whether it is still running.</summary>
    [HttpGet("recurring")]
    public async Task<IActionResult> Recurring(CancellationToken ct)
    {
        var today = DateOnly.FromDateTime(DateTime.Today);
        var recurring = (await db.Expenses.AsNoTracking().ToListAsync(ct)).Where(e => e.IsRecurring).ToList();
        var rates = new Dictionary<string, decimal>();
        foreach (var currency in recurring.Select(e => e.Currency.ToUpperInvariant()).Distinct())
            rates[currency] = await fx.ConvertAsync(1m, currency, "RON", ct);

        var items = recurring
            .Select(e => new
            {
                e.Id, e.Name, category = e.Category, e.Amount, currency = e.Currency.ToUpperInvariant(), recurrence = e.Recurrence,
                since = e.Date, endDate = e.EndDate, active = e.EndDate is null || e.EndDate >= today,
                monthlyRon = ExpenseSchedule.MonthlyEquivalent(e) * rates[e.Currency.ToUpperInvariant()]
            })
            .OrderByDescending(i => i.active).ThenByDescending(i => i.monthlyRon)
            .ToList();
        return Ok(new { currency = "RON", items, activeMonthlyRon = items.Where(i => i.active).Sum(i => i.monthlyRon) });
    }

    [HttpPost]
    public async Task<IActionResult> Create(ExpenseRequest r, CancellationToken ct)
    {
        if (Validate(r) is { } problem) return BadRequest(problem);
        var expense = new Expense { Name = "" };
        Apply(expense, r);
        db.Expenses.Add(expense);
        await db.SaveChangesAsync(ct);
        return Created($"api/expenses/{expense.Id}", expense);
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, ExpenseRequest r, CancellationToken ct)
    {
        if (Validate(r) is { } problem) return BadRequest(problem);
        var expense = await db.Expenses.FirstOrDefaultAsync(e => e.Id == id, ct);
        if (expense is null) return NotFound();
        Apply(expense, r);
        await db.SaveChangesAsync(ct);
        return Ok(expense);
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken ct) =>
        await db.Expenses.Where(e => e.Id == id).ExecuteDeleteAsync(ct) == 0 ? NotFound() : NoContent();

    /// <summary>
    /// One month of spending (everything that occurs in it, converted to RON at today's BNR rate), split by category, next to the recurring
    /// run-rate and the twelve months up to and including it.
    /// </summary>
    [HttpGet("summary")]
    public async Task<IActionResult> Summary(string? month, CancellationToken ct)
    {
        var today = DateOnly.FromDateTime(DateTime.Today);
        var (year, mon) = ParseMonth(month) ?? (today.Year, today.Month);

        var expenses = await db.Expenses.AsNoTracking().ToListAsync(ct);
        var rates = new Dictionary<string, decimal>();
        foreach (var currency in expenses.Select(e => e.Currency.ToUpperInvariant()).Distinct())
            rates[currency] = await fx.ConvertAsync(1m, currency, "RON", ct);
        decimal Ron(Expense e, decimal amount) => amount * rates[e.Currency.ToUpperInvariant()];

        var items = expenses
            .Select(e => (e, date: ExpenseSchedule.OccurrenceIn(e, year, mon)))
            .Where(x => x.date is not null)
            .OrderBy(x => x.date).ThenBy(x => x.e.Name)
            .Select(x => new
            {
                x.e.Id, x.e.Name, category = x.e.Category, date = x.date, amount = x.e.Amount, currency = x.e.Currency.ToUpperInvariant(),
                amountRon = Ron(x.e, x.e.Amount), recurrence = x.e.Recurrence, recurring = x.e.IsRecurring, endDate = x.e.EndDate
            })
            .ToList();

        var series = Enumerable.Range(-11, 12).Select(offset =>
        {
            var d = new DateOnly(year, mon, 1).AddMonths(offset);
            var occurring = expenses.Where(e => ExpenseSchedule.OccurrenceIn(e, d.Year, d.Month) is not null).ToList();
            var recurring = occurring.Where(e => e.IsRecurring).Sum(e => Ron(e, e.Amount));
            var oneTime = occurring.Where(e => !e.IsRecurring).Sum(e => Ron(e, e.Amount));
            return new { month = $"{d.Year}-{d.Month:00}", total = recurring + oneTime, recurring, oneTime };
        }).ToList();

        var recurringTotal = items.Where(i => i.recurring).Sum(i => i.amountRon);
        return Ok(new
        {
            currency = "RON",
            month = $"{year}-{mon:00}",
            items,
            total = items.Sum(i => i.amountRon),
            recurringTotal,
            oneTimeTotal = items.Where(i => !i.recurring).Sum(i => i.amountRon),
            // What the recurring commitments cost per month on average (quarterly and yearly bills spread out), for those still running.
            fixedMonthly = expenses.Where(e => ExpenseSchedule.IsActiveIn(e, year, mon)).Sum(e => Ron(e, ExpenseSchedule.MonthlyEquivalent(e))),
            byCategory = DiversificationMetrics.Group(items.Select(i => (i.category.ToString(), i.amountRon))),
            series,
            average12 = series.Average(s => s.total),
        });
    }

    private static (int Year, int Month)? ParseMonth(string? month) =>
        month is { Length: 7 } && month[4] == '-' && int.TryParse(month[..4], out var y) && int.TryParse(month[5..], out var m) && m is >= 1 and <= 12 && y is >= 2000 and <= 2100
            ? (y, m) : null;

    private static string? Validate(ExpenseRequest r)
    {
        if (string.IsNullOrWhiteSpace(r.Name)) return "Give the expense a name.";
        if (r.Amount <= 0) return "The amount must be greater than zero.";
        if (r.Currency is not { Length: 3 }) return "The currency must be a three-letter code such as RON.";
        if (r.Recurrence != Recurrence.OneTime && r.EndDate is { } end && end < r.Date) return "The end date cannot be before the start date.";
        return null;
    }

    private static void Apply(Expense e, ExpenseRequest r)
    {
        e.Name = r.Name.Trim();
        e.Category = r.Category;
        e.Amount = r.Amount;
        e.Currency = r.Currency.ToUpperInvariant();
        e.Date = r.Date;
        e.Recurrence = r.Recurrence;
        e.EndDate = r.Recurrence == Recurrence.OneTime ? null : r.EndDate;
    }
}
