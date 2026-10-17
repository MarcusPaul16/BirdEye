import { Component, DestroyRef, effect, inject, input, model, signal, untracked } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Subject, debounceTime } from 'rxjs';
import { Api, EarlyResponse, EarlyScenario, ExtraResponse, LoanRow } from '../core/api';
import { BalanceChart, BalanceSeries } from '../shared/balance-chart';
import { fmtDate, fmtSpan, todayIso } from '../shared/dates';
import { MoneyPipe } from '../shared/money.pipe';

type Kind = 'lump' | 'monthly';

@Component({
  selector: 'app-early-repayment',
  imports: [MoneyPipe, FormsModule, BalanceChart],
  styles: `
    .controls { display: flex; flex-wrap: wrap; gap: 1rem; align-items: flex-end; margin-bottom: 1.25rem; }
    .seg { display: inline-flex; background: var(--surface-2); border-radius: 999px; padding: 3px; }
    .seg button { background: transparent; color: var(--muted); padding: .45rem 1rem; font-weight: 600; font-size: .85rem; }
    .seg button.on { background: var(--text); color: var(--bg); }
    .cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1rem; margin-bottom: 1rem; }
    .col { background: var(--surface-2); border-radius: var(--radius); padding: 1.25rem 1.4rem; }
    .col.best { outline: 2px solid var(--accent); }
    .col h4 { margin: 0 0 .15rem; font-size: 1rem; }
    .col .sub { color: var(--muted); font-size: .8rem; margin: 0 0 1rem; }
    .col .big { font-size: 1.7rem; font-weight: 700; letter-spacing: -.03em; font-variant-numeric: tabular-nums; }
    dl { margin: 1rem 0 0; display: grid; gap: .55rem; }
    dl div { display: flex; justify-content: space-between; gap: 1rem; font-size: .88rem; }
    dt { color: var(--muted); }
    dd { margin: 0; font-weight: 600; font-variant-numeric: tabular-nums; text-align: right; }
    .tag { display: inline-block; font-size: .7rem; font-weight: 700; padding: .12rem .6rem; border-radius: 999px; background: rgb(var(--accent-rgb) / .16); color: var(--accent-strong); margin-bottom: .6rem; }
    .note { color: var(--muted); font-size: .85rem; line-height: 1.55; margin: 1rem 0 0; }
    .empty { color: var(--muted); }
    .hint { color: var(--muted); font-size: .8rem; font-weight: 400; }
  `,
  template: `
    @if (!loans().length) {
      <div class="card"><p class="empty">Add a loan first (on the Loans tab) and you can see here what repaying part of it early would do.</p></div>
    } @else {
      <div class="card">
        <div class="controls">
          <label>Loan
            <select name="loan" [ngModel]="loanId()" (ngModelChange)="loanId.set(+$event); run()">
              @for (l of loans(); track l.id) { <option [ngValue]="l.id">{{ l.name }}</option> }
            </select>
          </label>
          <div class="seg" role="group" aria-label="Type of repayment">
            <button type="button" [class.on]="kind() === 'lump'" (click)="setKind('lump')">One payment</button>
            <button type="button" [class.on]="kind() === 'monthly'" (click)="setKind('monthly')">Extra every month</button>
          </div>
          @if (kind() === 'lump') {
            <label>Amount ({{ loan()?.currency }})
              <input name="amount" type="number" min="0" step="100" [(ngModel)]="amount" (ngModelChange)="schedule()" />
            </label>
            <label>When
              <select name="when" [(ngModel)]="whenMode" (ngModelChange)="run()">
                <option value="next">With the next instalment</option>
                <option value="date">From a date</option>
              </select>
            </label>
            @if (whenMode === 'date') {
              <label>On or after <input name="when-date" type="date" [min]="today" [(ngModel)]="whenDate" (ngModelChange)="schedule()" /></label>
            }
          } @else {
            <label>Extra per month ({{ loan()?.currency }})
              <input name="extra" type="number" min="0" step="50" [(ngModel)]="extra" (ngModelChange)="schedule()" />
            </label>
          }
        </div>
        @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
        @if (loan()?.earlyRepaymentFeePercent; as fee) { <p class="hint">This loan charges a {{ fee }}% fee on money repaid early; it is counted below.</p> }
      </div>

      @if (lump(); as r) {
        <div class="cols">
          <div class="col">
            <h4>As it is now</h4>
            <p class="sub">No early repayment</p>
            <div class="big">{{ r.current.payment | money: r.currency }}</div>
            <p class="sub" style="margin: .1rem 0 0">per month</p>
            <dl>
              <div><dt>Remaining</dt><dd>{{ span(r.current.remainingMonths) }}</dd></div>
              <div><dt>Ends</dt><dd>{{ date(r.current.endDate) }}</dd></div>
              <div><dt>Interest still to pay</dt><dd>{{ r.current.remainingInterest | money: r.currency : 'symbol' : '1.0-0' }}</dd></div>
            </dl>
          </div>
          @for (s of scenarios(r); track s.key) {
            <div class="col" [class.best]="s.best">
              @if (s.best) { <span class="tag">Saves more interest</span> }
              <h4>{{ s.title }}</h4>
              <p class="sub">{{ s.caption }}</p>
              <div class="big">{{ s.data.newPayment | money: r.currency }}</div>
              <p class="sub" style="margin: .1rem 0 0">per month{{ s.paymentDelta }}</p>
              <dl>
                <div><dt>Remaining</dt><dd>{{ s.data.paidOff ? 'Paid off' : span(s.data.remainingMonths) }}</dd></div>
                <div><dt>Ends</dt><dd>{{ date(s.data.endDate) }}@if (s.data.monthsSaved > 0) { <br><small>{{ span(s.data.monthsSaved) }} sooner</small> }</dd></div>
                <div><dt>Interest saved</dt><dd class="pos">{{ s.data.interestSaved | money: r.currency : 'symbol' : '1.0-0' }}</dd></div>
                @if (s.data.fee > 0) {
                  <div><dt>Early repayment fee</dt><dd class="neg">−{{ s.data.fee | money: r.currency : 'symbol' : '1.0-0' }}</dd></div>
                  <div><dt>Net saving</dt><dd class="pos">{{ s.data.netSaving | money: r.currency : 'symbol' : '1.0-0' }}</dd></div>
                }
              </dl>
            </div>
          }
        </div>
        <p class="note">
          The {{ r.shorten.amount | money: r.currency : 'symbol' : '1.0-0' }} goes in with the instalment of {{ date(r.shorten.atDate) }} (number {{ r.shorten.atInstallment }}).
          Shortening the term saves the most interest, because the balance keeps falling at the same pace. Reducing the instalment keeps your end date
          and frees up cash each month, but saves less. Which is better depends on whether you want to be debt-free sooner or have more room every month.
        </p>
        <div class="card"><app-balance-chart [series]="lumpSeries(r)" [currency]="r.currency" /></div>
      }

      @if (monthly(); as r) {
        <div class="cols">
          <div class="col">
            <h4>As it is now</h4>
            <p class="sub">Regular instalments only</p>
            <div class="big">{{ r.current.payment | money: r.currency }}</div>
            <p class="sub" style="margin: .1rem 0 0">per month</p>
            <dl>
              <div><dt>Remaining</dt><dd>{{ span(r.current.remainingMonths) }}</dd></div>
              <div><dt>Ends</dt><dd>{{ date(r.current.endDate) }}</dd></div>
              <div><dt>Interest still to pay</dt><dd>{{ r.current.remainingInterest | money: r.currency : 'symbol' : '1.0-0' }}</dd></div>
            </dl>
          </div>
          <div class="col best">
            <span class="tag">With the extra</span>
            <h4>+ {{ extra | money: r.currency : 'symbol' : '1.0-0' }} every month</h4>
            <p class="sub">The instalment stays, the loan ends sooner</p>
            <div class="big">{{ r.scenario.newPayment | money: r.currency }}</div>
            <p class="sub" style="margin: .1rem 0 0">per month in total</p>
            <dl>
              <div><dt>Remaining</dt><dd>{{ span(r.scenario.remainingMonths) }}</dd></div>
              <div><dt>Ends</dt><dd>{{ date(r.scenario.endDate) }}<br><small>{{ span(r.scenario.monthsSaved) }} sooner</small></dd></div>
              <div><dt>Interest saved</dt><dd class="pos">{{ r.scenario.interestSaved | money: r.currency : 'symbol' : '1.0-0' }}</dd></div>
              @if (r.scenario.fee > 0) {
                <div><dt>Early repayment fees</dt><dd class="neg">−{{ r.scenario.fee | money: r.currency : 'symbol' : '1.0-0' }}</dd></div>
                <div><dt>Net saving</dt><dd class="pos">{{ r.scenario.netSaving | money: r.currency : 'symbol' : '1.0-0' }}</dd></div>
              }
            </dl>
          </div>
        </div>
        <div class="card"><app-balance-chart [series]="monthlySeries(r)" [currency]="r.currency" /></div>
      }
    }
  `,
})
export class EarlyRepayment {
  private readonly api = inject(Api);

  readonly loans = input.required<LoanRow[]>();
  readonly loanId = model<number | null>(null);

  protected readonly today = todayIso();
  protected readonly kind = signal<Kind>('lump');
  protected readonly lump = signal<EarlyResponse | null>(null);
  protected readonly monthly = signal<ExtraResponse | null>(null);
  protected readonly error = signal('');
  protected amount = 5000;
  protected extra = 300;
  protected whenMode: 'next' | 'date' = 'next';
  protected whenDate = '';

  private readonly input$ = new Subject<void>();
  private request = 0;

  constructor() {
    this.input$.pipe(debounceTime(400), takeUntilDestroyed(inject(DestroyRef))).subscribe(() => this.run());
    // Pick a loan when there is none yet, or when the chosen one is gone, then calculate.
    effect(() => {
      const list = this.loans(), id = this.loanId();
      untracked(() => {
        if (!list.length) { this.lump.set(null); this.monthly.set(null); return; }
        if (id === null || !list.some(l => l.id === id)) this.loanId.set(list[0].id);
        this.run();
      });
    });
  }

  protected loan() { return this.loans().find(l => l.id === this.loanId()); }
  protected schedule() { this.input$.next(); }
  protected setKind(k: Kind) { this.kind.set(k); this.run(); }
  protected span = fmtSpan;
  protected date = fmtDate;

  protected run() {
    const id = this.loanId();
    if (id === null) return;
    const ticket = ++this.request;
    this.error.set('');
    const fail = (e: HttpErrorResponse) => {
      if (ticket !== this.request) return;
      this.error.set(e.error && typeof e.error === 'object' && 'error' in e.error ? String(e.error.error) : 'Could not calculate this.');
      this.lump.set(null); this.monthly.set(null);
    };

    if (this.kind() === 'lump') {
      if (!(this.amount > 0)) { this.lump.set(null); return; }
      const when = this.whenMode === 'date' && this.whenDate ? this.whenDate : null;
      this.api.earlyRepayment(id, this.amount, when).subscribe({ next: r => { if (ticket === this.request) { this.lump.set(r); this.monthly.set(null); } }, error: fail });
    } else {
      if (!(this.extra > 0)) { this.monthly.set(null); return; }
      this.api.extraMonthly(id, this.extra).subscribe({ next: r => { if (ticket === this.request) { this.monthly.set(r); this.lump.set(null); } }, error: fail });
    }
  }

  protected scenarios(r: EarlyResponse): { key: string; title: string; caption: string; data: EarlyScenario; best: boolean; paymentDelta: string }[] {
    const best = r.shorten.interestSaved >= r.reduce.interestSaved ? 'shorten' : 'reduce';
    const delta = (s: EarlyScenario) => {
      const d = s.newPayment - r.current.payment;
      return Math.abs(d) < 0.005 ? ', unchanged' : `, ${d < 0 ? '−' : '+'}${Math.abs(d).toFixed(2)}`;
    };
    return [
      { key: 'shorten', title: 'Shorten the term', caption: 'Same instalment, loan ends sooner', data: r.shorten, best: best === 'shorten', paymentDelta: delta(r.shorten) },
      { key: 'reduce', title: 'Reduce the instalment', caption: 'Same end date, smaller instalment', data: r.reduce, best: best === 'reduce', paymentDelta: delta(r.reduce) },
    ];
  }

  private pts = (p: { date: string; balance: number }[]) => p.map(x => ({ date: x.date, value: x.balance }));

  protected lumpSeries(r: EarlyResponse): BalanceSeries[] {
    return [
      { label: 'As it is now', color: 'var(--muted)', points: this.pts(r.chart.current), dashed: true },
      { label: 'Shorten the term', color: 'var(--accent)', points: this.pts(r.chart.shorten) },
      { label: 'Reduce the instalment', color: 'var(--series-2)', points: this.pts(r.chart.reduce) },
    ];
  }

  protected monthlySeries(r: ExtraResponse): BalanceSeries[] {
    return [
      { label: 'As it is now', color: 'var(--muted)', points: this.pts(r.chart.current), dashed: true },
      { label: 'With the extra every month', color: 'var(--accent)', points: this.pts(r.chart.scenario) },
    ];
  }
}
