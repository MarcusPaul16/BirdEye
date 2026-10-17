import { Component, DestroyRef, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime } from 'rxjs';
import { Api, PlanSummary, StrategyResponse } from '../core/api';
import { BalanceChart, BalanceSeries } from '../shared/balance-chart';
import { addMonths, fmtDate, fmtSpan } from '../shared/dates';
import { MoneyPipe } from '../shared/money.pipe';

@Component({
  selector: 'app-strategy',
  imports: [MoneyPipe, FormsModule, BalanceChart],
  styles: `
    .controls { display: flex; flex-wrap: wrap; gap: 1rem; align-items: flex-end; }
    .intro { color: var(--muted); line-height: 1.6; max-width: 70ch; margin: 0 0 1rem; }
    .cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1rem; margin-bottom: 1rem; }
    .col { background: var(--surface-2); border-radius: var(--radius); padding: 1.25rem 1.4rem; }
    .col.best { outline: 2px solid var(--accent); }
    .col h4 { margin: 0 0 .15rem; font-size: 1rem; }
    .col .sub { color: var(--muted); font-size: .8rem; margin: 0 0 1rem; }
    .col .big { font-size: 1.6rem; font-weight: 700; letter-spacing: -.03em; }
    dl { margin: 1rem 0 0; display: grid; gap: .55rem; }
    dl div { display: flex; justify-content: space-between; gap: 1rem; font-size: .88rem; }
    dt { color: var(--muted); }
    dd { margin: 0; font-weight: 600; font-variant-numeric: tabular-nums; text-align: right; }
    .tag { display: inline-block; font-size: .7rem; font-weight: 700; padding: .12rem .6rem; border-radius: 999px; background: rgb(var(--accent-rgb) / .16); color: var(--accent-strong); margin-bottom: .6rem; }
    ol { margin: 1rem 0 0; padding-left: 1.2rem; font-size: .85rem; color: var(--muted); display: grid; gap: .3rem; }
    ol b { color: var(--text); font-weight: 600; }
    .note { color: var(--muted); font-size: .85rem; line-height: 1.55; margin: 0; }
    .hint { color: var(--muted); font-size: .8rem; font-weight: 400; }
  `,
  template: `
    <div class="card">
      <p class="intro">
        <strong>Snowball</strong> pays off the smallest balance first, so debts disappear quickly and you stay motivated.
        <strong>Avalanche</strong> goes for the highest interest rate first, which costs the least in total. Both keep paying the minimum on every loan and roll
        the freed-up instalments into the next one.
      </p>
      <div class="controls">
        <label>Extra to put toward debt each month (RON)
          <input name="extra" type="number" min="0" step="100" [(ngModel)]="extra" (ngModelChange)="schedule()" />
        </label>
        <span class="hint">On top of all your minimum payments. 0 compares the strategies using only the money you already pay.</span>
      </div>
      @if (error()) { <p class="error" role="alert" style="margin-top: 1rem">{{ error() }}</p> }
    </div>

    @if (result(); as r) {
      @if (!r.minimums || !r.snowball || !r.avalanche) {
        <div class="card"><p class="hint">No open loans to compare. Add a loan on the Loans tab.</p></div>
      } @else {
        <div class="cols">
          @for (c of columns(r); track c.key) {
            <div class="col" [class.best]="c.best">
              @if (c.best) { <span class="tag">Cheapest</span> }
              <h4>{{ c.title }}</h4>
              <p class="sub">{{ c.caption }}</p>
              <div class="big">{{ date(c.plan.debtFreeDate) }}</div>
              <p class="sub" style="margin: .1rem 0 0">debt-free, in {{ span(c.plan.months) }}</p>
              <dl>
                <div><dt>Interest from now on</dt><dd>{{ c.plan.totalInterest | money: r.currency : 'symbol' : '1.0-0' }}</dd></div>
                @if (c.plan.totalFees > 0) { <div><dt>Early repayment fees</dt><dd>{{ c.plan.totalFees | money: r.currency : 'symbol' : '1.0-0' }}</dd></div> }
                @if (c.key !== 'minimums') {
                  <div><dt>Interest saved</dt><dd class="pos">{{ c.plan.interestSaved | money: r.currency : 'symbol' : '1.0-0' }}</dd></div>
                  <div><dt>Debt-free sooner by</dt><dd class="pos">{{ span(c.plan.monthsSaved) }}</dd></div>
                  @if (c.plan.totalFees > 0) { <div><dt>Net saving</dt><dd class="pos">{{ c.plan.netSaving | money: r.currency : 'symbol' : '1.0-0' }}</dd></div> }
                }
              </dl>
              <ol>
                @for (o of c.plan.order; track o.name) { <li><b>{{ o.name }}</b> cleared in {{ date(o.date) }}</li> }
              </ol>
            </div>
          }
        </div>
        <div class="card"><app-balance-chart [series]="series(r)" [currency]="r.currency" /></div>
        <p class="note">
          Everything is converted to RON at today's BNR rate and worked out in RON. Balances are as of your last instalment; each month every loan
          gets its normal instalment, and the extra goes to the loan the strategy picks.
        </p>
      }
    }
  `,
})
export class Strategy {
  private readonly api = inject(Api);

  protected readonly result = signal<StrategyResponse | null>(null);
  protected readonly error = signal('');
  protected extra = 500;
  private readonly input$ = new Subject<void>();
  private request = 0;

  protected span = fmtSpan;
  protected date = fmtDate;

  constructor() {
    this.input$.pipe(debounceTime(400), takeUntilDestroyed(inject(DestroyRef))).subscribe(() => this.run());
    this.run();
  }

  protected schedule() { this.input$.next(); }

  private run() {
    const ticket = ++this.request;
    this.error.set('');
    this.api.strategy(Math.max(0, this.extra || 0)).subscribe({
      next: r => { if (ticket === this.request) this.result.set(r); },
      error: () => { if (ticket === this.request) this.error.set('Could not calculate this.'); },
    });
  }

  protected columns(r: StrategyResponse): { key: string; title: string; caption: string; plan: PlanSummary; best: boolean }[] {
    const [m, s, a] = [r.minimums!, r.snowball!, r.avalanche!];
    const cheapest = Math.min(m.totalInterest + m.totalFees, s.totalInterest + s.totalFees, a.totalInterest + a.totalFees);
    const best = (p: PlanSummary) => p.totalInterest + p.totalFees <= cheapest + 0.005;
    return [
      { key: 'minimums', title: 'Minimums only', caption: 'Each loan on its own schedule', plan: m, best: false },
      { key: 'snowball', title: 'Snowball', caption: 'Smallest balance first', plan: s, best: best(s) && !best(a) },
      { key: 'avalanche', title: 'Avalanche', caption: 'Highest interest rate first', plan: a, best: best(a) },
    ];
  }

  protected series(r: StrategyResponse): BalanceSeries[] {
    const toPoints = (p: PlanSummary) => p.balances.map((v, i) => ({ date: addMonths(r.today, i), value: v }));
    return [
      { label: 'Minimums only', color: 'var(--muted)', points: toPoints(r.minimums!), dashed: true },
      { label: 'Snowball', color: 'var(--series-2)', points: toPoints(r.snowball!) },
      { label: 'Avalanche', color: 'var(--accent)', points: toPoints(r.avalanche!) },
    ];
  }
}
