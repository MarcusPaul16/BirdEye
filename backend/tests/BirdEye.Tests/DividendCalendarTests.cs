using BirdEye.Domain.Investments;
using BirdEye.Domain.MarketData;

namespace BirdEye.Tests;

public class DividendCalendarTests
{
    private static readonly DateOnly Today = new(2026, 10, 17);
    private static readonly DateOnly From = new(2026, 4, 1), To = new(2027, 10, 31);

    private static DateOnly D(string s) => DateOnly.Parse(s);

    private static StockTransaction Tx(string date, decimal qty, TransactionType type = TransactionType.Buy) =>
        new() { Symbol = "KO", Type = type, Quantity = qty, Price = 50m, Date = D(date), Currency = "USD" };

    private static DividendPayment Div(string ex, decimal amount, string? pay = null) =>
        new(D(ex), pay is null ? null : D(pay), amount, "USD", PaymentDateIsEstimate: pay is null);

    // A quarterly payer: ex-dates mid Mar/Jun/Sep/Dec, paid ~2 weeks later.
    private static List<DividendPayment> Quarterly(decimal amount) =>
    [
        Div("2025-12-01", amount, "2025-12-15"), Div("2026-03-14", amount, "2026-04-01"),
        Div("2026-06-13", amount, "2026-07-01"), Div("2026-09-15", amount, "2026-10-01"),
    ];

    [Fact]
    public void Shares_count_only_when_bought_before_the_ex_date_and_not_sold_before_it()
    {
        var txs = new[] { Tx("2026-01-10", 10), Tx("2026-03-14", 5), Tx("2026-04-01", 4, TransactionType.Sell) };
        Assert.Equal(10m, DividendCalendar.SharesBefore(txs, "KO", D("2026-03-14"))); // bought on the ex-date itself: not entitled
        Assert.Equal(15m, DividendCalendar.SharesBefore(txs, "KO", D("2026-03-15")));
        Assert.Equal(11m, DividendCalendar.SharesBefore(txs, "KO", D("2026-04-02")));
    }

    [Fact]
    public void Dividends_before_the_purchase_are_not_counted()
    {
        var events = DividendCalendar.Build("KO", [Tx("2026-07-01", 10)], Quarterly(0.5m), null, Today, From, To);
        Assert.DoesNotContain(events, e => e.Kind == DividendEventKind.Paid && e.ExDate < D("2026-07-01"));
        Assert.Contains(events, e => e.Kind == DividendEventKind.Paid && e.ExDate == D("2026-09-15") && e.Shares == 10m);
    }

    [Fact]
    public void Ex_date_passed_but_not_yet_paid_is_pending()
    {
        var divs = Quarterly(0.5m);
        divs.Add(Div("2026-10-10", 0.5m, "2026-10-24"));
        var events = DividendCalendar.Build("KO", [Tx("2026-01-01", 10)], divs, null, Today, From, To);
        var pending = Assert.Single(events, e => e.Kind == DividendEventKind.Pending);
        Assert.Equal(D("2026-10-24"), pending.PaymentDate);
    }

    [Fact]
    public void Last_years_payments_are_rolled_forward_a_year_with_the_same_amounts_when_there_is_no_growth()
    {
        var events = DividendCalendar.Build("KO", [Tx("2025-01-01", 10)], Quarterly(0.5m), null, Today, From, To);
        var projected = events.Where(e => e.Kind == DividendEventKind.Projected).ToList();
        Assert.Equal(4, projected.Count);
        Assert.Equal([D("2026-12-15"), D("2027-04-01"), D("2027-07-01"), D("2027-10-01")], projected.Select(p => p.PaymentDate));
        Assert.All(projected, p => { Assert.Equal(0.5m, p.AmountPerShare); Assert.Equal(10m, p.Shares); });
    }

    [Fact]
    public void Projection_applies_the_latest_annual_growth()
    {
        // Last 12 months 4 x 0.55 = 2.20; the 12 months before 4 x 0.50 = 2.00; growth 10%.
        var divs = new List<DividendPayment>
        {
            Div("2024-12-01", .5m, "2024-12-15"), Div("2025-03-14", .5m, "2025-04-01"), Div("2025-06-13", .5m, "2025-07-01"), Div("2025-09-15", .5m, "2025-10-01"),
            Div("2025-12-01", .55m, "2025-12-15"), Div("2026-03-14", .55m, "2026-04-01"), Div("2026-06-13", .55m, "2026-07-01"), Div("2026-09-15", .55m, "2026-10-01"),
        };
        Assert.Equal(1.1m, DividendCalendar.AnnualGrowth(divs, Today));
        var first = DividendCalendar.Build("KO", [Tx("2024-01-01", 10)], divs, null, Today, From, To).First(e => e.Kind == DividendEventKind.Projected);
        Assert.Equal(0.605m, first.AmountPerShare); // 0.55 x 1.10
    }

    [Fact]
    public void Growth_is_kept_within_bounds_and_neutral_without_history()
    {
        var doubled = new List<DividendPayment> { Div("2025-06-01", 1m), Div("2026-06-01", 5m) };
        Assert.Equal(1.2m, DividendCalendar.AnnualGrowth(doubled, Today));
        Assert.Equal(1m, DividendCalendar.AnnualGrowth([Div("2026-06-01", 1m)], Today));
    }

    [Fact]
    public void A_confirmed_ex_date_replaces_the_projection_it_corresponds_to()
    {
        var events = DividendCalendar.Build("KO", [Tx("2025-01-01", 10)], Quarterly(0.5m), new UpcomingDividend(D("2026-12-03"), D("2026-12-17")), Today, From, To);
        var confirmed = Assert.Single(events, e => e.Kind == DividendEventKind.Confirmed);
        Assert.Equal(D("2026-12-03"), confirmed.ExDate);
        Assert.Equal(D("2026-12-17"), confirmed.PaymentDate);
        Assert.False(confirmed.PaymentDateIsEstimate);
        Assert.Equal(0.5m, confirmed.AmountPerShare);
        Assert.Equal(3, events.Count(e => e.Kind == DividendEventKind.Projected)); // 4 projected minus the one replaced
    }

    [Fact]
    public void Confirmed_without_a_payment_date_estimates_it()
    {
        var events = DividendCalendar.Build("KO", [Tx("2025-01-01", 10)], Quarterly(0.5m), new UpcomingDividend(D("2026-12-03"), null), Today, From, To);
        var confirmed = Assert.Single(events, e => e.Kind == DividendEventKind.Confirmed);
        Assert.Equal(D("2026-12-17"), confirmed.PaymentDate);
        Assert.True(confirmed.PaymentDateIsEstimate);
    }

    [Fact]
    public void A_purchase_dated_after_today_still_earns_dividends_whose_ex_date_follows_it()
    {
        // Bought on 19 Oct (two days from "today"): the 3 Dec ex-date is covered, 1 Oct-style earlier slots are not.
        var events = DividendCalendar.Build("KO", [Tx("2026-10-19", 10)], Quarterly(0.5m), new UpcomingDividend(D("2026-12-03"), null), Today, From, To);
        var confirmed = Assert.Single(events, e => e.Kind == DividendEventKind.Confirmed);
        Assert.Equal(10m, confirmed.Shares);
        Assert.All(events.Where(e => e.Kind == DividendEventKind.Projected), p => Assert.Equal(10m, p.Shares));
    }

    [Fact]
    public void A_future_dated_sale_stops_dividends_from_then_on()
    {
        var txs = new[] { Tx("2025-01-01", 10), Tx("2027-02-01", 10, TransactionType.Sell) };
        var events = DividendCalendar.Build("KO", txs, Quarterly(0.5m), null, Today, From, To);
        Assert.Contains(events, e => e.ExDate == D("2026-12-01"));                 // still held on this ex-date
        Assert.DoesNotContain(events, e => e.ExDate > D("2027-02-01"));            // sold before the later ex-dates
    }

    [Fact]
    public void A_sold_out_position_has_no_future_events()
    {
        var txs = new[] { Tx("2025-01-01", 10), Tx("2026-08-01", 10, TransactionType.Sell) };
        var events = DividendCalendar.Build("KO", txs, Quarterly(0.5m), new UpcomingDividend(D("2026-12-03"), null), Today, From, To);
        Assert.DoesNotContain(events, e => e.Kind is DividendEventKind.Projected or DividendEventKind.Confirmed);
    }

    [Fact]
    public void Nothing_is_projected_beyond_the_horizon()
    {
        var events = DividendCalendar.Build("KO", [Tx("2025-01-01", 10)], Quarterly(0.5m), null, Today, From, D("2027-05-01"));
        Assert.All(events, e => Assert.True(e.PaymentDate <= D("2027-05-01")));
    }
}
