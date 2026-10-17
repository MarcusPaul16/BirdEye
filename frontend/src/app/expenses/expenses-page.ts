import { Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable, forkJoin } from 'rxjs';
import {
  Api, EXPENSE_CATEGORIES, ExpenseCategory, ExpenseItem, ExpenseRequest, ExpenseSummary, IncomeSummary, Recurrence, RecurringExpense, RecurringExpenses, errorMessage,
} from '../core/api';
import { BreakdownBars } from '../shared/breakdown-bars';
import { MoneyPipe } from '../shared/money.pipe';
import { TabItem, Tabs } from '../shared/tabs';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const REPEATS: { value: Recurrence; label: string; short: string }[] = [
  { value: 'OneTime', label: 'Does not repeat', short: 'One-off' },
  { value: 'Monthly', label: 'Every month', short: 'Monthly' },
  { value: 'Quarterly', label: 'Every 3 months', short: 'Quarterly' },
  { value: 'Yearly', label: 'Every year', short: 'Yearly' },
];

const today = () => new Date().toLocaleDateString('sv'); // yyyy-MM-dd in local time
const ymOf = (date: string) => date.slice(0, 7);

@Component({
  selector: 'app-expenses-page',
  imports: [MoneyPipe, DecimalPipe, FormsModule, Tabs, BreakdownBars],
  styles: `
    .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; margin-bottom: 1.25rem; }
    .toolbar h3 { margin: 0; }
    .nav { display: flex; gap: .5rem; align-items: center; }
    .nav h3 { min-width: 9ch; text-align: center; }
    .nav button { padding: .35rem .8rem; }
    .actions { display: flex; gap: .5rem; }
    .panel { padding: 1rem 0 1.5rem; margin-bottom: 1rem; border-bottom: 1px solid var(--line-soft); }

    .bars { display: flex; align-items: flex-end; gap: 4px; height: 150px; }
    .bar { flex: 1; min-width: 0; display: flex; flex-direction: column; height: 100%; background: transparent; border: 0; padding: 0; border-radius: 10px; color: var(--muted); font-weight: 400; }
    .bar:hover { background: var(--surface-2); filter: none; }
    .bar .stack { flex: 1; display: flex; flex-direction: column-reverse; gap: 2px; padding: 0 2px; }
    .bar .seg { display: block; border-radius: 4px 4px 0 0; min-height: 2px; }
    .bar .rec { background: var(--accent); }
    .bar .one { background: var(--seg-2); }
    .bar .lab { font-size: .68rem; text-align: center; padding: .35rem 0 .2rem; }
    .bar.on { background: rgb(var(--accent-rgb) / .12); color: var(--accent-strong); }
    .legend { display: flex; gap: 1.25rem; color: var(--muted); font-size: .78rem; }
    .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: .4rem; vertical-align: middle; }

    .rows { list-style: none; margin: 0; padding: 0; }
    .rows li { display: grid; grid-template-columns: 4.5rem 1fr auto auto; gap: .75rem; align-items: center; padding: .9rem .25rem; border-bottom: 1px solid var(--line-soft); }
    .rows li:last-child { border-bottom: 0; }
    .when { color: var(--muted); font-variant-numeric: tabular-nums; }
    .what { display: flex; flex-direction: column; gap: .2rem; min-width: 0; }
    .what strong { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tags { display: flex; gap: .4rem; flex-wrap: wrap; }
    .tag { font-size: .72rem; font-weight: 600; padding: .12rem .6rem; border-radius: 999px; background: var(--surface-2); color: var(--muted); }
    .tag.rec { background: rgb(var(--accent-rgb) / .14); color: var(--accent-strong); }
    .amount { text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; }
    .amount small { display: block; font-weight: 400; }
    .hint { color: var(--muted); font-size: .8rem; margin: 0 0 .75rem; }
    @media (max-width: 720px) {
      .rows li { grid-template-columns: 1fr auto; }
      .rows .when { display: none; }
      .rows li button { grid-column: 2; justify-self: end; }
      .bars { height: 110px; gap: 2px; }
      .bar .lab { font-size: .6rem; }
    }
  `,
  template: `
    <div class="page-head">
      <span class="eyebrow">Spending</span>
      <h2>Expenses</h2>
      <p>What you spend each month, with bills that repeat. Everything is converted to RON at official BNR rates.</p>
    </div>

    @if (error()) { <p class="error">{{ error() }}</p> }
    @if (!summary() && !error()) { <div class="skeleton"></div><div class="skeleton tall"></div> }

    @if (summary(); as s) {
      <p class="insight">
        @if (s.total > 0) {
          {{ isFuture() ? 'Already planned for ' + monthName() + ':' : 'In ' + monthName() + ' you ' + (isCurrent() ? 'have spent' : 'spent') }}
          <strong>{{ s.total | money: s.currency : 'symbol' : '1.0-0' }}</strong>@if (income() > 0) {,
            <strong>{{ s.total / income() * 100 | number: '1.0-0' }}%</strong> of the {{ income() | money: s.currency : 'symbol' : '1.0-0' }} your household earns, leaving
            <strong [class.pos]="left() >= 0" [class.neg]="left() < 0">{{ left() | money: s.currency : 'symbol' : '1.0-0' }}</strong>}.
          @if (s.fixedMonthly > 0) { Your recurring bills come to <strong>{{ s.fixedMonthly | money: s.currency : 'symbol' : '1.0-0' }}</strong> a month. }
        } @else {
          Nothing recorded for {{ monthName() }}.
          <small>Start with the bills that repeat (rent, subscriptions, loans), then add one-off spending as it happens.</small>
        }
      </p>

        <app-tabs [tabs]="tabs" [(active)]="tab" />

      @switch (tab()) {
        @case ('month') {
          <div class="kpis">
            <div class="kpi hero">
              <span class="label">Spent in {{ monthName() }}</span>
              <span class="value">{{ s.total | money: s.currency : 'symbol' : '1.0-0' }}</span>
              <span class="sub">
                @if (s.average12 > 0) { 12-month average {{ s.average12 | money: s.currency : 'symbol' : '1.0-0' }} } @else { No history yet }
              </span>
            </div>
            <div class="kpi">
              <span class="label">Recurring bills</span>
              <span class="value">{{ s.fixedMonthly | money: s.currency : 'symbol' : '1.0-0' }}</span>
              <span class="sub">per month on average</span>
            </div>
            <div class="kpi">
              <span class="label">Left after expenses</span>
              @if (income() > 0) {
                <span class="value" [class.pos]="left() >= 0" [class.neg]="left() < 0">{{ left() | money: s.currency : 'symbol' : '1.0-0' }}</span>
                <span class="sub">{{ left() / income() * 100 | number: '1.0-0' }}% of {{ income() | money: s.currency : 'symbol' : '1.0-0' }} income</span>
              } @else {
                <span class="value">n/a</span>
                <span class="sub">Add your income on the Income page</span>
              }
            </div>
          </div>

          <div class="card">
            <div class="toolbar">
              <h3>Last 12 months</h3>
              <div class="legend"><span><i class="rec" style="background: var(--accent)"></i>Recurring</span><span><i style="background: var(--seg-2)"></i>One-off</span></div>
            </div>
            <div class="bars" role="group" aria-label="Spending per month">
              @for (m of bars(); track m.month) {
                <button type="button" class="bar" [class.on]="m.month === month()" (click)="select(m.month)"
                        [title]="m.label + ': ' + (m.total | money: s.currency : 'symbol' : '1.0-0')">
                  <span class="stack">
                    @if (m.oneTimeH) { <i class="seg one" [style.height.%]="m.oneTimeH"></i> }
                    @if (m.recurringH) { <i class="seg rec" [style.height.%]="m.recurringH"></i> }
                  </span>
                  <span class="lab">{{ m.short }}</span>
                </button>
              }
            </div>
          </div>

          @if (s.byCategory.length) {
            <div class="card"><app-breakdown-bars title="By category" [slices]="s.byCategory" [currency]="s.currency" /></div>
          }

          <div class="card">
            <div class="toolbar">
              <div class="nav">
                <button type="button" class="ghost" (click)="step(-1)" aria-label="Previous month">‹</button>
                <h3>{{ monthName() }} {{ year() }}</h3>
                <button type="button" class="ghost" (click)="step(1)" aria-label="Next month">›</button>
                @if (!isCurrent()) { <button type="button" class="ghost" (click)="select(thisMonth)">Today</button> }
              </div>
              <div class="actions"><button type="button" (click)="toggleForm()">{{ showForm() ? 'Close' : '+ Add expense' }}</button></div>
            </div>

            @if (showForm()) {
              <div class="panel">
                <form (submit)="$event.preventDefault(); add()">
                  <label>Name <input name="name" [(ngModel)]="form.name" placeholder="e.g. Rent" required /></label>
                  <label>Amount <input name="amount" type="number" min="0" step="0.01" [(ngModel)]="form.amount" required /></label>
                  <label>Currency
                    <select name="currency" [(ngModel)]="form.currency">@for (c of currencies; track c) { <option>{{ c }}</option> }</select>
                  </label>
                  <label>Category
                    <select name="category" [(ngModel)]="form.category">@for (c of categories; track c) { <option>{{ c }}</option> }</select>
                  </label>
                  <label>Repeats
                    <select name="recurrence" [(ngModel)]="form.recurrence">@for (r of repeats; track r.value) { <option [ngValue]="r.value">{{ r.label }}</option> }</select>
                  </label>
                  <label>{{ form.recurrence === 'OneTime' ? 'Date' : 'Starts on' }} <input name="date" type="date" [(ngModel)]="form.date" required /></label>
                  @if (form.recurrence !== 'OneTime') {
                    <label>Ends on (optional) <input name="endDate" type="date" [(ngModel)]="form.endDate" /></label>
                  }
                  <button [disabled]="!form.name.trim() || !form.amount || !form.date">Add</button>
                </form>
                @if (form.recurrence !== 'OneTime') {
                  <p class="hint" style="margin-top: .75rem">It repeats on the {{ dayOf(form.date) }} of the month. Leave "Ends on" empty to keep it going; you can stop it later from the Recurring tab.</p>
                }
              </div>
            }

            <ul class="rows">
              @for (e of s.items; track e.id) {
                <li>
                  <span class="when">{{ shortDate(e.date) }}</span>
                  <span class="what">
                    <strong>{{ e.name }}</strong>
                    <span class="tags"><span class="tag">{{ e.category }}</span>@if (e.recurring) { <span class="tag rec">{{ repeatLabel(e.recurrence) }}</span> }</span>
                  </span>
                  <span class="amount">
                    {{ e.amountRon | money: s.currency : 'symbol' : '1.0-2' }}
                    @if (e.currency !== s.currency) { <small>{{ e.amount | money: e.currency }}</small> }
                  </span>
                  <button type="button" class="ghost" (click)="remove(e.id, e.name, e.recurring)">Delete</button>
                </li>
              } @empty {
                <li style="display: block; color: var(--muted); text-align: center; padding: 2rem">No expenses in {{ monthName() }}.</li>
              }
            </ul>
          </div>
        }

        @case ('recurring') {
          @if (recurring(); as r) {
            <div class="kpis">
              <div class="kpi hero">
                <span class="label">Recurring per month</span>
                <span class="value">{{ r.activeMonthlyRon | money: r.currency : 'symbol' : '1.0-0' }}</span>
                <span class="sub">{{ activeCount() }} active · quarterly and yearly bills spread over the months</span>
              </div>
              <div class="kpi">
                <span class="label">Per year</span>
                <span class="value">{{ r.activeMonthlyRon * 12 | money: r.currency : 'symbol' : '1.0-0' }}</span>
                <span class="sub">if nothing changes</span>
              </div>
            </div>
            <div class="card">
              <div class="toolbar">
                <h3>Recurring expenses</h3>
                <div class="actions"><button type="button" (click)="tab.set('month'); showForm.set(true)">+ Add expense</button></div>
              </div>
              <ul class="rows">
                @for (e of r.items; track e.id) {
                  <li [style.opacity]="e.active ? 1 : .55">
                    <span class="when">{{ repeatLabel(e.recurrence) }}</span>
                    <span class="what">
                      <strong>{{ e.name }}</strong>
                      <span class="tags">
                        <span class="tag">{{ e.category }}</span>
                        <span class="tag rec">{{ e.active ? 'Since ' + shortDate(e.since) + (e.endDate ? ', ends ' + shortDate(e.endDate) : '') : 'Ended ' + shortDate(e.endDate!) }}</span>
                      </span>
                    </span>
                    <span class="amount">
                      {{ e.amount | money: e.currency : 'symbol' : '1.0-2' }}
                      <small>{{ e.monthlyRon | money: r.currency : 'symbol' : '1.0-0' }} / month</small>
                    </span>
                    <span class="actions">
                      @if (e.active && !e.endDate) { <button type="button" class="ghost" (click)="stop(e)">Stop</button> }
                      <button type="button" class="ghost" (click)="remove(e.id, e.name, true)">Delete</button>
                    </span>
                  </li>
                } @empty {
                  <li style="display: block; color: var(--muted); text-align: center; padding: 2rem">No recurring expenses yet.</li>
                }
              </ul>
              <p class="hint" style="margin-top: 1rem">
                "Stop" ends a recurring expense today and keeps its history, so past months stay as they were. Delete removes it from every month.
                Amounts are the current ones: if a bill changes, stop the old one and add the new amount.
              </p>
            </div>
          }
        }
      }
    }
  `,
})
export class ExpensesPage {
  private readonly api = inject(Api);

  protected readonly categories: readonly ExpenseCategory[] = EXPENSE_CATEGORIES;
  protected readonly currencies = ['RON', 'EUR', 'USD', 'GBP', 'CHF'];
  protected readonly repeats = REPEATS;
  protected readonly tabs: TabItem[] = [{ id: 'month', label: 'This month' }, { id: 'recurring', label: 'Recurring' }];
  protected readonly tab = signal('month');
  protected readonly thisMonth = ymOf(today());

  protected readonly month = signal(this.thisMonth);
  protected readonly summary = signal<ExpenseSummary | null>(null);
  protected readonly recurring = signal<RecurringExpenses | null>(null);
  private readonly incomeSummary = signal<IncomeSummary | null>(null);
  protected readonly error = signal('');
  protected readonly showForm = signal(false);
  protected form = this.emptyForm();

  constructor() { this.reload(); }

  private emptyForm() {
    return { name: '', amount: 0, currency: 'RON', category: 'Other' as ExpenseCategory, recurrence: 'Monthly' as Recurrence, date: today(), endDate: '' };
  }

  protected readonly income = computed(() => this.incomeSummary()?.householdMonthly ?? 0);
  protected readonly left = computed(() => this.income() - (this.summary()?.total ?? 0));
  protected readonly activeCount = computed(() => this.recurring()?.items.filter(i => i.active).length ?? 0);
  protected readonly year = computed(() => +this.month().slice(0, 4));
  protected monthName() { return MONTHS[+this.month().slice(5, 7) - 1]; }
  protected isCurrent() { return this.month() === this.thisMonth; }
  protected isFuture() { return this.month() > this.thisMonth; }

  /** Heights are relative to the biggest month of the window, recurring and one-off stacked. */
  protected readonly bars = computed(() => {
    const series = this.summary()?.series ?? [];
    const max = Math.max(1, ...series.map(s => s.total));
    return series.map(s => {
      const m = +s.month.slice(5, 7) - 1;
      return {
        ...s, label: `${MONTHS[m]} ${s.month.slice(0, 4)}`, short: MONTHS[m].slice(0, 3),
        recurringH: (s.recurring / max) * 100, oneTimeH: (s.oneTime / max) * 100,
      };
    });
  });

  protected repeatLabel(r: Recurrence) { return REPEATS.find(x => x.value === r)!.short; }
  protected dayOf(date: string) { const d = +date.slice(8, 10); return d ? `${d}${[, 'st', 'nd', 'rd'][d % 10 > 3 || [11, 12, 13].includes(d) ? 0 : d % 10] ?? 'th'}` : '…'; }

  protected shortDate(date: string) {
    const d = new Date(date + 'T00:00:00Z');
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)}${d.getUTCFullYear() !== this.year() ? ' ' + d.getUTCFullYear() : ''}`;
  }

  protected select(month: string) { this.month.set(month); this.loadSummary(); }

  protected step(delta: number) {
    const [y, m] = this.month().split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    this.select(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }

  protected toggleForm() { this.showForm.set(!this.showForm()); }

  private loadSummary() {
    this.api.expenseSummary(this.month()).subscribe({
      next: s => this.summary.set(s),
      error: e => this.error.set(errorMessage(e)),
    });
  }

  private reload() {
    this.error.set('');
    forkJoin({ summary: this.api.expenseSummary(this.month()), recurring: this.api.recurringExpenses(), income: this.api.incomeSummary() }).subscribe({
      next: r => { this.summary.set(r.summary); this.recurring.set(r.recurring); this.incomeSummary.set(r.income); },
      error: e => this.error.set(errorMessage(e)),
    });
  }

  private run<T>(obs: Observable<T>, then?: () => void) {
    this.error.set('');
    obs.subscribe({ next: () => { then?.(); this.reload(); }, error: e => this.error.set(errorMessage(e)) });
  }

  protected add() {
    const f = this.form;
    const request: ExpenseRequest = {
      name: f.name.trim(), category: f.category, amount: f.amount, currency: f.currency, date: f.date, recurrence: f.recurrence,
      endDate: f.recurrence !== 'OneTime' && f.endDate ? f.endDate : null,
    };
    this.run(this.api.addExpense(request), () => {
      // Show the month the new expense starts in, so it is visible right away.
      if (ymOf(f.date) !== this.month()) this.month.set(ymOf(f.date));
      this.form = { ...this.emptyForm(), currency: f.currency, category: f.category, recurrence: f.recurrence };
    });
  }

  protected remove(id: number, name: string, recurring: boolean) {
    const msg = recurring ? `Delete "${name}" from every month? Use Stop to keep its history.` : `Delete "${name}"?`;
    if (confirm(msg)) this.run(this.api.deleteExpense(id));
  }

  protected stop(e: RecurringExpense) {
    if (!confirm(`Stop "${e.name}" today? Past months keep it.`)) return;
    this.run(this.api.updateExpense(e.id, {
      name: e.name, category: e.category, amount: e.amount, currency: e.currency, date: e.since, recurrence: e.recurrence, endDate: today(),
    }));
  }
}
