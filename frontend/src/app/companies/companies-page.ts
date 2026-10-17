import { Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MoneyPipe } from '../shared/money.pipe';
import { HttpClient } from '@angular/common/http';
import { API_URL } from '../core/api';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { SymbolSearch } from '../shared/symbol-search';
import { TabItem, Tabs } from '../shared/tabs';
import { DividendChart } from './charts/dividend-chart';
import { DividendGrowth } from './charts/dividend-growth';
import { PriceChart, PricePoint } from './charts/price-chart';
import { YieldHistory } from './charts/yield-history';

interface Profile {
  symbol: string; name: string; sector?: string; industry?: string; country?: string;
  website?: string; description?: string; dividendYield?: number;
}
interface SymbolMatch { symbol: string; name: string; exchange?: string; type?: string }
interface Dividend { exDate: string; paymentDate?: string | null; amountPerShare: number; currency: string }

@Component({
  selector: 'app-companies-page',
  imports: [MoneyPipe, DecimalPipe, RouterLink, SymbolSearch, Tabs, PriceChart, DividendChart, DividendGrowth, YieldHistory],
  template: `
    <div class="page-head">
      <span class="eyebrow">Research</span>
      <h2>Companies</h2>
      <p>Look up any listed company: price, dividends, yield and growth in one place.</p>
    </div>

    <div class="card">
      <form (submit)="$event.preventDefault(); load(query())">
        <label>Company or ticker
          <app-symbol-search [(value)]="query" placeholder="Start typing, e.g. Legal or KO" (picked)="load($event)" />
        </label>
        <button [disabled]="!query().trim()">Search</button>
      </form>
    </div>
    @if (error()) { <p class="error">{{ error() }}</p> }
    @if (matches().length) {
      <div class="card">
        <h3>Did you mean</h3>
        @for (m of matches(); track m.symbol) {
          <button type="button" class="match" (click)="pick(m.symbol)">
            <span class="symbol">{{ m.symbol }}</span>
            <span>{{ m.name }}</span>
            <small>{{ m.exchange }}</small>
          </button>
        }
      </div>
    }

    @if (loadingCompany() && !profile()) { <div class="skeleton"></div><div class="skeleton tall"></div> }

    @if (profile(); as p) {
      <div class="company-head">
        <span class="badge">{{ p.symbol }}</span>
        <h3>{{ p.name }}</h3>
        <span class="sector">{{ [p.sector, p.industry, p.country].filter(x => x).join(' · ') }}</span>
        <a class="cta" routerLink="/valuations" [queryParams]="{ symbol: p.symbol }">Value this company →</a>
      </div>

      @if (summary(); as m) {
        <p class="insight">
          {{ p.name }} trades at <strong>{{ m.price | money: currency() }}</strong>@if (m.change1y !== null) {,
            <strong [class.pos]="m.change1y >= 0" [class.neg]="m.change1y < 0">{{ m.change1y >= 0 ? '+' : '' }}{{ m.change1y | number: '1.0-0' }}%</strong> over the past year}.
          @if (m.dividendPerShare > 0) {
            It pays <strong>{{ m.dividendPerShare | money: currency() }}</strong> per share a year (<strong>{{ m.yield | number: '1.2-2' }}%</strong> yield)@if (m.cagr5 !== null) {
              and has raised the dividend <strong>{{ m.cagr5 | number: '1.1-1' }}%</strong> a year on average over five years}.
          } @else {
            It has paid no dividend in the last 12 months.
          }
        </p>
      }

      <app-tabs [tabs]="tabs" [(active)]="tab" />

      @switch (tab()) {
        @case ('price') {
          <div class="card"><app-price-chart [points]="history()" [currency]="currency()" /></div>
        }
        @case ('dividends') {
          <div class="card"><app-dividend-chart [dividends]="dividends()" /></div>
          <div class="card"><app-dividend-growth [dividends]="dividends()" /></div>
          <div class="card">
            <h3>Dividend history</h3>
            @for (g of visibleYears(); track g.year) {
              <details class="year-group">
                <summary>
                  <span class="yr">{{ g.year }}</span>
                  <span class="meta">{{ g.items.length }} payment{{ g.items.length === 1 ? '' : 's' }}</span>
                  <span class="total">{{ g.total | money: g.currency : 'symbol' : '1.2-4' }}</span>
                </summary>
                <table>
                  <thead><tr><th>Ex-date</th><th>Est. payment</th><th class="num">Per share</th></tr></thead>
                  <tbody>
                    @for (d of g.items; track d.exDate) {
                      <tr><td>{{ d.exDate }}</td><td>{{ d.paymentDate }}</td><td class="num">{{ d.amountPerShare | money: d.currency : 'symbol' : '1.2-4' }}</td></tr>
                    }
                  </tbody>
                </table>
              </details>
            } @empty { <p class="empty">No dividends paid.</p> }
            @if (dividendsByYear().length > 10) {
              <div class="row-actions" style="margin-top: 1rem">
                <button type="button" class="ghost" (click)="showAllYears.set(!showAllYears())">
                  {{ showAllYears() ? 'Show the last 10 years only' : 'Show all ' + dividendsByYear().length + ' years' }}
                </button>
              </div>
            }
          </div>
        }
        @case ('yield') {
          <div class="card"><app-yield-history [prices]="history()" [dividends]="dividends()" [currency]="currency()" /></div>
        }
        @case ('about') {
          <div class="card"><h3>About</h3><p>{{ p.description || 'No description available.' }}</p>
            @if (p.website) { <p><a class="cta" [href]="p.website" target="_blank" rel="noopener noreferrer">{{ p.website }}</a></p> }
          </div>
        }
      }
    }
  `,
})
export class CompaniesPage {
  private readonly http = inject(HttpClient);
  protected readonly tabs: TabItem[] = [
    { id: 'price', label: 'Price' },
    { id: 'dividends', label: 'Dividends' },
    { id: 'yield', label: 'Yield' },
    { id: 'about', label: 'About' },
  ];
  protected readonly tab = signal('price');
  protected readonly showAllYears = signal(false);
  protected readonly loadingCompany = signal(false);
  protected readonly profile = signal<Profile | null>(null);
  protected readonly dividends = signal<Dividend[]>([]);
  /** Newest year first; each year's payments newest first. Grouped by estimated payment year, like the charts. */
  protected readonly dividendsByYear = computed(() => {
    const groups = new Map<number, Dividend[]>();
    for (const d of this.dividends()) {
      const y = +(d.paymentDate ?? d.exDate).slice(0, 4);
      groups.set(y, [...(groups.get(y) ?? []), d]);
    }
    return [...groups.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([year, items]) => ({
        year,
        items: items.sort((a, b) => b.exDate.localeCompare(a.exDate)),
        total: items.reduce((sum, d) => sum + d.amountPerShare, 0),
        currency: items[0].currency,
      }));
  });
  protected readonly visibleYears = computed(() => this.showAllYears() ? this.dividendsByYear() : this.dividendsByYear().slice(0, 10));

  /** Headline numbers for the page's opening sentence, derived from the price history and dividends already loaded. */
  protected readonly summary = computed(() => {
    const h = this.history();
    if (h.length < 2) return null;
    const last = h[h.length - 1];
    const lastT = Date.parse(last.date), yearT = lastT - 365 * 864e5;
    const ago = [...h].reverse().find(p => Date.parse(p.date) <= yearT);

    const divs = this.dividends();
    const dividendPerShare = divs.filter(d => Date.parse(d.exDate) > yearT && Date.parse(d.exDate) <= lastT).reduce((a, d) => a + d.amountPerShare, 0);

    const totals = new Map<number, number>();
    for (const d of divs) { const y = +(d.paymentDate ?? d.exDate).slice(0, 4); totals.set(y, (totals.get(y) ?? 0) + d.amountPerShare); }
    const lastYear = new Date().getFullYear() - 1, now = totals.get(lastYear), then = totals.get(lastYear - 5);
    const cagr5 = now && then && then > 0 ? (Math.pow(now / then, 1 / 5) - 1) * 100 : null;

    return {
      price: last.close,
      change1y: ago ? (last.close / ago.close - 1) * 100 : null,
      dividendPerShare, yield: (dividendPerShare / last.close) * 100, cagr5,
    };
  });

  protected readonly history = signal<PricePoint[]>([]);
  protected readonly currency = signal('USD');
  protected readonly query = signal('');
  protected readonly error = signal('');

  constructor() {
    const initial = inject(ActivatedRoute).snapshot.queryParamMap.get('symbol');
    if (initial) { this.query.set(initial); this.load(initial); }
  }
  protected readonly matches = signal<SymbolMatch[]>([]);

  protected pick(symbol: string) { this.query.set(symbol); this.load(symbol); }

  protected load(symbol: string) {
    this.matches.set([]);
    const base = `${API_URL}/companies/${encodeURIComponent(symbol.trim())}`;
    this.error.set('');
    this.loadingCompany.set(true);
    this.profile.set(null);
    this.tab.set('price');
    this.showAllYears.set(false);
    this.http.get<Profile>(base).subscribe({
      next: p => { this.profile.set(p); this.loadingCompany.set(false); },
      error: () => {
        this.loadingCompany.set(false);
        this.profile.set(null);
        this.dividends.set([]);
        this.history.set([]);
        this.http.get<SymbolMatch[]>(`${API_URL}/company-search`, { params: { q: symbol.trim() } }).subscribe({
          next: m => {
            this.matches.set(m);
            this.error.set(m.length ? `"${symbol.trim()}" is not a ticker. Pick a match:` : 'Company not found.');
          },
          error: () => this.error.set('Company not found.'),
        });
      },
    });
    this.http.get<{ date?: string; close: number }[]>(`${base}/history?from=1970-01-01`).subscribe({
      next: h => this.history.set(h as PricePoint[]),
      error: () => this.history.set([]),
    });
    this.http.get<{ currency: string }>(`${base}/quote`).subscribe({
      next: q => this.currency.set(q.currency),
      error: () => this.currency.set('USD'),
    });
    this.http.get<Dividend[]>(`${base}/dividends`).subscribe({
      next: d => this.dividends.set(d),
      error: () => this.dividends.set([]),
    });
  }
}
