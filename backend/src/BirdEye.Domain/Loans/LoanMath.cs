namespace BirdEye.Domain.Loans;

public record Installment(int Number, DateOnly Date, decimal Payment, decimal Interest, decimal Principal, decimal Balance);

/// <summary>
/// Where a loan stands. <c>Tracked</c> tells whether this comes from payments the user recorded (true) or from assuming every instalment was paid on
/// time (false). <c>PaidTotal</c> is the cash paid so far, <c>RemainingTotal</c> what is still to pay until the end at the regular instalment, and
/// <c>ScheduledBalance</c> what the balance would be today if every instalment had been paid on time (so the difference is how far ahead or behind you are).
/// </summary>
public record LoanStatus(
    int Paid, int Remaining, decimal Balance, decimal PaidPrincipal, decimal PaidInterest, decimal RemainingInterest, decimal TotalInterest,
    DateOnly EndDate, Installment? Next, bool NotStarted, bool Finished,
    decimal PaidTotal, decimal RemainingTotal, bool Tracked, decimal ScheduledBalance, DateOnly OriginalEndDate);

/// <summary>A payment as the arithmetic sees it.</summary>
public record Repayment(DateOnly Date, decimal Amount);

/// <summary>The loan as it stands: the balance, how many instalment periods are behind, and the instalments still ahead.</summary>
public record LoanPosition(decimal Balance, int Done, IReadOnlyList<Installment> Remaining, decimal PaidTotal, decimal PaidInterest, bool Tracked);

public enum EarlyMode { ShortenTerm, ReducePayment }

/// <summary>What an early repayment does to the rest of the loan.</summary>
public record EarlyRepaymentResult(
    EarlyMode Mode, decimal Amount, decimal Fee, int AtInstallment, DateOnly AtDate, decimal NewPayment, int RemainingMonths, DateOnly EndDate,
    int MonthsSaved, decimal RemainingInterest, decimal InterestSaved, decimal NetSaving, IReadOnlyList<Installment> Schedule);

/// <summary>
/// The arithmetic of fixed-rate annuity loans. Interest accrues monthly at one twelfth of the yearly rate and is rounded to cents like a bank
/// statement; the last instalment absorbs the rounding so the balance ends at exactly zero.
/// </summary>
public static class LoanMath
{
    private const int Safety = 1200; // 100 years: a guard against runaway loops, never reached by real data

    public static decimal MonthlyRate(decimal annualRatePercent) => annualRatePercent / 1200m;

    private static decimal Cents(decimal v) => Math.Round(v, 2, MidpointRounding.AwayFromZero);

    /// <summary>The standard annuity instalment: P r / (1 - (1 + r)^-n), or P / n at a zero rate. Rounded to cents.</summary>
    public static decimal Payment(decimal principal, decimal annualRatePercent, int months)
    {
        if (months <= 0) throw new ArgumentOutOfRangeException(nameof(months));
        var r = MonthlyRate(annualRatePercent);
        if (r == 0) return Cents(principal / months);
        var growth = (decimal)Math.Pow((double)(1 + r), -months);
        return Cents(principal * r / (1 - growth));
    }

    /// <summary>The instalments of a loan from its start; one per month, so it ends on <c>start + months</c>.</summary>
    public static IReadOnlyList<Installment> Schedule(decimal principal, decimal annualRatePercent, int months, DateOnly start) =>
        Continue(principal, annualRatePercent, Payment(principal, annualRatePercent, months), 0, start, clearAt: months);

    public static IReadOnlyList<Installment> Schedule(Loan loan) => Schedule(loan.Principal, loan.AnnualRatePercent, loan.Months, loan.StartDate);

    /// <summary>
    /// Instalments from <paramref name="balance"/> onward, each of <paramref name="payment"/> (the last one smaller). <paramref name="done"/> instalments
    /// are already behind, and dates keep counting from <paramref name="start"/> (always whole months from it, so the day of the month never drifts).
    /// When <paramref name="clearAt"/> is given, that instalment pays off whatever is left, which absorbs the cents lost to rounding.
    /// </summary>
    public static IReadOnlyList<Installment> Continue(decimal balance, decimal annualRatePercent, decimal payment, int done, DateOnly start, int? clearAt = null)
    {
        var rate = MonthlyRate(annualRatePercent);
        var list = new List<Installment>();
        for (var n = done + 1; balance > 0 && list.Count < Safety; n++)
        {
            var interest = Cents(balance * rate);
            var due = n == clearAt ? balance + interest : Math.Min(payment, balance + interest);
            var principalPart = due - interest;
            balance = Cents(balance - principalPart);
            list.Add(new Installment(n, start.AddMonths(n), due, interest, principalPart, balance));
        }
        return list;
    }

    public static LoanStatus Status(Loan loan, DateOnly today) => Status(loan, [], today);

    /// <summary>
    /// Where the loan stands, from the payments recorded so far. With none recorded every instalment is assumed paid on its date; with some, the
    /// balance follows the payments instead (see <see cref="Position"/>).
    /// </summary>
    public static LoanStatus Status(Loan loan, IReadOnlyList<Repayment> payments, DateOnly today)
    {
        var schedule = Schedule(loan);
        var pos = Position(loan, payments, today);
        var scheduledDone = Math.Min(pos.Done, schedule.Count);   // the same number of instalments as the real position, so the two are comparable
        var scheduledBalance = scheduledDone == 0 ? loan.Principal : schedule[scheduledDone - 1].Balance;
        var remainingInterest = pos.Remaining.Sum(i => i.Interest);
        var finished = pos.Remaining.Count == 0;
        var end = pos.Remaining.Count > 0 ? pos.Remaining[^1].Date : loan.StartDate.AddMonths(Math.Max(pos.Done, 1));
        return new LoanStatus(
            pos.Done, pos.Remaining.Count, pos.Balance, loan.Principal - pos.Balance, pos.PaidInterest, remainingInterest, pos.PaidInterest + remainingInterest,
            end, pos.Remaining.FirstOrDefault(), NotStarted: loan.StartDate > today, Finished: finished,
            pos.PaidTotal, pos.Remaining.Sum(i => i.Payment), pos.Tracked, scheduledBalance, schedule[^1].Date);
    }

    /// <summary>
    /// The balance and the instalments still ahead. Without recorded payments the loan follows its schedule. With them, each month adds its interest
    /// to the balance on the instalment date and the payments made up to that date are taken off; a month in which nothing was paid just lets the
    /// interest pile up. A payment made before the next instalment date counts towards that instalment, so paying a little early is not lost. The
    /// instalments that remain are then projected at the regular instalment. A balance under one unit is treated as cleared (rounding cents).
    /// </summary>
    public static LoanPosition Position(Loan loan, IReadOnlyList<Repayment> payments, DateOnly today)
    {
        var schedule = Schedule(loan);
        if (payments.Count == 0)
        {
            var done = schedule.Count(i => i.Date <= today);
            var balance = done == 0 ? loan.Principal : schedule[done - 1].Balance;
            return new LoanPosition(balance, done, schedule.Skip(done).ToList(), schedule.Take(done).Sum(i => i.Payment), schedule.Take(done).Sum(i => i.Interest), Tracked: false);
        }

        var rate = MonthlyRate(loan.AnnualRatePercent);
        var sorted = payments.OrderBy(p => p.Date).ToList();
        decimal bal = loan.Principal, interestPaid = 0;
        int n = 0, idx = 0;
        while (bal > 0 && n < Safety)
        {
            var due = loan.StartDate.AddMonths(n + 1);
            if (!(due <= today || (idx < sorted.Count && sorted[idx].Date <= due))) break;
            n++;
            var interest = Cents(bal * rate);
            interestPaid += interest;
            bal += interest;
            while (idx < sorted.Count && sorted[idx].Date <= due) bal -= sorted[idx++].Amount;
            bal = Cents(Math.Max(bal, 0));
            if (bal < 1) bal = 0;
        }

        var remaining = bal > 0 ? Continue(bal, loan.AnnualRatePercent, Payment(loan.Principal, loan.AnnualRatePercent, loan.Months), n, loan.StartDate) : [];
        return new LoanPosition(bal, n, remaining, payments.Sum(p => p.Amount), interestPaid, Tracked: true);
    }

    /// <summary>
    /// A lump sum of <paramref name="amount"/> applied to the principal together with the first instalment that falls on or after
    /// <paramref name="when"/> (default: the next one). Either the instalment stays and the loan ends sooner, or the end date stays and the
    /// instalment shrinks. The fee is charged on the amount repaid and counted against the interest saved.
    /// </summary>
    public static EarlyRepaymentResult EarlyRepayment(Loan loan, DateOnly today, decimal amount, EarlyMode mode, DateOnly? when = null, IReadOnlyList<Installment>? remaining = null)
    {
        if (amount <= 0) throw new ArgumentOutOfRangeException(nameof(amount), "The amount must be positive.");
        var schedule = remaining ?? Schedule(loan);
        var floor = when ?? today;
        var at = schedule.FirstOrDefault(i => i.Date > today && i.Date >= floor)
                 ?? throw new InvalidOperationException("The loan has no instalment left to apply an early repayment to.");

        var baseInterestAfter = schedule.Where(i => i.Number > at.Number).Sum(i => i.Interest);
        var originalPayment = Payment(loan.Principal, loan.AnnualRatePercent, loan.Months);
        var applied = Math.Min(amount, at.Balance);
        var newBalance = Cents(at.Balance - applied);
        var remainingBefore = schedule[^1].Number - at.Number;
        var fee = Cents(applied * loan.EarlyRepaymentFeePercent / 100m);

        IReadOnlyList<Installment> after;
        decimal newPayment;
        if (newBalance == 0) { after = []; newPayment = 0; }
        else if (mode == EarlyMode.ShortenTerm)
        {
            newPayment = originalPayment;
            after = Continue(newBalance, loan.AnnualRatePercent, newPayment, at.Number, loan.StartDate);
        }
        else
        {
            newPayment = Payment(newBalance, loan.AnnualRatePercent, remainingBefore);
            after = Continue(newBalance, loan.AnnualRatePercent, newPayment, at.Number, loan.StartDate, clearAt: at.Number + remainingBefore);
        }

        var interestAfter = after.Sum(i => i.Interest);
        var end = after.Count == 0 ? at.Date : after[^1].Date;
        return new EarlyRepaymentResult(
            mode, applied, fee, at.Number, at.Date, newPayment, after.Count, end, remainingBefore - after.Count,
            interestAfter, baseInterestAfter - interestAfter, baseInterestAfter - interestAfter - fee, after);
    }

    /// <summary>
    /// An extra <paramref name="extraPerMonth"/> paid with every instalment from the next one on, keeping the instalment (so the loan ends sooner).
    /// The fee applies to all the extra principal actually paid.
    /// </summary>
    public static EarlyRepaymentResult ExtraEveryMonth(Loan loan, DateOnly today, decimal extraPerMonth, IReadOnlyList<Installment>? remaining = null)
    {
        if (extraPerMonth <= 0) throw new ArgumentOutOfRangeException(nameof(extraPerMonth), "The extra amount must be positive.");
        var schedule = remaining ?? Schedule(loan);
        var first = schedule.FirstOrDefault(i => i.Date > today) ?? throw new InvalidOperationException("The loan has no instalment left.");
        var before = schedule.Where(i => i.Number >= first.Number).ToList();
        var payment = Payment(loan.Principal, loan.AnnualRatePercent, loan.Months);

        var startBalance = first.Balance + first.Principal;
        var rate = MonthlyRate(loan.AnnualRatePercent);
        var list = new List<Installment>();
        decimal balance = startBalance, extraPaid = 0;
        for (var n = first.Number; balance > 0 && list.Count < Safety; n++)
        {
            var interest = Cents(balance * rate);
            var regular = Math.Min(payment, balance + interest);
            var principalRegular = regular - interest;
            var extra = Math.Min(extraPerMonth, Cents(balance - principalRegular));
            extra = Math.Max(extra, 0);
            balance = Cents(balance - principalRegular - extra);
            extraPaid += extra;
            list.Add(new Installment(n, loan.StartDate.AddMonths(n), regular + extra, interest, principalRegular + extra, balance));
        }

        var fee = Cents(extraPaid * loan.EarlyRepaymentFeePercent / 100m);
        var baseInterest = before.Sum(i => i.Interest);
        var interestAfter = list.Sum(i => i.Interest);
        return new EarlyRepaymentResult(
            EarlyMode.ShortenTerm, extraPaid, fee, first.Number, first.Date, payment + extraPerMonth, list.Count, list[^1].Date,
            before.Count - list.Count, interestAfter, baseInterest - interestAfter, baseInterest - interestAfter - fee, list);
    }
}
