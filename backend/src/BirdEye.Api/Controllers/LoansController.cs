using BirdEye.Domain.Loans;
using BirdEye.Domain.MarketData;
using BirdEye.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace BirdEye.Api.Controllers;

public record LoanRequest(string Name, decimal Principal, string Currency, decimal AnnualRatePercent, DateOnly StartDate, int Months, decimal EarlyRepaymentFeePercent);
public record EarlyRepaymentRequest(decimal Amount, DateOnly? When);
public record ExtraMonthlyRequest(decimal ExtraPerMonth);
public record StrategyRequest(decimal ExtraPerMonth);
public record PaymentRequest(DateOnly Date, decimal Amount, string? Note);

[ApiController]
[Route("api/loans")]
public class LoansController(BirdEyeDbContext db, IFxRateProvider fx) : ControllerBase
{
    private static DateOnly Today => DateOnly.FromDateTime(DateTime.Today);

    /// <summary>The loans with where each stands today, and the totals in RON at today's BNR rate.</summary>
    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct)
    {
        var loans = await db.Loans.AsNoTracking().OrderBy(l => l.Name).ToListAsync(ct);
        var paymentsByLoan = await PaymentsByLoan(ct);
        var today = Today;
        var rows = new List<object>();
        decimal balanceRon = 0, paymentRon = 0, interestRon = 0;
        (string Name, DateOnly Date, decimal AmountRon)? next = null;

        foreach (var l in loans)
        {
            var status = LoanMath.Status(l, Of(paymentsByLoan, l.Id), today);
            var payment = LoanMath.Payment(l.Principal, l.AnnualRatePercent, l.Months);
            var rate = await fx.ConvertAsync(1m, l.Currency, "RON", ct);
            if (!status.Finished)
            {
                balanceRon += status.Balance * rate;
                paymentRon += payment * rate;
                interestRon += status.RemainingInterest * rate;
                if (status.Next is { } n && (next is null || n.Date < next.Value.Date)) next = (l.Name, n.Date, n.Payment * rate);
            }
            rows.Add(new
            {
                l.Id, l.Name, l.Principal, currency = l.Currency.ToUpperInvariant(), l.AnnualRatePercent, l.StartDate, l.Months, l.EarlyRepaymentFeePercent,
                payment, status,
                paidPercent = l.Principal == 0 ? 0 : (l.Principal - status.Balance) / l.Principal * 100m,
                paymentCount = Of(paymentsByLoan, l.Id).Count,
            });
        }

        return Ok(new
        {
            currency = "RON", today, loans = rows,
            totals = new { balanceRon, monthlyPaymentRon = paymentRon, remainingInterestRon = interestRon, next = next is null ? null : new { next.Value.Name, next.Value.Date, next.Value.AmountRon } },
        });
    }

    [HttpPost]
    public async Task<IActionResult> Create(LoanRequest r, CancellationToken ct)
    {
        if (Validate(r) is { } problem) return BadRequest(new { error = problem });
        var loan = new Loan { Name = "" };
        Apply(loan, r);
        db.Loans.Add(loan);
        await db.SaveChangesAsync(ct);
        return Created($"api/loans/{loan.Id}", new { loan.Id });
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, LoanRequest r, CancellationToken ct)
    {
        if (Validate(r) is { } problem) return BadRequest(new { error = problem });
        var loan = await db.Loans.FirstOrDefaultAsync(l => l.Id == id, ct);
        if (loan is null) return NotFound();
        Apply(loan, r);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken ct) =>
        await db.Loans.Where(l => l.Id == id).ExecuteDeleteAsync(ct) == 0 ? NotFound() : NoContent();

    /// <summary>The full amortisation schedule, each instalment marked as paid or not as of today.</summary>
    [HttpGet("{id:int}/schedule")]
    public async Task<IActionResult> Schedule(int id, CancellationToken ct)
    {
        var loan = await db.Loans.AsNoTracking().FirstOrDefaultAsync(l => l.Id == id, ct);
        if (loan is null) return NotFound();
        var today = Today;
        var payments = (await PaymentsByLoan(ct, id)).GetValueOrDefault(id) ?? [];
        // With recorded payments the history is the payments list; the schedule then shows what is still ahead, worked out from the real balance.
        var pos = LoanMath.Position(loan, payments, today);
        var rows = pos.Tracked ? pos.Remaining.Select(i => new { i.Number, i.Date, i.Payment, i.Interest, i.Principal, i.Balance, paid = false })
                               : LoanMath.Schedule(loan).Select(i => new { i.Number, i.Date, i.Payment, i.Interest, i.Principal, i.Balance, paid = i.Date <= today });
        return Ok(new { today, tracked = pos.Tracked, installments = rows });
    }

    /// <summary>The payments made towards a loan, newest first.</summary>
    [HttpGet("{id:int}/payments")]
    public async Task<IActionResult> Payments(int id, CancellationToken ct)
    {
        if (!await db.Loans.AnyAsync(l => l.Id == id, ct)) return NotFound();
        var rows = await db.LoanPayments.AsNoTracking().Where(p => p.LoanId == id).OrderByDescending(p => p.Date).ThenByDescending(p => p.Id)
            .Select(p => new { p.Id, p.Date, p.Amount, p.Note }).ToListAsync(ct);
        return Ok(new { payments = rows, total = rows.Sum(r => r.Amount) });
    }

    /// <summary>Records a payment made towards a loan.</summary>
    [HttpPost("{id:int}/payments")]
    public async Task<IActionResult> AddPayment(int id, PaymentRequest r, CancellationToken ct)
    {
        var loan = await db.Loans.AsNoTracking().FirstOrDefaultAsync(l => l.Id == id, ct);
        if (loan is null) return NotFound();
        if (r.Amount <= 0) return BadRequest(new { error = "The amount must be greater than zero." });
        if (r.Date < loan.StartDate) return BadRequest(new { error = "A payment cannot come before the loan started." });
        if (r.Date > Today) return BadRequest(new { error = "A payment cannot be in the future." });
        if (r.Note is { Length: > 200 }) return BadRequest(new { error = "The note is too long." });
        var payment = new LoanPayment { LoanId = id, Date = r.Date, Amount = r.Amount, Note = string.IsNullOrWhiteSpace(r.Note) ? null : r.Note.Trim() };
        db.LoanPayments.Add(payment);
        await db.SaveChangesAsync(ct);
        return Created($"api/loans/{id}/payments/{payment.Id}", new { payment.Id });
    }

    [HttpDelete("{id:int}/payments/{paymentId:int}")]
    public async Task<IActionResult> DeletePayment(int id, int paymentId, CancellationToken ct) =>
        await db.LoanPayments.Where(p => p.LoanId == id && p.Id == paymentId).ExecuteDeleteAsync(ct) == 0 ? NotFound() : NoContent();

    /// <summary>
    /// Records every instalment that has fallen due so far as paid, on its date. A shortcut for a loan that has been running for a while and has
    /// been paid as agreed; only allowed while no payment is recorded, so it can never double up.
    /// </summary>
    [HttpPost("{id:int}/payments/scheduled")]
    public async Task<IActionResult> RecordScheduled(int id, CancellationToken ct)
    {
        var loan = await db.Loans.AsNoTracking().FirstOrDefaultAsync(l => l.Id == id, ct);
        if (loan is null) return NotFound();
        if (await db.LoanPayments.AnyAsync(p => p.LoanId == id, ct)) return BadRequest(new { error = "This loan already has payments recorded." });
        var due = LoanMath.Schedule(loan).Where(i => i.Date <= Today).ToList();
        if (due.Count == 0) return BadRequest(new { error = "No instalment has fallen due yet." });
        db.LoanPayments.AddRange(due.Select(i => new LoanPayment { LoanId = id, Date = i.Date, Amount = i.Payment, Note = $"Instalment {i.Number}" }));
        await db.SaveChangesAsync(ct);
        return Ok(new { recorded = due.Count });
    }

    /// <summary>A lump sum repaid early, both ways at once: keep the instalment and finish sooner, or keep the end date and pay less each month.</summary>
    [HttpPost("{id:int}/early-repayment")]
    public async Task<IActionResult> EarlyRepayment(int id, EarlyRepaymentRequest r, CancellationToken ct)
    {
        var loan = await db.Loans.AsNoTracking().FirstOrDefaultAsync(l => l.Id == id, ct);
        if (loan is null) return NotFound();
        if (r.Amount <= 0) return BadRequest(new { error = "The amount must be greater than zero." });
        var today = Today;
        var payments = (await PaymentsByLoan(ct, id)).GetValueOrDefault(id) ?? [];
        var status = LoanMath.Status(loan, payments, today);
        if (status.Finished) return BadRequest(new { error = "This loan is already paid off." });
        var ahead = LoanMath.Position(loan, payments, today).Remaining;

        var shorten = LoanMath.EarlyRepayment(loan, today, r.Amount, EarlyMode.ShortenTerm, r.When, ahead);
        var reduce = LoanMath.EarlyRepayment(loan, today, r.Amount, EarlyMode.ReducePayment, r.When, ahead);
        return Ok(new
        {
            today, currency = loan.Currency.ToUpperInvariant(),
            current = Current(loan, today, status),
            shorten = Describe(shorten), reduce = Describe(reduce),
            chart = new
            {
                current = Balance(status.Balance, today, ahead),
                shorten = Balance(status.Balance, today, ahead.Where(i => i.Number <= shorten.AtInstallment).Concat(shorten.Schedule)),
                reduce = Balance(status.Balance, today, ahead.Where(i => i.Number <= reduce.AtInstallment).Concat(reduce.Schedule)),
            },
        });
    }

    /// <summary>An extra amount paid with every instalment from the next one on.</summary>
    [HttpPost("{id:int}/extra-monthly")]
    public async Task<IActionResult> ExtraMonthly(int id, ExtraMonthlyRequest r, CancellationToken ct)
    {
        var loan = await db.Loans.AsNoTracking().FirstOrDefaultAsync(l => l.Id == id, ct);
        if (loan is null) return NotFound();
        if (r.ExtraPerMonth <= 0) return BadRequest(new { error = "The extra amount must be greater than zero." });
        var today = Today;
        var payments = (await PaymentsByLoan(ct, id)).GetValueOrDefault(id) ?? [];
        var status = LoanMath.Status(loan, payments, today);
        if (status.Finished) return BadRequest(new { error = "This loan is already paid off." });
        var ahead = LoanMath.Position(loan, payments, today).Remaining;

        var result = LoanMath.ExtraEveryMonth(loan, today, r.ExtraPerMonth, ahead);
        return Ok(new
        {
            today, currency = loan.Currency.ToUpperInvariant(), current = Current(loan, today, status), scenario = Describe(result),
            chart = new
            {
                current = Balance(status.Balance, today, ahead),
                scenario = Balance(status.Balance, today, result.Schedule),
            },
        });
    }

    /// <summary>
    /// Snowball against avalanche across all open loans, with a monthly extra amount in RON on top of the minimum payments.
    /// Balances and payments are converted to RON at today's BNR rate and the plans are simulated in RON.
    /// </summary>
    [HttpPost("strategy")]
    public async Task<IActionResult> Strategy(StrategyRequest r, CancellationToken ct)
    {
        if (r.ExtraPerMonth < 0) return BadRequest(new { error = "The extra amount cannot be negative." });
        var today = Today;
        var debts = new List<Debt>();
        var paymentsByLoan = await PaymentsByLoan(ct);
        foreach (var l in await db.Loans.AsNoTracking().OrderBy(l => l.Name).ToListAsync(ct))
        {
            var status = LoanMath.Status(l, Of(paymentsByLoan, l.Id), today);
            if (status.Finished) continue;
            var rate = await fx.ConvertAsync(1m, l.Currency, "RON", ct);
            debts.Add(new Debt(l.Name, Math.Round(status.Balance * rate, 2), l.AnnualRatePercent, Math.Round(LoanMath.Payment(l.Principal, l.AnnualRatePercent, l.Months) * rate, 2), l.EarlyRepaymentFeePercent));
        }
        if (debts.Count == 0) return Ok(new { today, currency = "RON", debts, minimums = (object?)null, snowball = (object?)null, avalanche = (object?)null });

        var minimums = DebtPayoff.MinimumsOnly(debts);
        var snowball = DebtPayoff.Payoff(debts, r.ExtraPerMonth, PayoffStrategy.Snowball);
        var avalanche = DebtPayoff.Payoff(debts, r.ExtraPerMonth, PayoffStrategy.Avalanche);
        return Ok(new
        {
            today, currency = "RON", extraPerMonth = r.ExtraPerMonth, debts,
            minimums = Plan(minimums, minimums, today), snowball = Plan(snowball, minimums, today), avalanche = Plan(avalanche, minimums, today),
        });
    }

    // ---- helpers ----

    private async Task<Dictionary<int, List<Repayment>>> PaymentsByLoan(CancellationToken ct, int? loanId = null)
    {
        var rows = await db.LoanPayments.AsNoTracking().Where(p => loanId == null || p.LoanId == loanId).Select(p => new { p.LoanId, p.Date, p.Amount }).ToListAsync(ct);
        return rows.GroupBy(p => p.LoanId).ToDictionary(g => g.Key, g => g.Select(p => new Repayment(p.Date, p.Amount)).ToList());
    }

    private static IReadOnlyList<Repayment> Of(Dictionary<int, List<Repayment>> byLoan, int id) => byLoan.TryGetValue(id, out var list) ? list : [];

    private static object Plan(PayoffPlan plan, PayoffPlan baseline, DateOnly today) => new
    {
        plan.Months, debtFreeDate = today.AddMonths(plan.Months), plan.TotalInterest, plan.TotalFees, plan.TotalPaid,
        monthsSaved = baseline.Months - plan.Months, interestSaved = baseline.TotalInterest - plan.TotalInterest,
        netSaving = baseline.TotalInterest - plan.TotalInterest - plan.TotalFees,
        order = plan.Order.Select(c => new { c.Name, c.Month, date = today.AddMonths(c.Month) }),
        balances = plan.BalanceByMonth,
    };

    private static object Current(Loan loan, DateOnly today, LoanStatus status) => new
    {
        payment = LoanMath.Payment(loan.Principal, loan.AnnualRatePercent, loan.Months),
        remainingMonths = status.Remaining, endDate = status.EndDate, remainingInterest = status.RemainingInterest, balance = status.Balance,
    };

    private static object Describe(EarlyRepaymentResult r) => new
    {
        r.Amount, r.Fee, r.AtInstallment, atDate = r.AtDate, r.NewPayment, r.RemainingMonths, r.EndDate, r.MonthsSaved,
        r.RemainingInterest, r.InterestSaved, r.NetSaving, paidOff = r.RemainingMonths == 0,
    };

    /// <summary>Balance over time, starting from where the loan stands today.</summary>
    private static IEnumerable<object> Balance(decimal today, DateOnly start, IEnumerable<Installment> schedule) =>
        new object[] { new { date = start, balance = today } }.Concat(schedule.Select(i => (object)new { date = i.Date, balance = i.Balance }));

    private static string? Validate(LoanRequest r)
    {
        if (string.IsNullOrWhiteSpace(r.Name)) return "Give the loan a name.";
        if (r.Principal <= 0) return "The amount borrowed must be greater than zero.";
        if (r.Currency is not { Length: 3 }) return "The currency must be a three-letter code such as RON.";
        if (r.AnnualRatePercent is < 0 or > 100) return "The interest rate must be between 0% and 100%.";
        if (r.Months is < 1 or > 600) return "The term must be between 1 and 600 months.";
        if (r.EarlyRepaymentFeePercent is < 0 or > 10) return "The early repayment fee must be between 0% and 10%.";
        if (r.StartDate.Year is < 1980 or > 2100) return "Enter a realistic start date.";
        return null;
    }

    private static void Apply(Loan l, LoanRequest r)
    {
        l.Name = r.Name.Trim();
        l.Principal = r.Principal;
        l.Currency = r.Currency.ToUpperInvariant();
        l.AnnualRatePercent = r.AnnualRatePercent;
        l.StartDate = r.StartDate;
        l.Months = r.Months;
        l.EarlyRepaymentFeePercent = r.EarlyRepaymentFeePercent;
    }
}
