import { Component, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MoneyPipe } from '../shared/money.pipe';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { BreakdownBars } from '../shared/breakdown-bars';
import { TabItem, Tabs } from '../shared/tabs';
import { SymbolSearch } from '../shared/symbol-search';
import { API_URL, Api, Diversification, DividendMetrics, Portfolio, StockTransaction, TransactionType, errorMessage } from '../core/api';

@Component({
  selector: 'app-portfolio-page',
  imports: [MoneyPipe, DecimalPipe, FormsModule, SymbolSearch, BreakdownBars, Tabs],
  template: `
    <div class="page-head">
      <span class="eyebrow">Equities</span>
      <h2>Portfolio</h2>
      <p>Positions, cost basis and total return including dividends received while you held each stock.</p>
    </div>

    @if (error()) { <p class="error">{{ error() }}</p> }

    <p class="insight">
      @if (portfolio(); as p) {
        @if (p.positions.length) {
          Your portfolio is worth <strong>{{ p.totals.marketValue | money: p.totals.currency : 'symbol' : '1.0-0' }}</strong>,
          <strong [class.pos]="p.totals.totalReturnPercent >= 0" [class.neg]="p.totals.totalReturnPercent < 0">{{ p.totals.totalReturnPercent >= 0 ? '+' : '' }}{{ p.totals.totalReturnPercent | number: '1.1-1' }}%</strong>
          on the {{ p.totals.costBasis | money: p.totals.currency : 'symbol' : '1.0-0' }} invested, dividends included.
          @if (diversification(); as v) {
            @if (v.largestPosition; as lp) { <strong>{{ lp.weightPercent | number: '1.0-0' }}%</strong> of it sits in {{ lp.label }}. }
          }
          @if (dividends(); as d) {
            It yields <strong>{{ d.totals.yield | number: '1.1-1' }}%</strong>, about <strong>{{ d.totals.annualIncome | money: d.currency : 'symbol' : '1.0-0' }}</strong> a year before tax.
          }
          @if (diversification(); as v) {
            @if (v.top3Percent > 75 && v.holdings > 3) { <small>Concentration is high: the three largest positions make up {{ v.top3Percent | number: '1.0-0' }}% of the value.</small> }
          }
        } @else {
          Your portfolio is empty. <button type="button" class="ghost" (click)="tab.set('transactions')">Add your first transaction</button>
        }
      } @else if (!error()) {
        Reading your positions…
      }
    </p>

    <app-tabs [tabs]="tabs" [(active)]="tab" />

    @switch (tab()) {
      @case ('overview') {
        @if (!portfolio() && !error()) { <div class="skeleton"></div><div class="skeleton tall"></div> }
    @if (portfolio(); as p) {
      <div class="kpis">
        <div class="kpi hero">
          <span class="label">Market value</span>
          <span class="value">{{ p.totals.marketValue | money: p.totals.currency : 'symbol' : '1.0-0' }}</span>
          <span class="sub">Invested {{ p.totals.costBasis | money: p.totals.currency : 'symbol' : '1.0-0' }}</span>
        </div>
        <div class="kpi">
          <span class="label">Total return</span>
          <span class="value" [class.pos]="p.totals.totalReturn >= 0" [class.neg]="p.totals.totalReturn < 0">
            {{ p.totals.totalReturn | money: p.totals.currency : 'symbol' : '1.0-0' }}
          </span>
          <span class="sub">Dividends included</span>
        </div>
        <div class="kpi">
          <span class="label">Return</span>
          <span class="value" [class.pos]="p.totals.totalReturnPercent >= 0" [class.neg]="p.totals.totalReturnPercent < 0">
            {{ p.totals.totalReturnPercent | number: '1.1-2' }}%
          </span>
          <span class="sub">on cost basis</span>
        </div>
      </div>

      <div class="card table-wrap">
        <h3>Positions</h3>
        <table>
          <thead><tr><th>Symbol</th><th class="num">Qty</th><th class="num">Avg cost</th><th class="num">Price</th><th class="num">Value</th><th class="num">Dividends</th><th class="num">Return</th></tr></thead>
          <tbody>
            @for (r of p.positions; track r.valuation.position.symbol) {
              <tr>
                <td class="symbol">{{ r.valuation.position.symbol }}</td>
                <td class="num">{{ r.valuation.position.quantity }}</td>
                <td class="num">{{ r.valuation.position.averageCost | money: r.currency }}</td>
                <td class="num">{{ r.valuation.currentPrice | money: r.currency }}</td>
                <td class="num">{{ r.valuation.marketValue | money: r.currency }}</td>
                <td class="num">{{ r.valuation.dividendsReceived | money: r.currency }}</td>
                <td class="num" [class.pos]="r.valuation.totalReturnPercent >= 0" [class.neg]="r.valuation.totalReturnPercent < 0">
                  {{ r.valuation.totalReturnPercent | number: '1.1-2' }}%
                </td>
              </tr>
            } @empty { <tr><td colspan="7" class="empty">No positions yet.</td></tr> }
          </tbody>
        </table>
      </div>
    }

      }
      @case ('dividends') {
        @if (!dividends() && !dividendError()) { <div class="skeleton"></div><div class="skeleton tall"></div> }
    @if (dividendError()) { <p class="error">Dividend metrics unavailable: {{ dividendError() }}</p> }
    @if (dividends(); as d) {
      @if (d.positions.length) {
        <div class="kpis">
          <div class="kpi hero">
            <span class="label">Dividend yield</span>
            <span class="value">{{ d.totals.yield | number: '1.2-2' }}%</span>
            <span class="sub">Annual dividends ÷ market value</span>
          </div>
          <div class="kpi">
            <span class="label">Yield on cost</span>
            <span class="value">{{ d.totals.yieldOnCost | number: '1.2-2' }}%</span>
            <span class="sub">Annual dividends ÷ amount invested</span>
          </div>
          <div class="kpi">
            <span class="label">Annual dividend income</span>
            <span class="value">{{ d.totals.annualIncome | money: d.currency }}</span>
            <span class="sub">Last 12 months of dividends × shares held</span>
          </div>
          <div class="kpi">
            <span class="label">Dividend growth (YoY)</span>
            <span class="value" [class.pos]="(d.totals.growth.yoy ?? 0) >= 0" [class.neg]="(d.totals.growth.yoy ?? 0) < 0">{{ pct(d.totals.growth.yoy) }}</span>
            <span class="sub">3Y {{ pct(d.totals.growth.cagr3) }} · 5Y {{ pct(d.totals.growth.cagr5) }} · 10Y {{ pct(d.totals.growth.cagr10) }}</span>
          </div>
        </div>

        <div class="card table-wrap">
          <h3>Dividends by position</h3>
          <table>
            <thead>
              <tr>
                <th>Symbol</th><th class="num">Dividend / share (12m)</th><th class="num">Annual income</th>
                <th class="num">Yield</th><th class="num">Yield on cost</th>
                <th class="num">YoY</th><th class="num">3Y</th><th class="num">5Y</th><th class="num">10Y</th>
              </tr>
            </thead>
            <tbody>
              @for (r of d.positions; track r.symbol) {
                <tr>
                  <td class="symbol">{{ r.symbol }}</td>
                  <td class="num">{{ r.dividendPerShare | money: r.currency : 'symbol' : '1.2-4' }}</td>
                  <td class="num">{{ r.annualIncome | money: r.currency }}</td>
                  <td class="num">{{ r.yield | number: '1.2-2' }}%</td>
                  <td class="num">{{ r.yieldOnCost | number: '1.2-2' }}%</td>
                  @for (g of [r.growth.yoy, r.growth.cagr3, r.growth.cagr5, r.growth.cagr10]; track $index) {
                    <td class="num" [class.pos]="g !== null && g >= 0" [class.neg]="g !== null && g < 0">{{ pct(g) }}</td>
                  }
                </tr>
              }
              <tr class="totals">
                <td>Portfolio</td><td></td>
                <td class="num">{{ d.totals.annualIncome | money: d.currency }}</td>
                <td class="num">{{ d.totals.yield | number: '1.2-2' }}%</td>
                <td class="num">{{ d.totals.yieldOnCost | number: '1.2-2' }}%</td>
                @for (g of [d.totals.growth.yoy, d.totals.growth.cagr3, d.totals.growth.cagr5, d.totals.growth.cagr10]; track $index) {
                  <td class="num" [class.pos]="g !== null && g >= 0" [class.neg]="g !== null && g < 0">{{ pct(g) }}</td>
                }
              </tr>
            </tbody>
          </table>
          <p class="note">
            Yield uses today's price, yield on cost uses your average purchase price. Growth is the change in dividend per share between
            {{ d.totals.growthYear }} and earlier full years (YoY, then compound annual rate over 3, 5 and 10 years). The portfolio row is
            like-for-like on your current holdings, in {{ d.currency }} at today's BNR rates. Rows show each position's own currency.
          </p>
        </div>
      }
    }

      }
      @case ('diversification') {
        @if (!diversification()) { <div class="skeleton"></div><div class="skeleton tall"></div> }
    @if (diversification(); as v) {
      @if (v.holdings) {
        <div class="kpis">
          <div class="kpi hero">
            <span class="label">Largest position</span>
            <span class="value">{{ v.largestPosition?.weightPercent | number: '1.1-1' }}%</span>
            <span class="sub">{{ v.largestPosition?.label }}</span>
          </div>
          <div class="kpi">
            <span class="label">Top 3 positions</span>
            <span class="value">{{ v.top3Percent | number: '1.1-1' }}%</span>
            <span class="sub">of portfolio value</span>
          </div>
          <div class="kpi">
            <span class="label">Effective holdings</span>
            <span class="value">{{ v.effectiveHoldings | number: '1.1-1' }}</span>
            <span class="sub">of {{ v.holdings }} held</span>
          </div>
          <div class="kpi">
            <span class="label">Sectors · countries</span>
            <span class="value">{{ classified(v.bySector) }} · {{ classified(v.byCountry) }}</span>
            <span class="sub">{{ v.byCurrency.length }} currenc{{ v.byCurrency.length === 1 ? 'y' : 'ies' }}</span>
          </div>
        </div>
        <div class="split">
          <div class="card"><app-breakdown-bars title="By position" [slices]="v.byPosition" [currency]="v.currency" /></div>
          <div class="card"><app-breakdown-bars title="By sector" [slices]="v.bySector" [currency]="v.currency" /></div>
          <div class="card"><app-breakdown-bars title="By country" [slices]="v.byCountry" [currency]="v.currency" /></div>
          <div class="card"><app-breakdown-bars title="By currency" [slices]="v.byCurrency" [currency]="v.currency" /></div>
        </div>
        <p class="note" style="margin: 1.25rem 0 2rem">
          Weighted by current market value in {{ v.currency }} at today's BNR rates. "Effective holdings" is the number of equally sized
          positions that would give the same concentration (1 ÷ HHI). Funds and ETFs have no sector or country in the data source, so
          they show as Unclassified.
        </p>
      }
    }

      }
      @case ('transactions') {
    <div class="card">
      <h3>New transaction</h3>
      <form (submit)="$event.preventDefault(); add()">
        <label>Company or symbol <app-symbol-search [(value)]="form.symbol" placeholder="e.g. KO or Legal" (picked)="fillFromQuote($event)" (committed)="fillFromQuote($event)" /></label>
        <label>Side
          <select name="type" [(ngModel)]="form.type"><option value="Buy">Buy</option><option value="Sell">Sell</option></select>
        </label>
        <label>Quantity <input name="quantity" type="number" min="0" step="any" [(ngModel)]="form.quantity" required /></label>
        <label>Price <input name="price" type="number" min="0" step="any" [(ngModel)]="form.price" required /></label>
        <label>Fees <input name="fees" type="number" min="0" step="any" [(ngModel)]="form.fees" /></label>
        <label>Currency
          <select name="currency" [(ngModel)]="form.currency">
            @for (c of currencies(); track c) { <option>{{ c }}</option> }
          </select>
        </label>
        <label>Date <input name="date" type="date" [(ngModel)]="form.date" required /></label>
        <button [disabled]="!form.symbol.trim() || !form.quantity || !form.price || !form.date">Add transaction</button>
      </form>
    </div>

    <div class="card table-wrap">
      <h3>Transactions</h3>
      <table>
        <thead><tr><th>Date</th><th>Symbol</th><th>Side</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Fees</th><th></th></tr></thead>
        <tbody>
          @for (t of transactions(); track t.id) {
            <tr>
              <td>{{ t.date }}</td><td class="symbol">{{ t.symbol }}</td>
              <td [class.pos]="t.type === 'Buy'" [class.neg]="t.type === 'Sell'">{{ t.type }}</td>
              <td class="num">{{ t.quantity }}</td><td class="num">{{ t.price | money: t.currency }}</td><td class="num">{{ t.fees | money: t.currency }}</td>
              <td class="num"><button class="ghost" type="button" (click)="remove(t)">Delete</button></td>
            </tr>
          } @empty { <tr><td colspan="7" class="empty">No transactions yet.</td></tr> }
        </tbody>
      </table>
    </div>
      }
    }
  `,
})
export class PortfolioPage {
  private readonly api = inject(Api);

  private readonly http = inject(HttpClient);
  protected readonly currencies = signal(['USD', 'EUR', 'GBP', 'RON']);
  private lastQuoted = '';
  protected readonly portfolio = signal<Portfolio | null>(null);
  protected readonly transactions = signal<StockTransaction[]>([]);
  protected readonly tabs: TabItem[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'dividends', label: 'Dividends' },
    { id: 'diversification', label: 'Diversification' },
    { id: 'transactions', label: 'Transactions' },
  ];
  protected readonly tab = signal('overview');
  protected readonly dividends = signal<DividendMetrics | null>(null);
  protected readonly dividendError = signal('');
  protected readonly diversification = signal<Diversification | null>(null);
  protected readonly error = signal('');
  protected form = this.emptyForm();

  constructor() { this.reload(); }

  private emptyForm() {
    return { symbol: '', type: 'Buy' as TransactionType, quantity: 0, price: 0, fees: 0, currency: 'USD', date: '' };
  }

  private reload() {
    this.api.transactions().subscribe(t => this.transactions.set(t));
    this.api.diversification().subscribe({
      next: d => this.diversification.set(d),
      error: () => this.diversification.set(null),
    });
    this.api.dividendMetrics().subscribe({
      next: d => { this.dividends.set(d); this.dividendError.set(''); },
      error: e => { this.dividends.set(null); this.dividendError.set(errorMessage(e)); },
    });
    this.api.valuation().subscribe({
      next: p => this.portfolio.set(p),
      error: e => { this.portfolio.set(null); this.error.set(errorMessage(e)); },
    });
  }

  private run<T>(obs: Observable<T>, then?: () => void) {
    this.error.set('');
    obs.subscribe({
      next: () => { then?.(); this.reload(); },
      error: e => this.error.set(errorMessage(e)),
    });
  }

  /** Fills price and currency with the live quote for the chosen company. */
  protected fillFromQuote(symbol: string) {
    const sym = symbol.trim().toUpperCase();
    if (!sym || sym === this.lastQuoted) return;
    this.lastQuoted = sym;
    this.http.get<{ symbol: string; price: number; currency: string }>(`${API_URL}/companies/${encodeURIComponent(sym)}/quote`).subscribe({
      next: q => {
        if (this.form.symbol.trim().toUpperCase() !== sym) return; // the user moved on to another company meanwhile
        this.form.price = +q.price.toFixed(4);
        this.form.currency = q.currency;
        if (!this.currencies().includes(q.currency)) this.currencies.update(c => [...c, q.currency]);
      },
      error: () => { this.lastQuoted = ''; }, // unknown ticker: leave the fields for manual entry
    });
  }

  /** Number of distinct real categories, not counting the Unclassified bucket. */
  protected classified(slices: { label: string }[]) { return slices.filter(s => s.label !== 'Unclassified').length; }

  protected pct(v: number | null): string {
    return v === null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
  }

  protected add() {
    const f = this.form;
    this.run(this.api.addTransaction({ ...f, symbol: f.symbol.trim().toUpperCase(), fees: f.fees || 0 }),
      () => { this.form = { ...this.emptyForm(), currency: f.currency }; this.lastQuoted = ''; });
  }

  protected remove(t: StockTransaction) {
    if (confirm(`Delete the ${t.type} of ${t.symbol} on ${t.date}?`)) this.run(this.api.deleteTransaction(t.id));
  }
}
