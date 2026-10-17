import { Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe, PercentPipe } from '@angular/common';
import { MoneyPipe } from '../shared/money.pipe';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { Api, IncomeFrequency, IncomeSource, IncomeSummary, IncomeType, Person, errorMessage } from '../core/api';

@Component({
  selector: 'app-income-page',
  imports: [MoneyPipe, DecimalPipe, PercentPipe, FormsModule],
  styles: `
    .mix { display: flex; gap: 2px; height: 14px; border-radius: 7px; overflow: hidden; margin-bottom: 1.25rem; }
    .seg { display: block; min-width: 4px; }
    .mix-legend { list-style: none; margin: 0; padding: 0; display: grid; gap: .6rem; }
    .mix-legend li { display: grid; grid-template-columns: 14px 1fr auto 4rem; gap: .75rem; align-items: center; }
    .mix-legend i { width: 10px; height: 10px; border-radius: 3px; }
    .mix-legend .amt { font-variant-numeric: tabular-nums; font-weight: 600; }
    .mix-legend .amt small { margin-left: .25rem; }
    .mix-legend .pct { text-align: right; color: var(--muted); font-variant-numeric: tabular-nums; }
    .section-head { display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin-bottom: 1rem; flex-wrap: wrap; }
    .section-head h3 { margin: 0; }
    .actions { display: flex; gap: .5rem; }
    .actions button.ghost.on, .actions button.on { color: var(--accent-strong); border-color: var(--accent); }
    .panel { padding: 1rem 0 1.5rem; margin-bottom: 1rem; border-bottom: 1px solid var(--line-soft); }
  `,
  template: `
    <div class="page-head">
      <span class="eyebrow">Household cash flow</span>
      <h2>Income</h2>
      <p>Every source of income for you and your partner, consolidated in RON at official BNR rates.</p>
    </div>

    @if (error()) { <p class="error">{{ error() }}</p> }
    @if (summaryDividendsError()) { <p class="error">Portfolio dividends are not included: {{ summaryDividendsError() }}</p> }

    @if (!summary() && !error()) { <div class="skeleton"></div><div class="skeleton"></div> }

    @if (summary(); as s) {
      <p class="insight">
        @if (s.householdMonthly > 0) {
          Your household earns <strong>{{ s.householdMonthly | money: s.currency : 'symbol' : '1.0-0' }}</strong> a month,
          <strong>{{ s.householdMonthly * 12 | money: s.currency : 'symbol' : '1.0-0' }}</strong> a year.
          @if (parts()[0]; as top) {
            @if (parts().length > 1) { <strong>{{ top.label }}</strong> brings in <strong>{{ top.share | number: '1.0-0' }}%</strong> of it. }
          }
          @if (s.dividends.monthly > 0) {
            Portfolio dividends add <strong>{{ s.dividends.monthly | money: s.currency : 'symbol' : '1.0-0' }}</strong> a month after {{ s.dividends.taxRate | percent }} tax.
          }
        } @else {
          No income recorded yet. <button type="button" class="ghost" (click)="panel.set('source')">Add the first income source</button>
        }
      </p>

        @if (s.householdMonthly > 0) {
        <div class="card">
          <div class="mix" role="img" [attr.aria-label]="'Income mix: ' + mixLabel()">
            @for (p of parts(); track p.label; let i = $index) {
              <span class="seg" [style.flex-grow]="p.value" [style.background]="colors[i % colors.length]" [title]="p.label + ': ' + (p.share < 1 ? '<1' : (p.share | number: '1.0-0')) + '%'"></span>
            }
          </div>
          <ul class="mix-legend">
            @for (p of parts(); track p.label; let i = $index) {
              <li>
                <i [style.background]="colors[i % colors.length]"></i>
                <span class="who">{{ p.label }}</span>
                <span class="amt">{{ p.value | money: s.currency : 'symbol' : '1.0-0' }}<small> / month</small></span>
                <span class="pct">{{ p.share < 1 ? '<1' : (p.share | number: '1.0-0') }}%</span>
              </li>
            }
          </ul>
        </div>
      }
    }

    <div class="card table-wrap">
      <div class="section-head">
        <h3>Sources</h3>
        <div class="actions">
          <button type="button" class="ghost" [class.on]="panel() === 'people'" (click)="toggle('people')">People</button>
          <button type="button" class="ghost" [class.on]="panel() === 'source'" (click)="toggle('source')" [disabled]="!people().length"
                  [title]="people().length ? '' : 'Add a person first'">+ Add source</button>
        </div>
      </div>

      @if (panel() === 'people') {
        <div class="panel">
          <div class="chips">
            @for (p of people(); track p.id) {
              <span class="chip">{{ p.name }}<button class="ghost" type="button" (click)="deletePerson(p)" aria-label="Remove">✕</button></span>
            } @empty { <span style="color: var(--muted)">Add the first person to start tracking income.</span> }
          </div>
          <form (submit)="$event.preventDefault(); addPerson()">
            <label>Name <input name="personName" [(ngModel)]="personName" placeholder="e.g. Paul" required /></label>
            <button [disabled]="!personName.trim()">Add person</button>
          </form>
        </div>
      }

      @if (panel() === 'source' && people().length) {
        <div class="panel">
          <form (submit)="$event.preventDefault(); addIncome()">
            <label>Person
              <select name="personId" [(ngModel)]="form.personId">
                @for (p of people(); track p.id) { <option [ngValue]="p.id">{{ p.name }}</option> }
              </select>
            </label>
            <label>Name <input name="name" [(ngModel)]="form.name" placeholder="e.g. Salary" required /></label>
            <label>Type
              <select name="type" [(ngModel)]="form.type">
                @for (t of types; track t) { <option>{{ t }}</option> }
              </select>
            </label>
            <label>Amount <input name="amount" type="number" min="0" step="0.01" [(ngModel)]="form.amount" required /></label>
            <label>Currency
              <select name="currency" [(ngModel)]="form.currency">
                @for (c of currencies; track c) { <option>{{ c }}</option> }
              </select>
            </label>
            <label>Frequency
              <select name="frequency" [(ngModel)]="form.frequency">
                @for (f of frequencies; track f) { <option>{{ f }}</option> }
              </select>
            </label>
            <button [disabled]="!form.name.trim() || !form.amount">Add source</button>
          </form>
        </div>
      }

      <table>
        <thead><tr><th>Person</th><th>Name</th><th>Type</th><th class="num">Amount</th><th>Frequency</th><th></th></tr></thead>
        <tbody>
          @for (i of sources(); track i.id) {
            <tr>
              <td>{{ personName_(i.personId) }}</td><td>{{ i.name }}</td><td><span class="badge">{{ i.type }}</span></td>
              <td class="num">{{ i.amount | money: i.currency }}</td><td>{{ i.frequency }}</td>
              <td class="num"><button class="ghost" type="button" (click)="deleteIncome(i)">Delete</button></td>
            </tr>
          } @empty { <tr><td colspan="6" class="empty">No income sources yet.</td></tr> }
        </tbody>
      </table>
    </div>

    @if (summary()?.dividends; as d) {
      @if (d.holdings.length) {
        <div class="card">
          <details class="collapsible">
            <summary>
              <span class="title">Dividends</span>
              <span class="meta">{{ d.holdings.length }} holding{{ d.holdings.length === 1 ? '' : 's' }} · after {{ d.taxRate | percent }} tax</span>
              <span class="total">{{ d.monthly | money: summary()!.currency : 'symbol' : '1.0-0' }} <small>/ month</small></span>
            </summary>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Symbol</th><th class="num">Shares</th><th class="num">Dividend / share (12m)</th>
                    <th class="num">Gross / month</th><th class="num">Tax</th><th class="num">Net / month</th>
                  </tr>
                </thead>
                <tbody>
                  @for (h of d.holdings; track h.symbol) {
                    <tr>
                      <td class="symbol">{{ h.symbol }}</td>
                      <td class="num">{{ h.quantity }}</td>
                      <td class="num">{{ h.dividendPerShare | money: h.currency : 'symbol' : '1.2-4' }}</td>
                      <td class="num">{{ h.grossMonthly | money: summary()!.currency }}</td>
                      <td class="num neg">−{{ h.grossMonthly - h.monthly | money: summary()!.currency }}</td>
                      <td class="num">{{ h.monthly | money: summary()!.currency }}</td>
                    </tr>
                  }
                  <tr class="totals">
                    <td>Total</td><td></td><td></td>
                    <td class="num">{{ d.grossMonthly | money: summary()!.currency }}</td>
                    <td class="num neg">−{{ d.grossMonthly - d.monthly | money: summary()!.currency }}</td>
                    <td class="num">{{ d.monthly | money: summary()!.currency }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p class="note">
              Estimated from current holdings: shares held now × dividends per share paid in the last 12 months, converted at today's BNR
              rate. Tax rate is set in the backend configuration.
            </p>
          </details>
        </div>
      }
    }
  `,
})
export class IncomePage {
  private readonly api = inject(Api);

  protected readonly types: IncomeType[] = ['Salary', 'Freelance', 'Rental', 'Dividends', 'Other'];
  protected readonly frequencies: IncomeFrequency[] = ['Monthly', 'Yearly', 'OneTime'];
  protected readonly currencies = ['RON', 'EUR', 'USD', 'GBP', 'CHF'];

  protected readonly people = signal<Person[]>([]);
  protected readonly sources = signal<IncomeSource[]>([]);
  protected readonly summary = signal<IncomeSummary | null>(null);
  protected readonly error = signal('');

  protected readonly panel = signal<'people' | 'source' | null>(null);
  protected readonly colors = ['var(--seg-1)', 'var(--seg-2)', 'var(--seg-3)', 'var(--seg-4)'];

  /** Where the household's monthly income comes from: each person, then the (net) portfolio dividends. */
  protected readonly parts = computed(() => {
    const s = this.summary();
    if (!s || s.householdMonthly <= 0) return [];
    const raw = [...s.perPerson.map(p => ({ label: p.person, value: p.monthly })), ...(s.dividends.monthly > 0 ? [{ label: 'Portfolio dividends', value: s.dividends.monthly }] : [])]
      .filter(p => p.value > 0).sort((a, b) => b.value - a.value);
    return raw.map(p => ({ ...p, share: (p.value / s.householdMonthly) * 100 }));
  });

  protected mixLabel() { return this.parts().map(p => `${p.label} ${p.share.toFixed(0)}%`).join(', '); }
  protected summaryDividendsError() { const d = this.summary()?.dividends; return d && !d.available ? d.error : null; }
  protected toggle(p: 'people' | 'source') { this.panel.set(this.panel() === p ? null : p); }

  protected personName = '';
  protected form = this.emptyForm();

  constructor() { this.reload(); }

  private emptyForm() {
    return {
      personId: 0, name: '', type: 'Salary' as IncomeType, amount: 0, currency: 'RON',
      frequency: 'Monthly' as IncomeFrequency,
    };
  }

  protected personName_(id: number) { return this.people().find(p => p.id === id)?.name ?? '?'; }

  private reload() {
    this.api.people().subscribe(p => {
      this.people.set(p);
      if (!p.some(x => x.id === this.form.personId)) this.form.personId = p[0]?.id ?? 0;
    });
    this.api.incomeSources().subscribe(s => this.sources.set(s));
    this.api.incomeSummary().subscribe({
      next: s => this.summary.set(s),
      error: e => this.error.set(errorMessage(e)),
    });
  }

  private run<T>(obs: Observable<T>, then?: () => void) {
    this.error.set('');
    obs.subscribe({
      next: () => { then?.(); this.reload(); },
      error: e => this.error.set(errorMessage(e)),
    });
  }

  protected addPerson() { this.run(this.api.addPerson(this.personName.trim()), () => (this.personName = '')); }

  protected deletePerson(p: Person) {
    if (confirm(`Delete ${p.name} and all their income sources?`)) this.run(this.api.deletePerson(p.id));
  }

  protected addIncome() {
    const f = this.form;
    this.run(
      this.api.addIncome({ ...f, name: f.name.trim() }),
      () => (this.form = { ...this.emptyForm(), personId: f.personId, currency: f.currency }),
    );
  }

  protected deleteIncome(i: IncomeSource) {
    if (confirm(`Delete "${i.name}"?`)) this.run(this.api.deleteIncome(i.id));
  }
}
