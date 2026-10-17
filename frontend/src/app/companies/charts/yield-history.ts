import { observeWidth } from '../../shared/chart-width';
import { Component, computed, input, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { niceTicks } from './chart-utils';
import { DividendPoint } from './dividend-chart';
import { PricePoint } from './price-chart';

const DAY = 864e5;
const YEAR = 365 * DAY;

const H = 300;
const PAD = { l: 52, r: 24, t: 16, b: 28 };
const MAX_POINTS = 500;

const RANGES = [
  { label: '1Y', days: 365 },
  { label: '5Y', days: 1826 },
  { label: '10Y', days: 3652 },
  { label: 'Max', days: null },
];

interface YieldPoint { t: number; date: string; y: number }

@Component({
  selector: 'app-yield-history',
  imports: [DecimalPipe],
  styles: `
    :host { display: block; }
    .kpis { margin-bottom: 1.5rem; }
    .head { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; margin-bottom: .75rem; }
    .head h3 { margin: 0; }
    .ranges { display: flex; gap: .25rem; }
    .ranges button {
      background: transparent; color: var(--muted); border: 1px solid transparent;
      padding: .3rem .8rem; border-radius: 999px; font-weight: 500; font-size: .8rem;
    }
    .ranges button:hover { color: var(--text); filter: none; }
    .ranges button.on { color: var(--accent-strong); border-color: rgb(var(--accent-rgb) / .35); background: rgb(var(--accent-rgb) / .1); }
    .legend { display: flex; gap: 1.25rem; margin: 0 0 .5rem; color: var(--muted); font-size: .75rem; }
    .legend i { display: inline-block; vertical-align: middle; margin-right: .4rem; width: 16px; height: 2px; }
    .legend .yl { background: var(--accent); }
    .legend .al { background: var(--text); }
    .plot { position: relative; }
    svg { width: 100%; height: auto; display: block; touch-action: pan-y; }
    .grid { stroke: var(--line-soft); stroke-width: 1; }
    .axis-label { fill: var(--muted); font-size: 11px; font-family: var(--sans); }
    .line { fill: none; stroke: var(--accent); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
    .area { fill: var(--accent); opacity: .1; }
    .avg { stroke: var(--text); stroke-width: 1.5; }
    .avg-label { fill: var(--text); font-size: 11px; font-weight: 600; font-family: var(--sans); }
    .cross { stroke: var(--muted); stroke-width: 1; }
    .dot { fill: var(--accent); stroke: var(--surface); stroke-width: 2; }
    .tip {
      position: absolute; top: 8px; pointer-events: none; min-width: 150px;
      background: var(--bg); border: 1px solid var(--line); border-radius: 10px; padding: .55rem .75rem;
      box-shadow: var(--shadow-pop);
    }
    .tip .v { display: block; font-weight: 600; font-size: 1rem; }
    .tip .d { display: block; color: var(--muted); font-size: .75rem; margin-top: .15rem; }
    .tip .key { display: inline-block; width: 14px; height: 2px; background: var(--accent); margin-right: .45rem; vertical-align: middle; }
    .note { color: var(--muted); font-size: .75rem; margin: .75rem 0 0; line-height: 1.5; }
    details { margin-top: 1rem; color: var(--muted); }
    summary { cursor: pointer; font-size: .75rem; }
    .tbl { max-height: 220px; overflow: auto; margin-top: .5rem; }
  `,
  template: `
    <h3>Dividend yield history</h3>
    @if (stats(); as s) {
      <div class="kpis">
        <div class="kpi hero">
          <span class="label">Current yield (TTM)</span>
          <span class="value">{{ s.current | number: '1.2-2' }}%</span>
          <span class="sub">Last 12 months of dividends ÷ current price</span>
        </div>
        <div class="kpi">
          <span class="label">{{ s.avgYears }}-year average</span>
          <span class="value">{{ s.avg | number: '1.2-2' }}%</span>
          <span class="sub">Daily trailing yield, averaged</span>
        </div>
        <div class="kpi">
          <span class="label">Current vs average</span>
          <span class="value" [class.pos]="s.rel >= 0" [class.neg]="s.rel < 0">
            {{ s.rel >= 0 ? '+' : '' }}{{ s.rel | number: '1.1-1' }}%
          </span>
          <span class="sub">{{ s.rel >= 0 ? 'above' : 'below' }} its {{ s.avgYears }}-year average</span>
        </div>
      </div>

      <div class="head">
        <div class="legend">
          <span><i class="yl"></i>Yield (trailing 12 months)</span>
          <span><i class="al"></i>{{ s.avgYears }}-year average</span>
        </div>
        <div class="ranges" role="group" aria-label="Time range">
          @for (r of ranges; track r.label) {
            <button type="button" [class.on]="range() === r.label" (click)="range.set(r.label)">{{ r.label }}</button>
          }
        </div>
      </div>

      @if (view(); as v) {
        <div class="plot">
          <svg [attr.viewBox]="'0 0 ' + W() + ' ' + H" role="img" aria-label="Dividend yield over time"
               (pointermove)="move($event, v.xs)" (pointerleave)="hover.set(null)">
            <defs>
              <clipPath id="yield-clip"><rect [attr.x]="pad.l" [attr.y]="pad.t" [attr.width]="W() - pad.l - pad.r" [attr.height]="H - pad.t - pad.b" /></clipPath>
            </defs>
            @for (t of v.yTicks; track t.value) {
              <line class="grid" [attr.x1]="pad.l" [attr.x2]="W() - pad.r" [attr.y1]="t.y" [attr.y2]="t.y" />
              <text class="axis-label" [attr.x]="pad.l - 8" [attr.y]="t.y + 4" text-anchor="end">{{ t.label }}%</text>
            }
            @for (t of v.xTicks; track t.label) {
              <text class="axis-label" [attr.x]="t.x" [attr.y]="H - 8" text-anchor="middle">{{ t.label }}</text>
            }
            <g clip-path="url(#yield-clip)">
              <path class="area" [attr.d]="v.area" />
              <path class="line" [attr.d]="v.line" />
            </g>
            <line class="avg" [attr.x1]="pad.l" [attr.x2]="W() - pad.r" [attr.y1]="v.avgY" [attr.y2]="v.avgY" />
            <text class="avg-label" [attr.x]="W() - pad.r" [attr.y]="v.avgY - 6" text-anchor="end">avg {{ s.avg | number: '1.2-2' }}%</text>

            @if (hovered(); as h) {
              <line class="cross" [attr.x1]="v.xs[h]" [attr.x2]="v.xs[h]" [attr.y1]="pad.t" [attr.y2]="H - pad.b" />
              <circle class="dot" [attr.cx]="v.xs[h]" [attr.cy]="v.ys[h]" r="5" />
            } @else {
              <circle class="dot" [attr.cx]="v.xs[v.xs.length - 1]" [attr.cy]="v.ys[v.ys.length - 1]" r="5" />
            }
          </svg>

          @if (hovered(); as h) {
            <div class="tip" [style.left]="tipLeft(v.xs[h])">
              <span class="v"><span class="key"></span>{{ v.pts[h].y | number: '1.2-2' }}%</span>
              <span class="d">{{ v.pts[h].date }} · {{ v.pts[h].y >= s.avg ? '+' : '' }}{{ (v.pts[h].y - s.avg) / s.avg * 100 | number: '1.1-1' }}% vs avg</span>
            </div>
          }
        </div>

        <details>
          <summary>Table view</summary>
          <div class="tbl">
            <table>
              <thead><tr><th>Date</th><th class="num">Yield</th></tr></thead>
              <tbody>
                @for (p of v.tableRows; track p.date) {
                  <tr><td>{{ p.date }}</td><td class="num">{{ p.y | number: '1.2-2' }}%</td></tr>
                }
              </tbody>
            </table>
          </div>
        </details>
      }

      <p class="note">
        Yield on any day = dividends with an ex-date in the previous 12 months ÷ that day's close. Prices are split-adjusted, not
        dividend-adjusted. A yield above its average means the price is low relative to the payout (or the payout grew faster than
        the price). It is a context signal, not a recommendation.
      </p>
    } @else {
      <p class="empty">Not enough price and dividend history to compute a yield (needs at least one year of dividends).</p>
    }
  `,
})
export class YieldHistory {
  readonly prices = input.required<PricePoint[]>();
  readonly dividends = input.required<DividendPoint[]>();
  readonly currency = input('USD');

  protected readonly W = observeWidth();
  protected readonly H = H;
  protected readonly pad = PAD;
  protected readonly ranges = RANGES;
  protected readonly range = signal('5Y');
  protected readonly hover = signal<number | null>(null);

  /** Trailing-12-month yield (%) for every trading day that has a full year of dividend history behind it. */
  private readonly series = computed<YieldPoint[]>(() => {
    const prices = this.prices();
    const divs = [...this.dividends()].sort((a, b) => a.exDate.localeCompare(b.exDate));
    if (prices.length < 2 || !divs.length) return [];

    const dt = divs.map(d => ({ t: Date.parse(d.exDate), amount: d.amountPerShare }));
    const firstFull = dt[0].t + YEAR;
    const days: { t: number; date: string; close: number; dps: number }[] = [];
    let hi = 0, lo = 0, sum = 0;
    for (const p of prices) {
      const t = Date.parse(p.date);
      while (hi < dt.length && dt[hi].t <= t) sum += dt[hi++].amount;
      while (lo < hi && dt[lo].t <= t - YEAR) sum -= dt[lo++].amount;
      if (t >= firstFull && p.close > 0) days.push({ t, date: p.date, close: p.close, dps: sum });
    }

    // Ex-dates drift a few days between years, so the 12-month window briefly holds one payment too many or too few and the
    // trailing dividend spikes. A rolling median (about a month) removes those blips; real dividend changes persist and stay.
    const radius = 10;
    return days.map((d, i) => {
      const w = days.slice(Math.max(0, i - radius), i + radius + 1).map(x => x.dps).sort((a, b) => a - b);
      return { t: d.t, date: d.date, y: (w[Math.floor(w.length / 2)] / d.close) * 100 };
    });
  });

  protected readonly stats = computed(() => {
    const series = this.series();
    if (!series.length) return null;
    const last = series[series.length - 1];
    const recent = series.filter(s => s.t >= last.t - 5 * YEAR);
    const avg = recent.reduce((a, s) => a + s.y, 0) / recent.length;
    const avgYears = Math.max(1, Math.min(5, Math.round((last.t - recent[0].t) / YEAR)));
    return { current: last.y, avg, avgYears, diff: last.y - avg, rel: ((last.y - avg) / avg) * 100 };
  });

  protected readonly view = computed(() => {
    const W = this.W();
    const series = this.series(), s = this.stats();
    if (series.length < 2 || !s) return null;

    const last = series[series.length - 1];
    const days = RANGES.find(r => r.label === this.range())!.days;
    const cutoff = days === null ? -Infinity : last.t - days * DAY;
    let pts = series.filter(p => p.t >= cutoff);
    if (pts.length < 2) pts = series.slice(-2);
    if (pts.length > MAX_POINTS) {
      const step = (pts.length - 1) / (MAX_POINTS - 1);
      pts = Array.from({ length: MAX_POINTS }, (_, i) => pts[Math.round(i * step)]);
    }

    const ys0 = pts.map(p => p.y);
    const lo = Math.min(...ys0, s.avg), hi = Math.max(...ys0, s.avg);
    const margin = (hi - lo) * 0.1 || 0.5;
    const ticks = niceTicks(Math.max(0, lo - margin), hi + margin, 4);
    const yMin = ticks[0], yMax = ticks[ticks.length - 1];
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t;

    const x = (t: number) => PAD.l + ((t - t0) / (t1 - t0)) * (W - PAD.l - PAD.r);
    const y = (v: number) => PAD.t + (1 - (v - yMin) / (yMax - yMin)) * (H - PAD.t - PAD.b);
    const xs = pts.map(p => x(p.t)), ys = pts.map(p => y(p.y));

    const line = xs.map((px, i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${ys[i].toFixed(1)}`).join('');
    const base = H - PAD.b;
    const area = `${line}L${xs[xs.length - 1].toFixed(1)},${base}L${xs[0].toFixed(1)},${base}Z`;

    const longSpan = t1 - t0 > 2 * YEAR;
    const fmt = new Intl.DateTimeFormat('en', longSpan ? { year: 'numeric' } : { month: 'short', year: '2-digit' });
    const xTicks = [0, 1, 2, 3, 4].map(i => {
      const t = t0 + ((t1 - t0) * i) / 4;
      return { x: Math.min(Math.max(x(t), PAD.l + 16), W - PAD.r - 16), label: fmt.format(t) };
    });

    return {
      pts, xs, ys, line, area, xTicks, avgY: y(s.avg),
      yTicks: ticks.map(v => ({ value: v, y: y(v), label: `${+v.toFixed(2)}` })),
      tableRows: [...pts].reverse().slice(0, 60),
    };
  });

  protected readonly hovered = computed(() => {
    const i = this.hover();
    return i !== null && i < (this.view()?.pts.length ?? 0) ? i : null;
  });

  protected move(e: PointerEvent, xs: number[]) {
    const W = this.W();
    const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - px) < Math.abs(xs[best] - px)) best = i;
    this.hover.set(best);
  }

  protected tipLeft(px: number) {
    const W = this.W();
    const pct = (px / W) * 100;
    return pct > 60 ? `calc(${pct}% - 170px)` : `calc(${pct}% + 14px)`;
  }
}
