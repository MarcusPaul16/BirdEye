namespace BirdEye.Domain.Loans;

public enum PayoffStrategy { Snowball, Avalanche }

/// <summary>One debt as the payoff simulation sees it, already expressed in a single currency.</summary>
public record Debt(string Name, decimal Balance, decimal AnnualRatePercent, decimal MinimumPayment, decimal EarlyRepaymentFeePercent = 0);

/// <summary>The month (1 = the next payment) in which a debt reaches zero.</summary>
public record DebtCleared(string Name, int Month);

public record PayoffPlan(
    PayoffStrategy? Strategy, int Months, decimal TotalInterest, decimal TotalFees, decimal TotalPaid,
    IReadOnlyList<DebtCleared> Order, IReadOnlyList<decimal> BalanceByMonth);

/// <summary>
/// Paying several loans down together. Every month each debt gets its minimum payment; the whole monthly budget (all minimums plus an extra
/// amount) stays constant, so whatever a cleared debt frees up rolls into the next target. The strategy decides the target: snowball goes for the
/// smallest balance (quick wins), avalanche for the highest rate (least interest). Both are compared against paying only the minimums on each loan
/// separately, with nothing rolling over.
/// </summary>
public static class DebtPayoff
{
    private const int MaxMonths = 1200;

    private static decimal Cents(decimal v) => Math.Round(v, 2, MidpointRounding.AwayFromZero);

    /// <summary>Everything paid on its own schedule: each debt keeps its minimum payment until it is gone.</summary>
    public static PayoffPlan MinimumsOnly(IReadOnlyList<Debt> debts)
    {
        var balances = debts.Select(d => d.Balance).ToArray();
        var cleared = new int?[debts.Count];
        decimal interestTotal = 0, paidTotal = 0;
        var byMonth = new List<decimal> { balances.Sum() };

        for (var month = 1; month <= MaxMonths && balances.Any(b => b > 0); month++)
        {
            for (var i = 0; i < debts.Count; i++)
            {
                if (balances[i] <= 0) continue;
                var interest = Cents(balances[i] * LoanMath.MonthlyRate(debts[i].AnnualRatePercent));
                var due = Math.Min(debts[i].MinimumPayment, balances[i] + interest);
                balances[i] = Cents(balances[i] + interest - due);
                interestTotal += interest;
                paidTotal += due;
                if (balances[i] <= 0) cleared[i] = month;
            }
            byMonth.Add(balances.Sum());
        }
        return Plan(null, debts, cleared, interestTotal, 0, paidTotal, byMonth);
    }

    public static PayoffPlan Payoff(IReadOnlyList<Debt> debts, decimal extraPerMonth, PayoffStrategy strategy)
    {
        if (extraPerMonth < 0) throw new ArgumentOutOfRangeException(nameof(extraPerMonth));
        var balances = debts.Select(d => d.Balance).ToArray();
        var cleared = new int?[debts.Count];
        var budget = debts.Sum(d => d.MinimumPayment) + extraPerMonth;
        decimal interestTotal = 0, feeTotal = 0, paidTotal = 0;
        var byMonth = new List<decimal> { balances.Sum() };

        for (var month = 1; month <= MaxMonths && balances.Any(b => b > 0); month++)
        {
            // 1. Interest accrues, and each live debt gets its minimum.
            var left = budget;
            for (var i = 0; i < debts.Count; i++)
            {
                if (balances[i] <= 0) continue;
                var interest = Cents(balances[i] * LoanMath.MonthlyRate(debts[i].AnnualRatePercent));
                var due = Math.Min(debts[i].MinimumPayment, balances[i] + interest);
                balances[i] = Cents(balances[i] + interest - due);
                interestTotal += interest;
                left -= due;
                paidTotal += due;
                if (balances[i] <= 0) cleared[i] = month;
            }

            // 2. What is left of the budget (the extra, plus anything freed by debts that are gone) goes to the target debts in order.
            foreach (var i in Targets(debts, balances, strategy))
            {
                if (left <= 0) break;
                var feeRate = debts[i].EarlyRepaymentFeePercent / 100m;
                // Paying X early costs X plus a fee on it, so the principal that X can retire is X / (1 + fee).
                var principalCapacity = Cents(left / (1 + feeRate));
                var principal = Math.Min(balances[i], principalCapacity);
                var fee = Cents(principal * feeRate);
                balances[i] = Cents(balances[i] - principal);
                left -= principal + fee;
                feeTotal += fee;
                paidTotal += principal + fee;
                if (balances[i] <= 0) cleared[i] = month;
            }
            byMonth.Add(balances.Sum());
        }
        return Plan(strategy, debts, cleared, interestTotal, feeTotal, paidTotal, byMonth);
    }

    /// <summary>The debts still open, best target first.</summary>
    private static IEnumerable<int> Targets(IReadOnlyList<Debt> debts, decimal[] balances, PayoffStrategy strategy)
    {
        var open = Enumerable.Range(0, debts.Count).Where(i => balances[i] > 0);
        return strategy == PayoffStrategy.Snowball
            ? open.OrderBy(i => balances[i]).ThenByDescending(i => debts[i].AnnualRatePercent)
            : open.OrderByDescending(i => debts[i].AnnualRatePercent).ThenBy(i => balances[i]);
    }

    private static PayoffPlan Plan(PayoffStrategy? strategy, IReadOnlyList<Debt> debts, int?[] cleared, decimal interest, decimal fees, decimal paid, List<decimal> byMonth) =>
        new(strategy, byMonth.Count - 1, interest, fees, paid,
            debts.Select((d, i) => new DebtCleared(d.Name, cleared[i] ?? 0)).OrderBy(c => c.Month).ToList(), byMonth);
}
