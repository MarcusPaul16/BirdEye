import { Component, DestroyRef, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MoneyPipe } from '../shared/money.pipe';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Subject, debounceTime } from 'rxjs';
import { API_URL, errorMessage } from '../core/api';
import { SymbolSearch } from '../shared/symbol-search';
import { TabItem, Tabs } from '../shared/tabs';
import { FootballField } from './football-field';
import { ModelResult, ValuationReport, ValuationResponse } from './valuation-types';
import { YieldChannelChart } from './yield-channel-chart';

/** Assumption fields as the user edits them: percentages, not fractions. */
interface Form { discountRate: number; terminalGrowth: number; growth: number; dividendGrowth: number; bondYield: number }

@Component({
  selector: 'app-valuations-page',
  imports: [MoneyPipe, DecimalPipe, FormsModule, SymbolSearch, Tabs, FootballField, YieldChannelChart],
  styles: `
    .verdict { font-family: var(--serif); }
    .verdict.Undervalued { color: var(--pos); } .verdict.Overvalued { color: var(--neg); } .verdict.Fair { color: var(--accent-strong); }
    .assumptions { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 1rem; }
    .assumptions input { width: 100%; }
    .assumptions .hint { color: var(--muted); font-size: .7rem; letter-spacing: normal; text-transform: none; }
    .assumptions .changed { border-color: var(--accent); }
    .row-actions { display: flex; gap: .75rem; align-items: center; margin-top: 1rem; color: var(--muted); font-size: .8rem; }
    .model { border-bottom: 1px solid var(--line-soft); }
    .model:last-child { border-bottom: 0; }
    .model > summary {
      display: grid; grid-template-columns: 1.25rem 1fr 8rem 7rem 9.5rem; gap: .75rem; align-items: center; padding: .9rem .25rem;
      cursor: pointer; list-style: none;
    }
    .model > summary::-webkit-details-marker { display: none; }
    .model > summary::before {
      content: ''; width: .45rem; height: .45rem; border-right: 1.5px solid var(--accent); border-bottom: 1.5px solid var(--accent);
      transform: rotate(-45deg); transition: transform .15s;
    }
    .model[open] > summary::before { transform: rotate(45deg); }
    .model > summary:hover { background: rgb(var(--accent-rgb) / .05); }
    .model .name { font-weight: 600; }
    .model .fv { font-variant-numeric: tabular-nums; font-weight: 600; text-align: right; }
    .model .up { font-variant-numeric: tabular-nums; text-align: right; }
    .model .detail { padding: 0 0 1.25rem 2rem; color: var(--muted); font-size: .85rem; line-height: 1.55; }
    .model .detail p { margin: 0 0 .75rem; }
    .model .detail table { width: auto; min-width: 320px; }
    .model .detail td, .model .detail th { padding: .3rem 1.5rem .3rem 0; border: 0; }
    .model .detail td:last-child { color: var(--text); font-variant-numeric: tabular-nums; }
    .chip { font-size: .75rem; font-weight: 600; padding: .2rem .7rem; border-radius: 999px; background: var(--surface-2); color: var(--muted); text-align: center; justify-self: start; }
    .chip.in { background: rgb(var(--accent-rgb) / .14); color: var(--accent-strong); }
    .warn { color: var(--accent-strong); background: rgb(var(--accent-rgb) / .1); border-radius: var(--radius-sm); padding: .8rem 1rem; margin: 0 0 1rem; font-size: .9rem; }
    .sens td, .sens th { text-align: right; font-variant-numeric: tabular-nums; }
    .sens tbody th { text-transform: none; letter-spacing: normal; font-size: .85rem; font-weight: 600; color: var(--text); border-bottom: 1px solid var(--line-soft); padding: .9rem .75rem; }
    .sens thead th:first-child { text-align: left; }
    .sens td.base { background: rgb(var(--accent-rgb) / .15); font-weight: 700; }
    .sens td.above { color: var(--pos); }
    .disclaimer { color: var(--muted); font-size: .75rem; line-height: 1.6; max-width: 80ch; }
    .loading { color: var(--muted); }
    .company-head { display: flex; align-items: baseline; gap: 1rem; flex-wrap: wrap; margin: 1rem 0 1.5rem; }
    .company-head h3 { font-size: 2.2rem; margin: 0; }
    .company-head .sector { color: var(--muted); }
    .scenarios { display: flex; flex-wrap: wrap; gap: .5rem; margin-bottom: 1rem; }
    .scenarios button { background: var(--surface-2); color: var(--muted); padding: .55rem 1.2rem; font-weight: 600; }
    .scenarios button:hover { color: var(--text); filter: none; }
    .scenarios button.on { color: var(--bg); background: var(--text); }
    .scenario-hint { color: var(--muted); font-size: .8rem; margin: 0 0 1.25rem; }
    details.fine > summary { cursor: pointer; color: var(--muted); font-size: .8rem; list-style: none; }
    details.fine > summary::before { content: '+ '; color: var(--accent); }
    details.fine[open] > summary::before { content: '− '; }
    details.fine .assumptions { margin-top: 1rem; }
    @media (max-width: 720px) { .model > summary { grid-template-columns: 1.25rem 1fr 6rem; } .model .up, .model .chip { display: none; } }
  `,
  template: `
    <div class="page-head">
      <span class="eyebrow">Fair value</span>
      <h2>Valuations</h2>
      <p>Six independent models estimate what a company is worth from its own financials, then compare that with today's price.</p>
    </div>

    <div class="card">
      <form (submit)="$event.preventDefault(); load(query())">
        <label>Company or ticker
          <app-symbol-search [(value)]="query" placeholder="e.g. Coca-Cola or KO" (picked)="load($event)" />
        </label>
        <button [disabled]="!query().trim() || loading()">Value it</button>
      </form>
    </div>

    @if (error()) { <p class="error">{{ error() }}</p> }
    @if (loading() && !data()) {
      <div class="skeleton"></div><div class="skeleton tall"></div><div class="skeleton"></div>
    }

    @if (data(); as d) {
      @let r = d.report;
      <div class="company-head">
        <span class="badge">{{ r.symbol }}</span>
        <h3>{{ d.name }}</h3>
        <span class="sector">{{ d.sector ?? 'Fund or unclassified' }}</span>
      </div>

      <p class="insight">
        @if (r.blendedFairValue !== null && r.verdict) {
          At <strong>{{ r.price | money: r.currency }}</strong>, {{ d.name }}
          @switch (r.verdict) {
            @case ('Overvalued') { trades <strong class="neg">{{ premium(r) }}% above</strong> }
            @case ('Undervalued') { trades <strong class="pos">{{ -premium(r) }}% below</strong> }
            @default { is priced <strong>in line with</strong> }
          }
          the blended fair value of <strong>{{ r.blendedFairValue | money: r.currency }}</strong>.
          @if (r.impliedGrowth !== null) {
            The price implies about <strong>{{ r.impliedGrowth * 100 | number: '1.0-0' }}%</strong> yearly cash-flow growth for five years;
            the model assumes <strong>{{ r.assumptions.growth * 100 | number: '1.0-0' }}%</strong>.
          }
          <small>
            {{ included(r).length }} of 6 models fit this company, ranging from {{ low(r) | money: r.currency }} to {{ high(r) | money: r.currency }}.
            Mechanical estimates from public data, not advice.
          </small>
        } @else {
          No model fits this company well enough to give a fair value.
          <small>See the models below for why each one was set aside.</small>
        }
      </p>

      <app-tabs [tabs]="tabs" [(active)]="tab" />

      @switch (tab()) {
        @case ('overview') {
          <div class="kpis">
            <div class="kpi hero">
              <span class="label">Blended fair value</span>
              @if (r.blendedFairValue !== null) {
                <span class="value">{{ r.blendedFairValue | money: r.currency }}</span>
                <span class="sub">Median of the models in the blend</span>
              } @else {
                <span class="value">n/a</span>
                <span class="sub">No model is both applicable and reliable</span>
              }
            </div>
            <div class="kpi">
              <span class="label">Current price</span>
              <span class="value">{{ r.price | money: r.currency }}</span>
              @if (r.analystTarget) { <span class="sub">Analyst target {{ r.analystTarget | money: r.currency }}</span> }
            </div>
            @if (r.upside !== null && r.verdict) {
              <div class="kpi">
                <span class="label">Verdict</span>
                <span class="value verdict {{ r.verdict }}">{{ r.verdict }}</span>
                <span class="sub">Fair value is {{ r.upside >= 0 ? '+' : '' }}{{ r.upside * 100 | number: '1.0-0' }}% from price (±15% counts as fair)</span>
              </div>
            }
          </div>

          @for (w of r.warnings; track w) { <p class="warn">{{ w }}</p> }

          <div class="card">
            <h3>Fair value by model</h3>
            <app-football-field [models]="r.models" [price]="r.price" [analystTarget]="r.analystTarget" />
          </div>

          <div class="card">
            <h3>What if you are more or less optimistic?</h3>
            <div class="scenarios" role="group" aria-label="Scenario">
              @for (sc of scenarios; track sc.id) {
                <button type="button" [class.on]="activeScenario() === sc.id" (click)="applyScenario(sc.id)">{{ sc.label }}</button>
              }
            </div>
            <p class="scenario-hint">
              Conservative: growth −3 points, discount rate +1. Base: defaults from the company's own data. Optimistic: growth +5 points, discount rate −1.
              @if (loading()) { <strong> Recalculating…</strong> }
            </p>
            <details class="fine">
              <summary>Fine-tune assumptions</summary>
              <div class="assumptions">
                <label>Discount rate (%)
                  <input type="number" step="0.25" [class.changed]="changed('discountRate')" [(ngModel)]="form.discountRate" (ngModelChange)="edited()" name="discountRate" />
                  <span class="hint">Default {{ r.defaults.discountRate * 100 | number: '1.2-2' }} (risk-free + beta × 5%)</span>
                </label>
                <label>Terminal growth (%)
                  <input type="number" step="0.25" [class.changed]="changed('terminalGrowth')" [(ngModel)]="form.terminalGrowth" (ngModelChange)="edited()" name="terminalGrowth" />
                  <span class="hint">Default {{ r.defaults.terminalGrowth * 100 | number: '1.2-2' }}</span>
                </label>
                <label>Growth, DCF and Graham (%)
                  <input type="number" step="0.5" [class.changed]="changed('growth')" [(ngModel)]="form.growth" (ngModelChange)="edited()" name="growth" />
                  <span class="hint">Default {{ r.defaults.growth * 100 | number: '1.2-2' }} (median of past and expected growth)</span>
                </label>
                <label>Dividend growth, DDM (%)
                  <input type="number" step="0.5" [class.changed]="changed('dividendGrowth')" [(ngModel)]="form.dividendGrowth" (ngModelChange)="edited()" name="dividendGrowth" />
                  <span class="hint">Default {{ r.defaults.dividendGrowth * 100 | number: '1.2-2' }} (5-year dividend growth)</span>
                </label>
                <label>AAA bond yield (%)
                  <input type="number" step="0.25" [class.changed]="changed('bondYield')" [(ngModel)]="form.bondYield" (ngModelChange)="edited()" name="bondYield" />
                  <span class="hint">Default {{ r.defaults.bondYield * 100 | number: '1.2-2' }} (Graham formula)</span>
                </label>
              </div>
              <div class="row-actions"><button type="button" class="ghost" (click)="reset()">Reset to defaults</button></div>
            </details>
          </div>

          <div class="card">
            <h3>Models</h3>
            @for (m of r.models; track m.id) {
              <details class="model">
                <summary>
                  <span class="name">{{ m.name }}</span>
                  <span class="fv">{{ m.fairValue !== null ? (m.fairValue | money: r.currency) : '—' }}</span>
                  <span class="up" [class.pos]="upside(m, r.price) >= 0" [class.neg]="upside(m, r.price) < 0">{{ m.fairValue !== null ? signed(upside(m, r.price)) : '' }}</span>
                  <span class="chip" [class.in]="m.applicable && m.reliable">{{ status(m) }}</span>
                </summary>
                <div class="detail">
                  <p>{{ m.description }}</p>
                  @if (m.inputs.length) {
                    <table><tbody>@for (i of m.inputs; track i.label) { <tr><th>{{ i.label }}</th><td>{{ i.value }}</td></tr> }</tbody></table>
                  }
                  @if (m.note) { <p style="margin-top: .75rem">{{ m.note }}</p> }
                  @if (m.low !== null && m.high !== null) {
                    <p>Range: {{ m.low | money: r.currency }} to {{ m.high | money: r.currency }}</p>
                  }
                </div>
              </details>
            }
          </div>
        }

        @case ('channel') {
          @if (r.channel; as c) {
            <div class="card">
              <h3>Dividend yield channel</h3>
              <p style="color: var(--muted); margin-top: 0">
                Currently yielding {{ c.currentYield * 100 | number: '1.2-2' }}% against a {{ c.lookbackYears }}-year median of {{ c.medianYield * 100 | number: '1.2-2' }}%
                (range {{ c.richYield * 100 | number: '1.2-2' }}% to {{ c.cheapYield * 100 | number: '1.2-2' }}%).
                When the price sits below the green line the stock yields more than it usually does.
              </p>
              <app-yield-channel-chart [points]="c.points" [currency]="r.currency" />
            </div>
          } @else {
            <div class="card"><p class="empty">The yield channel needs at least three years of dividends and a dividend yield that is not tiny.</p></div>
          }
        }

        @case ('sensitivity') {
          @if (r.sensitivity; as s) {
            <div class="card table-wrap">
              <h3>DCF sensitivity</h3>
              <p style="color: var(--muted); margin-top: 0">
                DCF value per share for different discount and growth rates. Green means above the current price; the highlighted cell is your current assumption.
              </p>
              <table class="sens">
                <thead>
                  <tr><th>Discount \ Growth</th>@for (g of s.growths; track g) { <th>{{ g * 100 | number: '1.1-1' }}%</th> }</tr>
                </thead>
                <tbody>
                  @for (rate of s.discountRates; track rate; let i = $index) {
                    <tr>
                      <th>{{ rate * 100 | number: '1.2-2' }}%</th>
                      @for (g of s.growths; track g; let j = $index) {
                        <td [class.base]="isBase(rate, g, r.assumptions)" [class.above]="(s.values[i][j] ?? 0) >= r.price">
                          {{ s.values[i][j] !== null ? (s.values[i][j] | money: r.currency) : '—' }}
                        </td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <div class="card"><p class="empty">The DCF could not be computed for this company, so there is nothing to vary.</p></div>
          }
        }
      }

      <p class="disclaimer">
        These are mechanical estimates from public financial data (Yahoo Finance), not advice. Each model rests on assumptions about the
        future, and the data can be incomplete or distorted by one-off items. Models that fit a company poorly (for example cash-flow models for
        banks) are shown but excluded from the blended value. Use the range between models, and the assumptions, rather than a single number.
      </p>
    }
  `,
})
export class ValuationsPage {
  private readonly http = inject(HttpClient);

  protected readonly tabs: TabItem[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'channel', label: 'Yield channel' },
    { id: 'sensitivity', label: 'DCF sensitivity' },
  ];
  protected readonly tab = signal('overview');
  protected readonly scenarios = [{ id: 'conservative', label: 'Conservative' }, { id: 'base', label: 'Base' }, { id: 'optimistic', label: 'Optimistic' }];

  protected readonly query = signal('');
  protected readonly data = signal<ValuationResponse | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected form: Form = { discountRate: 0, terminalGrowth: 0, growth: 0, dividendGrowth: 0, bondYield: 0 };

  private symbol = '';
  private readonly edits$ = new Subject<void>();
  private request = 0;

  constructor() {
    const initial = inject(ActivatedRoute).snapshot.queryParamMap.get('symbol');
    if (initial) this.load(initial);
    this.edits$.pipe(debounceTime(500), takeUntilDestroyed(inject(DestroyRef))).subscribe(() => this.fetch(true));
  }

  protected load(symbol: string) {
    this.symbol = symbol.trim();
    if (!this.symbol) return;
    this.query.set(this.symbol);
    this.data.set(null);
    this.tab.set('overview');
    this.fetch(false);
  }

  protected reset() { this.fetch(false); }

  protected edited() { this.edits$.next(); }

  private fetch(withOverrides: boolean) {
    const ticket = ++this.request;
    this.loading.set(true);
    this.error.set('');
    const params: Record<string, number> = withOverrides ? { ...this.form } : {};
    this.http.get<ValuationResponse>(`${API_URL}/valuation/${encodeURIComponent(this.symbol)}`, { params }).subscribe({
      next: res => {
        if (ticket !== this.request) return; // a newer request superseded this one
        this.data.set(res);
        this.loading.set(false);
        if (!withOverrides) this.form = this.toForm(res.report.assumptions);
      },
      error: e => {
        if (ticket !== this.request) return;
        this.loading.set(false);
        this.data.set(null);
        this.error.set(errorMessage(e));
      },
    });
  }

  private toForm(a: { discountRate: number; terminalGrowth: number; growth: number; dividendGrowth: number; bondYield: number }): Form {
    const pct = (v: number) => +(v * 100).toFixed(2);
    return {
      discountRate: pct(a.discountRate), terminalGrowth: pct(a.terminalGrowth), growth: pct(a.growth),
      dividendGrowth: pct(a.dividendGrowth), bondYield: pct(a.bondYield),
    };
  }

  protected included(r: ValuationReport) { return r.models.filter(m => m.applicable && m.reliable && m.fairValue !== null); }
  protected low(r: ValuationReport) { return Math.min(...this.included(r).map(m => m.fairValue!)); }
  protected high(r: ValuationReport) { return Math.max(...this.included(r).map(m => m.fairValue!)); }

  /** How far the price sits above (positive) or below (negative) the blended fair value, in whole percent. */
  protected premium(r: ValuationReport) { return Math.round((r.price / r.blendedFairValue! - 1) * 100); }

  private scenarioForm(id: string): Form | null {
    const d = this.data()?.report.defaults;
    if (!d) return null;
    const base = this.toForm(d);
    switch (id) {
      case 'conservative':
        return { ...base, growth: Math.max(0, +(base.growth - 3).toFixed(2)), dividendGrowth: Math.max(0, +(base.dividendGrowth - 2).toFixed(2)), discountRate: +(base.discountRate + 1).toFixed(2) };
      case 'optimistic':
        return { ...base, growth: +(base.growth + 5).toFixed(2), dividendGrowth: +(base.dividendGrowth + 2).toFixed(2), discountRate: Math.max(+(base.terminalGrowth + 2).toFixed(2), +(base.discountRate - 1).toFixed(2)) };
      default:
        return base;
    }
  }

  protected applyScenario(id: string) {
    const f = this.scenarioForm(id);
    if (!f) return;
    this.form = f;
    this.fetch(true);
  }

  protected activeScenario(): string | null {
    for (const sc of this.scenarios) {
      const f = this.scenarioForm(sc.id);
      if (f && (Object.keys(f) as (keyof Form)[]).every(k => Math.abs(f[k] - this.form[k]) < 0.005)) return sc.id;
    }
    return null;
  }

  protected changed(field: keyof Form): boolean {
    const d = this.data()?.report.defaults;
    return d ? Math.abs(this.form[field] - +(d[field] * 100).toFixed(2)) > 0.001 : false;
  }

  protected upside(m: ModelResult, price: number) { return m.fairValue !== null && price > 0 ? m.fairValue / price - 1 : 0; }

  protected signed(v: number) { return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(0)}%`; }

  protected status(m: ModelResult) { return !m.applicable ? 'Not available' : m.reliable ? 'In blend' : 'Excluded'; }

  protected isBase(rate: number, growth: number, a: { discountRate: number; growth: number }) {
    return Math.abs(rate - a.discountRate) < 1e-6 && Math.abs(growth - a.growth) < 1e-6;
  }
}
