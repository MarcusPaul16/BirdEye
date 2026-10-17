import { Component, computed, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MoneyPipe } from '../../shared/money.pipe';
import { DividendPoint } from './dividend-chart';

interface Horizon { label: string; years: number; growth: number | null; from: number; to: number; fromTotal: number; toTotal: number }

@Component({
  selector: 'app-dividend-growth',
  imports: [MoneyPipe, DecimalPipe],
  styles: `
    :host { display: block; }
    h3 { margin-bottom: 1rem; }
    .kpis { margin-bottom: 0; }
    .na { color: var(--muted); }
    .note { color: var(--muted); font-size: .75rem; margin: 1rem 0 0; line-height: 1.5; }
  `,
  template: `
    <h3>Dividend growth</h3>
    @if (stats(); as s) {
      <div class="kpis">
        @for (h of s.horizons; track h.label) {
          <div class="kpi" [class.hero]="h.years === 1">
            <span class="label">{{ h.label }}</span>
            @if (h.growth !== null) {
              <span class="value" [class.pos]="h.growth >= 0" [class.neg]="h.growth < 0">
                {{ h.growth >= 0 ? '+' : '' }}{{ h.growth | number: '1.1-1' }}%
              </span>
              <span class="sub">
                {{ h.from }}: {{ h.fromTotal | money: s.currency : 'symbol' : '1.2-2' }} →
                {{ h.to }}: {{ h.toTotal | money: s.currency : 'symbol' : '1.2-2' }}
              </span>
            } @else {
              <span class="value na">n/a</span>
              <span class="sub">Not enough history</span>
            }
          </div>
        }
      </div>
      <p class="note">
        Growth rates use completed calendar years of dividends per share, by estimated payment year. YoY compares {{ s.lastYear }} with
        {{ s.lastYear - 1 }}. 3Y, 5Y and 10Y are compound annual growth rates (CAGR) ending in {{ s.lastYear }}.
        The current year is excluded because it is incomplete.
      </p>
    } @else {
      <p class="empty">Not enough completed years of dividends to compute growth.</p>
    }
  `,
})
export class DividendGrowth {
  readonly dividends = input.required<DividendPoint[]>();

  protected readonly stats = computed(() => {
    const divs = this.dividends();
    if (!divs.length) return null;

    const byYear = new Map<number, number>();
    for (const d of divs) {
      const y = +(d.paymentDate ?? d.exDate).slice(0, 4);
      byYear.set(y, (byYear.get(y) ?? 0) + d.amountPerShare);
    }

    const lastYear = new Date().getFullYear() - 1;
    const lastTotal = byYear.get(lastYear);
    if (!lastTotal) return null;

    const horizons: Horizon[] = [
      { label: 'YoY', years: 1 }, { label: '3Y CAGR', years: 3 }, { label: '5Y CAGR', years: 5 }, { label: '10Y CAGR', years: 10 },
    ].map(({ label, years }) => {
      const from = lastYear - years;
      const fromTotal = byYear.get(from) ?? 0;
      const growth = fromTotal > 0 ? (Math.pow(lastTotal / fromTotal, 1 / years) - 1) * 100 : null;
      return { label, years, growth, from, to: lastYear, fromTotal, toTotal: lastTotal };
    });

    return { currency: divs[0].currency, lastYear, horizons };
  });
}
