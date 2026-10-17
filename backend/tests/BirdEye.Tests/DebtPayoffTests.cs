using BirdEye.Domain.Loans;

namespace BirdEye.Tests;

public class DebtPayoffTests
{
    // Small balance at a low rate and a big balance at a high rate: the case where the two strategies disagree.
    private static readonly Debt SmallCheap = new("SmallCheap", 1000m, 5m, 50m);
    private static readonly Debt BigDear = new("BigDear", 5000m, 20m, 150m);

    private static IReadOnlyList<Debt> Mixed => [SmallCheap, BigDear];

    [Fact]
    public void Paying_only_the_minimum_on_one_debt_matches_its_own_schedule()
    {
        // A loan with 60 payments of its annuity amount, seen from the start: the same months and the same interest.
        var loan = new Loan { Name = "x", Principal = 20000, AnnualRatePercent = 8, Months = 48, StartDate = new DateOnly(2026, 1, 1) };
        var schedule = LoanMath.Schedule(loan);
        var plan = DebtPayoff.MinimumsOnly([new Debt("x", 20000, 8, LoanMath.Payment(20000, 8, 48))]);
        Assert.Equal(48, plan.Months);
        Assert.Equal(schedule.Sum(i => i.Interest), plan.TotalInterest);
        Assert.Equal(schedule.Sum(i => i.Payment), plan.TotalPaid);
    }

    [Fact]
    public void With_one_debt_and_no_extra_every_strategy_equals_the_minimums()
    {
        var debt = new Debt("x", 20000, 8, LoanMath.Payment(20000, 8, 48));
        var baseline = DebtPayoff.MinimumsOnly([debt]);
        foreach (var s in new[] { PayoffStrategy.Snowball, PayoffStrategy.Avalanche })
        {
            var plan = DebtPayoff.Payoff([debt], 0, s);
            Assert.Equal(baseline.Months, plan.Months);
            Assert.Equal(baseline.TotalInterest, plan.TotalInterest);
        }
    }

    [Fact]
    public void Snowball_targets_the_smallest_balance_and_avalanche_the_highest_rate()
    {
        var snowball = DebtPayoff.Payoff(Mixed, 300, PayoffStrategy.Snowball);
        var avalanche = DebtPayoff.Payoff(Mixed, 300, PayoffStrategy.Avalanche);
        Assert.Equal("SmallCheap", snowball.Order[0].Name);   // the small debt is cleared first
        Assert.Equal("BigDear", avalanche.Order[0].Name);     // the expensive one is cleared first
    }

    [Fact]
    public void Avalanche_costs_less_interest_than_snowball_when_the_expensive_debt_is_the_big_one()
    {
        var snowball = DebtPayoff.Payoff(Mixed, 300, PayoffStrategy.Snowball);
        var avalanche = DebtPayoff.Payoff(Mixed, 300, PayoffStrategy.Avalanche);
        Assert.True(avalanche.TotalInterest < snowball.TotalInterest);
        Assert.True(avalanche.Months <= snowball.Months);
    }

    [Fact]
    public void When_the_smallest_debt_is_also_the_most_expensive_the_two_strategies_are_the_same()
    {
        Debt[] debts = [new("SmallDear", 1000m, 20m, 50m), new("BigCheap", 5000m, 5m, 150m)];
        var snowball = DebtPayoff.Payoff(debts, 300, PayoffStrategy.Snowball);
        var avalanche = DebtPayoff.Payoff(debts, 300, PayoffStrategy.Avalanche);
        Assert.Equal(snowball.TotalInterest, avalanche.TotalInterest);
        Assert.Equal(snowball.Months, avalanche.Months);
        Assert.Equal(snowball.BalanceByMonth, avalanche.BalanceByMonth);
    }

    [Fact]
    public void Both_strategies_beat_paying_only_the_minimums()
    {
        var baseline = DebtPayoff.MinimumsOnly(Mixed);
        foreach (var s in new[] { PayoffStrategy.Snowball, PayoffStrategy.Avalanche })
        {
            var plan = DebtPayoff.Payoff(Mixed, 300, s);
            Assert.True(plan.Months < baseline.Months, $"{s} months");
            Assert.True(plan.TotalInterest < baseline.TotalInterest, $"{s} interest");
        }
    }

    [Fact]
    public void Rolling_the_freed_payments_helps_even_with_no_extra_money()
    {
        var baseline = DebtPayoff.MinimumsOnly(Mixed);
        var rolled = DebtPayoff.Payoff(Mixed, 0, PayoffStrategy.Avalanche);
        Assert.True(rolled.TotalInterest < baseline.TotalInterest);
        Assert.True(rolled.Months <= baseline.Months);
    }

    [Fact]
    public void Everything_ends_at_zero_and_the_total_balance_only_falls()
    {
        foreach (var plan in new[] { DebtPayoff.MinimumsOnly(Mixed), DebtPayoff.Payoff(Mixed, 300, PayoffStrategy.Snowball), DebtPayoff.Payoff(Mixed, 300, PayoffStrategy.Avalanche) })
        {
            Assert.Equal(6000m, plan.BalanceByMonth[0]);
            Assert.Equal(0m, plan.BalanceByMonth[^1]);
            Assert.Equal(plan.Months + 1, plan.BalanceByMonth.Count);
            for (var i = 1; i < plan.BalanceByMonth.Count; i++) Assert.True(plan.BalanceByMonth[i] <= plan.BalanceByMonth[i - 1]);
            Assert.All(plan.Order, c => Assert.InRange(c.Month, 1, plan.Months));
            Assert.Equal(plan.Months, plan.Order.Max(c => c.Month));
        }
    }

    [Fact]
    public void Money_is_conserved_everything_paid_is_principal_plus_interest_plus_fees()
    {
        Debt[] withFee = [SmallCheap with { EarlyRepaymentFeePercent = 1m }, BigDear with { EarlyRepaymentFeePercent = 0.5m }];
        foreach (var plan in new[] { DebtPayoff.MinimumsOnly(withFee), DebtPayoff.Payoff(withFee, 300, PayoffStrategy.Snowball), DebtPayoff.Payoff(withFee, 300, PayoffStrategy.Avalanche) })
            Assert.Equal(6000m + plan.TotalInterest + plan.TotalFees, plan.TotalPaid);
    }

    [Fact]
    public void Fees_apply_only_to_money_paid_early_never_to_the_minimums()
    {
        Debt[] feeDebts = [SmallCheap with { EarlyRepaymentFeePercent = 2m }, BigDear with { EarlyRepaymentFeePercent = 2m }];
        Assert.Equal(0m, DebtPayoff.MinimumsOnly(feeDebts).TotalFees);
        Assert.True(DebtPayoff.Payoff(feeDebts, 300, PayoffStrategy.Avalanche).TotalFees > 0);
        Assert.Equal(0m, DebtPayoff.Payoff(Mixed, 300, PayoffStrategy.Avalanche).TotalFees);
    }

    [Fact]
    public void More_extra_money_means_fewer_months_and_less_interest()
    {
        var plans = new[] { 0m, 100m, 300m, 800m }.Select(e => DebtPayoff.Payoff(Mixed, e, PayoffStrategy.Avalanche)).ToList();
        for (var i = 1; i < plans.Count; i++)
        {
            Assert.True(plans[i].Months <= plans[i - 1].Months);
            Assert.True(plans[i].TotalInterest < plans[i - 1].TotalInterest);
        }
    }

    [Fact]
    public void A_huge_extra_amount_clears_everything_in_the_first_month()
    {
        var plan = DebtPayoff.Payoff(Mixed, 1_000_000, PayoffStrategy.Snowball);
        Assert.Equal(1, plan.Months);
        Assert.All(plan.Order, c => Assert.Equal(1, c.Month));
    }

    [Fact]
    public void No_debts_means_an_empty_plan()
    {
        var plan = DebtPayoff.Payoff([], 100, PayoffStrategy.Avalanche);
        Assert.Equal(0, plan.Months);
        Assert.Equal(0m, plan.TotalInterest);
        Assert.Empty(plan.Order);
    }

    [Fact]
    public void A_negative_extra_amount_is_refused() =>
        Assert.Throws<ArgumentOutOfRangeException>(() => DebtPayoff.Payoff(Mixed, -1, PayoffStrategy.Snowball));
}
