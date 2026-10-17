import { Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Api, LoanPaymentRow, LoanRequest, LoanRow, LoansResponse, ScheduleRow } from '../core/api';
import { addMonths, fmtDate, fmtSpan, todayIso } from '../shared/dates';
import { formatMoney, MoneyPipe } from '../shared/money.pipe';
import { TabItem, Tabs } from '../shared/tabs';
import { EarlyRepayment } from './early-repayment';
import { Strategy } from './strategy';

const CURRENCIES = ['RON', 'EUR', 'USD', 'GBP', 'CHF'];

/** The annuity instalment, for the preview next to the form only; the figures everywhere else come from the server. */
function annuity(principal: number, annualRatePercent: number, months: number): number {
  if (!(principal > 0) || !(months > 0)) return 0;
  const r = annualRatePercent / 1200;
  return r === 0 ? principal / months : (principal * r) / (1 - Math.pow(1 + r, -months));
}

/** Whole calendar months from one date to another (the end date's day of the month does not matter). */
function monthsBetween(from: string, to: string): number {
  const [y1, m1] = from.split('-').map(Number), [y2, m2] = to.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
}

@Component({
  selector: 'app-credits-page',
  imports: [MoneyPipe, DecimalPipe, FormsModule, Tabs, EarlyRepayment, Strategy],
  styles: `
    .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; margin-bottom: 1rem; }
    .toolbar h3 { margin: 0; }
    .panel { padding: .5rem 0 1.5rem; margin-bottom: 1rem; border-bottom: 1px solid var(--line-soft); }
    .preview { color: var(--muted); font-size: .85rem; margin: .9rem 0 0; line-height: 1.5; }
    .preview strong { color: var(--text); }
    .loan { background: var(--surface-2); border-radius: var(--radius); padding: 1.3rem 1.5rem; margin-bottom: 1rem; }
    .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap; }
    .top h4 { margin: 0 0 .25rem; font-size: 1.15rem; }
    .meta { color: var(--muted); font-size: .85rem; }
    .remaining { text-align: right; }
    .remaining .big { font-size: 1.6rem; font-weight: 700; letter-spacing: -.03em; font-variant-numeric: tabular-nums; }
    .bar { height: 10px; border-radius: 5px; background: var(--line); overflow: hidden; margin: 1rem 0 .4rem; }
    .bar span { display: block; height: 100%; background: var(--accent); border-radius: 5px; min-width: 3px; }
    .bar-labels { display: flex; justify-content: space-between; color: var(--muted); font-size: .8rem; }
    .facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: .9rem 1.25rem; margin: 1.1rem 0; }
    .facts div span { display: block; color: var(--muted); font-size: .78rem; margin-bottom: .15rem; }
    .facts div b { font-variant-numeric: tabular-nums; }
    .actions { display: flex; gap: .5rem; flex-wrap: wrap; }
    .done { opacity: .6; }
    .sched { margin-top: 1rem; max-height: 440px; overflow: auto; border-radius: var(--radius-sm); background: var(--surface); }
    .sched table { font-size: .85rem; }
    .sched th { position: sticky; top: 0; background: var(--surface); padding-top: .75rem; }
    .sched tr.paid td { color: var(--muted); }
    .sched tr.next td { background: rgb(var(--accent-rgb) / .12); font-weight: 600; }
    .left { background: rgb(var(--accent-rgb) / .10); border-radius: var(--radius-sm); padding: .9rem 1.1rem; margin: 1.1rem 0 0; display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; }
    .left b { font-size: 1.35rem; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
    .left small { display: block; color: var(--muted); margin-top: .15rem; }
    .pill { display: inline-block; font-size: .78rem; padding: .15rem .6rem; border-radius: 999px; background: var(--line); color: var(--muted); }
    .pill.good { background: rgb(var(--accent-rgb) / .18); color: var(--accent-strong); }
    .pill.bad { background: rgb(255 120 120 / .16); color: #ff8a8a; }
    .hint { color: var(--muted); font-size: .85rem; margin: .9rem 0 0; line-height: 1.5; }
    .hint + .actions { margin-top: 1rem; }
    .paypanel { margin-top: 1rem; padding: 1rem 0 .25rem; border-top: 1px solid var(--line-soft); }
    .paylist { margin-top: .75rem; max-height: 280px; overflow: auto; border-radius: var(--radius-sm); background: var(--surface); }
    .paylist table { font-size: .85rem; }
    .empty { color: var(--muted); text-align: center; padding: 2rem 1rem; }
  `,
  template: `
    <div class="page-head">
      <span class="eyebrow">Liabilities</span>
      <h2>Credits</h2>
      <p>Your loans with their interest and end date, and what paying them off early would do.</p>
    </div>

    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
    @if (!data() && !error()) { <div class="skeleton"></div><div class="skeleton tall"></div> }

    @if (data(); as d) {
      <p class="insight">
        @if (!d.loans.length) {
          No loans yet.
          <small>Add one to see what you still owe, when you will be debt-free and what paying it off early would save.</small>
        } @else if (!open().length) {
          All your loans are paid off. Nicely done.
        } @else {
          You owe <strong>{{ d.totals.balanceRon | money: d.currency : 'symbol' : '1.0-0' }}</strong> across {{ open().length }} loan{{ open().length === 1 ? '' : 's' }}
          and pay <strong>{{ d.totals.monthlyPaymentRon | money: d.currency : 'symbol' : '1.0-0' }}</strong> a month;
          <strong>{{ d.totals.remainingInterestRon | money: d.currency : 'symbol' : '1.0-0' }}</strong> of what is left is interest.
          @if (d.totals.next; as n) { Next payment: <strong>{{ n.name }}</strong>, {{ n.amountRon | money: d.currency : 'symbol' : '1.0-0' }} on {{ date(n.date) }}. }
        }
      </p>

      <app-tabs [tabs]="tabs" [(active)]="tab" />

      @switch (tab()) {
        @case ('loans') {
          @if (open().length) {
            <div class="kpis">
              <div class="kpi hero">
                <span class="label">Still to pay</span>
                <span class="value">{{ d.totals.balanceRon | money: d.currency : 'symbol' : '1.0-0' }}</span>
                <span class="sub">{{ open().length }} open loan{{ open().length === 1 ? '' : 's' }}, at today's BNR rate</span>
              </div>
              <div class="kpi">
                <span class="label">Monthly payments</span>
                <span class="value">{{ d.totals.monthlyPaymentRon | money: d.currency : 'symbol' : '1.0-0' }}</span>
                <span class="sub">all instalments together</span>
              </div>
              <div class="kpi">
                <span class="label">Interest still to pay</span>
                <span class="value">{{ d.totals.remainingInterestRon | money: d.currency : 'symbol' : '1.0-0' }}</span>
                <span class="sub">if you only pay the instalments</span>
              </div>
            </div>
          }

          <div class="card">
            <div class="toolbar">
              <h3>Your loans</h3>
              <button type="button" (click)="toggleForm()">{{ showForm() ? 'Close' : '+ Add loan' }}</button>
            </div>

            @if (showForm()) {
              <div class="panel">
                <form (submit)="$event.preventDefault(); save()">
                  <label>Name <input name="name" [(ngModel)]="form.name" placeholder="e.g. Mortgage" required /></label>
                  <label>Amount borrowed <input name="principal" type="number" min="0" step="100" [(ngModel)]="form.principal" required /></label>
                  <label>Currency
                    <select name="currency" [(ngModel)]="form.currency">@for (c of currencies; track c) { <option>{{ c }}</option> }</select>
                  </label>
                  <label>Interest rate (% a year) <input name="rate" type="number" min="0" max="100" step="0.01" [(ngModel)]="form.rate" required /></label>
                  <label>Started on <input name="start" type="date" [(ngModel)]="form.start" (ngModelChange)="onStart()" required /></label>
                  <label>Term (months) <input name="months" type="number" min="1" max="600" step="1" [(ngModel)]="form.months" (ngModelChange)="onMonths()" required /></label>
                  <label>Ends on <input name="end" type="date" [(ngModel)]="form.end" (ngModelChange)="onEnd()" /></label>
                  <label>Early repayment fee (%) <input name="fee" type="number" min="0" max="10" step="0.01" [(ngModel)]="form.fee" /></label>
                  <button [disabled]="busy() || !form.name.trim() || !(form.principal > 0) || !(form.months > 0) || !form.start">{{ editingId() ? 'Save changes' : 'Add loan' }}</button>
                </form>
                @if (preview(); as p) {
                  <p class="preview">
                    That is <strong>{{ p.months }} instalments</strong> ({{ span(p.months) }}) of about
                    <strong>{{ p.payment | money: form.currency }}</strong> a month, the last one on <strong>{{ date(p.end) }}</strong>.
                    Over the whole loan you would pay about <strong>{{ p.interest | money: form.currency : 'symbol' : '1.0-0' }}</strong> in interest.
                    Instalments are equal ones (an annuity) and fall on the {{ p.day }} of each month, starting one month after the start date.
                  </p>
                }
              </div>
            }

            @for (l of d.loans; track l.id) {
              <div class="loan" [class.done]="l.status.finished">
                <div class="top">
                  <div>
                    <h4>{{ l.name }}</h4>
                    <div class="meta">
                      {{ l.annualRatePercent | number: '1.0-3' }}% a year · started {{ date(l.startDate) }} · ends {{ date(l.status.endDate) }}
                      @if (l.status.finished) { · paid off } @else if (l.status.notStarted) { · not started yet }
                    </div>
                  </div>
                  <div class="remaining">
                    <div class="big">{{ l.status.balance | money: l.currency : 'symbol' : '1.0-0' }}</div>
                    <div class="meta">still to pay of {{ l.principal | money: l.currency : 'symbol' : '1.0-0' }}</div>
                  </div>
                </div>
                <div class="bar" role="img" [attr.aria-label]="(l.paidPercent | number: '1.0-0') + '% repaid'"><span [style.width.%]="l.paidPercent"></span></div>
                <div class="bar-labels"><span>{{ l.paidPercent | number: '1.0-0' }}% repaid</span><span>{{ l.status.paid }} of {{ l.months }} instalments paid</span></div>

                @if (!l.status.finished) {
                  <div class="left">
                    <div>
                      <span class="meta">Left to pay until the end</span><br />
                      <b>{{ l.status.remainingTotal | money: l.currency : 'symbol' : '0.0-0' }}</b>
                      <small>{{ l.status.remaining }} instalment{{ l.status.remaining === 1 ? '' : 's' }} of {{ l.payment | money: l.currency }}, of which {{ l.status.remainingInterest | money: l.currency : 'symbol' : '0.0-0' }} is interest · last one {{ date(l.status.endDate) }}</small>
                    </div>
                    <div>
                      @if (standing(l); as st) { <span class="pill" [class.good]="st.good" [class.bad]="!st.good">{{ st.text }}</span> }
                    </div>
                  </div>
                }

                <div class="facts">
                  <div><span>Paid so far</span><b>{{ l.status.paidTotal | money: l.currency : 'symbol' : '0.0-0' }}</b></div>
                  <div><span>Instalment</span><b>{{ l.payment | money: l.currency }}</b></div>
                  <div><span>Remaining</span><b>{{ l.status.finished ? 'Paid off' : span(l.status.remaining) }}</b></div>
                  <div><span>Next payment</span><b>{{ l.status.next ? date(l.status.next.date) : '—' }}</b></div>
                  <div><span>Interest paid so far</span><b>{{ l.status.paidInterest | money: l.currency : 'symbol' : '1.0-0' }}</b></div>
                  <div><span>Interest still to pay</span><b>{{ l.status.remainingInterest | money: l.currency : 'symbol' : '1.0-0' }}</b></div>
                  <div><span>Total interest</span><b>{{ l.status.totalInterest | money: l.currency : 'symbol' : '1.0-0' }}</b></div>
                </div>

                @if (!l.status.tracked && !l.status.finished && l.status.paid > 0) {
                  <p class="hint">
                    These figures assume you paid all {{ l.status.paid }} instalment{{ l.status.paid === 1 ? '' : 's' }} due so far, on time.
                    Record what you really paid for exact numbers: you can enter each payment, or
                    <a href="#" (click)="$event.preventDefault(); recordScheduled(l)">record the {{ l.status.paid }} instalments as paid</a> and add anything extra.
                  </p>
                } @else if (l.status.tracked) {
                  <p class="hint">Based on the {{ l.paymentCount }} payment{{ l.paymentCount === 1 ? '' : 's' }} you recorded. Interest is added every month on the instalment date.</p>
                }

                <div class="actions">
                  @if (!l.status.finished) { <button type="button" (click)="togglePay(l)">{{ payOpen() === l.id && !showPayments() ? 'Close' : '+ Add payment' }}</button> }
                  @if (!l.status.finished) { <button type="button" class="ghost" (click)="simulate(l)">Repay early…</button> }
                  @if (l.paymentCount) { <button type="button" class="ghost" (click)="togglePayments(l)">{{ payOpen() === l.id && showPayments() ? 'Hide payments' : 'Payments (' + l.paymentCount + ')' }}</button> }
                  <button type="button" class="ghost" (click)="toggleSchedule(l)">{{ openSchedule() === l.id ? 'Hide schedule' : 'Schedule' }}</button>
                  <button type="button" class="ghost" (click)="edit(l)">Edit</button>
                  <button type="button" class="ghost" (click)="remove(l)">Delete</button>
                </div>

                @if (payOpen() === l.id) {
                  <div class="paypanel">
                    @if (!showPayments()) {
                      <form (submit)="$event.preventDefault(); addPayment(l)">
                        <label>Amount paid <input name="payAmount" type="number" min="0" step="0.01" [(ngModel)]="payForm.amount" required /></label>
                        <label>Paid on <input name="payDate" type="date" [min]="l.startDate" [max]="today" [(ngModel)]="payForm.date" required /></label>
                        <label>Note <input name="payNote" maxlength="200" [(ngModel)]="payForm.note" placeholder="optional" /></label>
                        <button [disabled]="busy() || !(payForm.amount > 0) || !payForm.date">Save payment</button>
                      </form>
                      <p class="hint">Your regular instalment is {{ l.payment | money: l.currency }}. Anything above it counts as paying down the loan early.</p>
                    } @else {
                      <div class="paylist">
                        <table>
                          <thead><tr><th>Date</th><th class="num">Amount</th><th>Note</th><th></th></tr></thead>
                          <tbody>
                            @for (p of payments(); track p.id) {
                              <tr><td>{{ date(p.date) }}</td><td class="num">{{ p.amount | money: l.currency }}</td><td>{{ p.note }}</td>
                                <td class="num"><button type="button" class="ghost" (click)="removePayment(l, p)">Delete</button></td></tr>
                            }
                          </tbody>
                        </table>
                      </div>
                    }
                  </div>
                }

                @if (openSchedule() === l.id) {
                  <div class="sched">
                    @if (scheduleTracked()) { <p class="hint" style="padding: .75rem 1rem 0">Instalments still ahead, worked out from what you have really paid.</p> }
                    <table>
                      <thead><tr><th>#</th><th>Date</th><th class="num">Instalment</th><th class="num">Interest</th><th class="num">Principal</th><th class="num">Balance</th></tr></thead>
                      <tbody>
                        @for (r of schedule(); track r.number) {
                          <tr [class.paid]="r.paid" [class.next]="r.number === nextNumber()">
                            <td>{{ r.number }}</td><td>{{ date(r.date) }}</td>
                            <td class="num">{{ r.payment | money: l.currency }}</td><td class="num">{{ r.interest | money: l.currency }}</td>
                            <td class="num">{{ r.principal | money: l.currency }}</td><td class="num">{{ r.balance | money: l.currency }}</td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                }
              </div>
            } @empty {
              <p class="empty">No loans yet. Use “+ Add loan” to record your first one.</p>
            }
          </div>
        }

        @case ('early') {
          <app-early-repayment [loans]="open()" [(loanId)]="simLoanId" />
        }

        @case ('strategy') {
          <app-strategy />
        }
      }
    }
  `,
})
export class CreditsPage {
  private readonly api = inject(Api);

  protected readonly currencies = CURRENCIES;
  protected readonly tabs: TabItem[] = [
    { id: 'loans', label: 'Loans' },
    { id: 'early', label: 'Early repayment' },
    { id: 'strategy', label: 'Snowball vs avalanche' },
  ];
  protected readonly tab = signal('loans');
  protected readonly data = signal<LoansResponse | null>(null);
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly showForm = signal(false);
  protected readonly editingId = signal<number | null>(null);
  protected readonly openSchedule = signal<number | null>(null);
  protected readonly schedule = signal<ScheduleRow[]>([]);
  protected readonly scheduleTracked = signal(false);
  protected readonly payOpen = signal<number | null>(null);
  protected readonly showPayments = signal(false);
  protected readonly payments = signal<LoanPaymentRow[]>([]);
  protected readonly today = todayIso();
  protected payForm = { amount: 0, date: todayIso(), note: '' };
  protected simLoanId: number | null = null;

  protected form = this.emptyForm();

  constructor() { this.reload(); }

  private emptyForm() {
    const start = todayIso();
    return { name: '', principal: 0, currency: 'RON', rate: 0, start, months: 60, end: addMonths(start, 60), fee: 0 };
  }

  /** Loans that still have instalments to pay. */
  protected readonly open = computed<LoanRow[]>(() => this.data()?.loans.filter(l => !l.status.finished) ?? []);
  protected readonly nextNumber = computed(() => this.schedule().find(r => !r.paid)?.number ?? -1);

  protected span = fmtSpan;
  protected date = fmtDate;

  /** The preview depends on plain (non-signal) form fields, so the template asks for it again on every change. */
  protected preview() {
    const f = this.form;
    if (!(f.principal > 0) || !(f.months > 0) || !f.start) return null;
    const payment = Math.round(annuity(f.principal, f.rate || 0, f.months) * 100) / 100;
    const d = +f.start.slice(8, 10);
    return { months: f.months, payment, interest: Math.max(0, payment * f.months - f.principal), end: addMonths(f.start, f.months), day: `${d}${[, 'st', 'nd', 'rd'][d % 10 > 3 || [11, 12, 13].includes(d) ? 0 : d % 10] ?? 'th'}` };
  }

  protected onStart() { this.form.end = addMonths(this.form.start, this.form.months); }
  protected onMonths() { if (this.form.months > 0) this.form.end = addMonths(this.form.start, this.form.months); }
  protected onEnd() {
    const months = monthsBetween(this.form.start, this.form.end);
    if (months > 0) { this.form.months = months; this.form.end = addMonths(this.form.start, months); }
  }

  protected toggleForm() {
    if (this.showForm()) { this.showForm.set(false); this.editingId.set(null); return; }
    this.form = this.emptyForm();
    this.editingId.set(null);
    this.showForm.set(true);
  }

  protected edit(l: LoanRow) {
    this.form = { name: l.name, principal: l.principal, currency: l.currency, rate: l.annualRatePercent, start: l.startDate, months: l.months, end: addMonths(l.startDate, l.months), fee: l.earlyRepaymentFeePercent };
    this.editingId.set(l.id);
    this.showForm.set(true);
  }

  protected simulate(l: LoanRow) { this.simLoanId = l.id; this.tab.set('early'); }

  /** How the loan compares with paying on time: ahead or behind, with the end date in months. */
  protected standing(l: LoanRow): { good: boolean; text: string } | null {
    const s = l.status;
    if (!s.tracked) return null;
    const diff = Math.round((s.scheduledBalance - s.balance) * 100) / 100;
    const months = monthsBetween(s.endDate, s.originalEndDate);
    if (Math.abs(diff) < 1 && months === 0) return { good: true, text: 'On schedule' };
    const money = formatMoney(Math.abs(diff), l.currency, 0, 0);
    const end = months === 0 ? '' : months > 0 ? ` · ends ${fmtSpan(months)} early` : ` · ends ${fmtSpan(-months)} late`;
    return diff >= 0 ? { good: true, text: `${money} ahead of schedule${end}` } : { good: false, text: `${money} behind schedule${end}` };
  }

  protected togglePay(l: LoanRow) {
    if (this.payOpen() === l.id && !this.showPayments()) { this.payOpen.set(null); return; }
    this.payForm = { amount: l.payment, date: todayIso(), note: '' };
    this.showPayments.set(false);
    this.payOpen.set(l.id);
  }

  protected togglePayments(l: LoanRow) {
    if (this.payOpen() === l.id && this.showPayments()) { this.payOpen.set(null); return; }
    this.showPayments.set(true);
    this.payOpen.set(l.id);
    this.loadPayments(l.id);
  }

  private loadPayments(id: number) {
    this.api.loanPayments(id).subscribe({ next: r => this.payments.set(r.payments), error: e => this.fail(e) });
  }

  /** The figures and the open schedule both change with a payment, so they are fetched again. */
  private refreshAfterPayment(id: number) {
    this.reload();
    if (this.showPayments() && this.payOpen() === id) this.loadPayments(id);
    if (this.openSchedule() === id) this.api.loanSchedule(id).subscribe({ next: s => { this.schedule.set(s.installments); this.scheduleTracked.set(s.tracked); } });
  }

  protected addPayment(l: LoanRow) {
    this.error.set('');
    this.busy.set(true);
    this.api.addLoanPayment(l.id, { date: this.payForm.date, amount: this.payForm.amount, note: this.payForm.note.trim() || null }).subscribe({
      next: () => { this.busy.set(false); this.payOpen.set(null); this.refreshAfterPayment(l.id); },
      error: e => { this.busy.set(false); this.fail(e); },
    });
  }

  protected recordScheduled(l: LoanRow) {
    this.error.set('');
    this.api.recordScheduledPayments(l.id).subscribe({ next: () => this.refreshAfterPayment(l.id), error: e => this.fail(e) });
  }

  protected removePayment(l: LoanRow, p: LoanPaymentRow) {
    if (!confirm(`Delete the payment of ${formatMoney(p.amount, l.currency)} on ${fmtDate(p.date)}?`)) return;
    this.api.deleteLoanPayment(l.id, p.id).subscribe({
      next: () => { if (l.paymentCount <= 1) this.payOpen.set(null); this.refreshAfterPayment(l.id); },
      error: e => this.fail(e),
    });
  }

  protected toggleSchedule(l: LoanRow) {
    if (this.openSchedule() === l.id) { this.openSchedule.set(null); return; }
    this.openSchedule.set(l.id);
    this.schedule.set([]);
    this.api.loanSchedule(l.id).subscribe({ next: s => { this.schedule.set(s.installments); this.scheduleTracked.set(s.tracked); }, error: e => this.fail(e) });
  }

  private reload() {
    this.api.loans().subscribe({
      next: d => { this.data.set(d); if (this.simLoanId !== null && !d.loans.some(l => l.id === this.simLoanId)) this.simLoanId = null; },
      error: e => this.fail(e),
    });
  }

  private fail(e: HttpErrorResponse) {
    this.error.set(e.error && typeof e.error === 'object' && 'error' in e.error ? String(e.error.error) : 'Something went wrong. Please try again.');
  }

  protected save() {
    const f = this.form;
    const body: LoanRequest = {
      name: f.name.trim(), principal: f.principal, currency: f.currency, annualRatePercent: f.rate || 0, startDate: f.start, months: f.months, earlyRepaymentFeePercent: f.fee || 0,
    };
    this.error.set('');
    this.busy.set(true);
    const id = this.editingId();
    (id ? this.api.updateLoan(id, body) : this.api.addLoan(body)).subscribe({
      next: () => { this.busy.set(false); this.showForm.set(false); this.editingId.set(null); this.openSchedule.set(null); this.reload(); },
      error: e => { this.busy.set(false); this.fail(e); },
    });
  }

  protected remove(l: LoanRow) {
    if (!confirm(`Delete "${l.name}"?`)) return;
    this.api.deleteLoan(l.id).subscribe({ next: () => { if (this.openSchedule() === l.id) this.openSchedule.set(null); this.reload(); }, error: e => this.fail(e) });
  }
}
