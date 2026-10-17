import { observeWidth } from '../../shared/chart-width';
import { Component, computed, input, signal } from '@angular/core';
import { MoneyPipe } from '../../shared/money.pipe';
import { compact, niceTicks } from './chart-utils';

export interface PricePoint { date: string; close: number }

const H = 320;
const PAD = { l: 52, r: 24, t: 16, b: 28 };
const MAX_POINTS = 500;

const RANGES = [
  { label: '1M', days: 30 },
  { label: '6M', days: 182 },
  { label: '1Y', days: 365 },
  { label: '5Y', days: 1826 },
  { label: 'Max', days: null },
];

@Component({
  selector: 'app-price-chart',
  imports: [MoneyPipe],
  styles: `
    :host { display: block; }
    .head { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; margin-bottom: 1rem; }
    .head h3 { margin: 0; }
    .ranges { display: flex; gap: .25rem; }
    .ranges button {
      background: transparent; color: var(--muted); border: 1px solid transparent;
      padding: .3rem .8rem; border-radius: 999px; font-weight: 500; font-size: .8rem;
    }
    .ranges button:hover { color: var(--text); filter: none; }
    .ranges button.on { color: var(--accent-strong); border-color: rgb(var(--accent-rgb) / .35); background: rgb(var(--accent-rgb) / .1); }
    .plot { position: relative; }
    svg { width: 100%; height: auto; display: block; touch-action: pan-y; }
    .grid { stroke: var(--line-soft); stroke-width: 1; }
    .axis-label { fill: var(--muted); font-size: 11px; font-family: var(--sans); }
    .line { fill: none; stroke: var(--accent); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
    .area { fill: var(--accent); opacity: .1; }
    .cross { stroke: var(--muted); stroke-width: 1; }
    .dot { fill: var(--accent); stroke: var(--surface); stroke-width: 2; }
    .tip {
      position: absolute; top: 8px; pointer-events: none; min-width: 130px;
      background: var(--bg); border: 1px solid var(--line); border-radius: 10px; padding: .55rem .75rem;
      box-shadow: var(--shadow-pop);
    }
    .tip .v { display: block; font-weight: 600; font-size: 1rem; }
    .tip .d { display: block; color: var(--muted); font-size: .75rem; margin-top: .15rem; }
    .tip .key { display: inline-block; width: 14px; height: 2px; background: var(--accent); margin-right: .45rem; vertical-align: middle; }
    details { margin-top: 1rem; color: var(--muted); }
    summary { cursor: pointer; font-size: .75rem; }
    .tbl { max-height: 220px; overflow: auto; margin-top: .5rem; }
  `,
  template: `
    <div class="head">
      <h3>Price history</h3>
      <div class="ranges" role="group" aria-label="Time range">
        @for (r of ranges; track r.label) {
          <button type="button" [class.on]="range() === r.label" (click)="range.set(r.label)">{{ r.label }}</button>
        }
      </div>
    </div>

    @if (view(); as v) {
      <div class="plot">
        <svg [attr.viewBox]="'0 0 ' + W() + ' ' + H" role="img"
             [attr.aria-label]="'Price chart, ' + range() + ', last close ' + v.last.close"
             (pointermove)="move($event, v.xs)" (pointerleave)="hover.set(null)">
          <defs>
            <clipPath id="plot-clip"><rect [attr.x]="pad.l" [attr.y]="pad.t" [attr.width]="W() - pad.l - pad.r" [attr.height]="H - pad.t - pad.b" /></clipPath>
          </defs>
          @for (t of v.yTicks; track t.value) {
            <line class="grid" [attr.x1]="pad.l" [attr.x2]="W() - pad.r" [attr.y1]="t.y" [attr.y2]="t.y" />
            <text class="axis-label" [attr.x]="pad.l - 8" [attr.y]="t.y + 4" text-anchor="end">{{ t.label }}</text>
          }
          @for (t of v.xTicks; track t.label) {
            <text class="axis-label" [attr.x]="t.x" [attr.y]="H - 8" text-anchor="middle">{{ t.label }}</text>
          }
          <g [attr.clip-path]="'url(#plot-clip)'">
            <path class="area" [attr.d]="v.area" />
            <path class="line" [attr.d]="v.line" />
          </g>

          @if (hovered(); as h) {
            <line class="cross" [attr.x1]="v.xs[h]" [attr.x2]="v.xs[h]" [attr.y1]="pad.t" [attr.y2]="H - pad.b" />
            <circle class="dot" [attr.cx]="v.xs[h]" [attr.cy]="v.ys[h]" r="5" />
          } @else {
            <circle class="dot" [attr.cx]="v.xs[v.xs.length - 1]" [attr.cy]="v.ys[v.ys.length - 1]" r="5" />
          }
        </svg>

        @if (hovered(); as h) {
          <div class="tip" [style.left]="tipLeft(v.xs[h])">
            <span class="v"><span class="key"></span>{{ v.pts[h].close | money: currency() }}</span>
            <span class="d">{{ v.pts[h].date }}</span>
          </div>
        }
      </div>

      <details>
        <summary>Table view</summary>
        <div class="tbl">
          <table>
            <thead><tr><th>Date</th><th class="num">Close</th></tr></thead>
            <tbody>
              @for (p of v.tableRows; track p.date) {
                <tr><td>{{ p.date }}</td><td class="num">{{ p.close | money: currency() }}</td></tr>
              }
            </tbody>
          </table>
        </div>
      </details>
    } @else {
      <p class="empty">No price data.</p>
    }
  `,
})
export class PriceChart {
  readonly points = input.required<PricePoint[]>();
  readonly currency = input('USD');

  protected readonly W = observeWidth();
  protected readonly H = H;
  protected readonly pad = PAD;
  protected readonly ranges = RANGES;
  protected readonly range = signal('1Y');
  protected readonly hover = signal<number | null>(null);

  protected readonly view = computed(() => {
    const W = this.W();
    const all = this.points();
    if (all.length < 2) return null;

    const days = RANGES.find(r => r.label === this.range())!.days;
    const lastTime = Date.parse(all[all.length - 1].date);
    const cutoff = days === null ? -Infinity : lastTime - days * 864e5;
    let pts = all.filter(p => Date.parse(p.date) >= cutoff);
    if (pts.length < 2) pts = all.slice(-2);
    if (pts.length > MAX_POINTS) {
      const step = (pts.length - 1) / (MAX_POINTS - 1);
      pts = Array.from({ length: MAX_POINTS }, (_, i) => pts[Math.round(i * step)]);
    }

    const times = pts.map(p => Date.parse(p.date));
    const closes = pts.map(p => p.close);
    const lo = Math.min(...closes), hi = Math.max(...closes);
    const margin = (hi - lo) * 0.08 || 1;
    const tickVals = niceTicks(lo - margin, hi + margin, 4);
    const yMin = tickVals[0], yMax = tickVals[tickVals.length - 1];
    const t0 = times[0], t1 = times[times.length - 1];

    const x = (t: number) => PAD.l + ((t - t0) / (t1 - t0)) * (W - PAD.l - PAD.r);
    const y = (v: number) => PAD.t + (1 - (v - yMin) / (yMax - yMin)) * (H - PAD.t - PAD.b);
    const xs = times.map(x), ys = closes.map(y);

    const line = xs.map((px, i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${ys[i].toFixed(1)}`).join('');
    const base = H - PAD.b;
    const area = `${line}L${xs[xs.length - 1].toFixed(1)},${base}L${xs[0].toFixed(1)},${base}Z`;

    const longSpan = t1 - t0 > 2 * 365 * 864e5;
    const fmt = new Intl.DateTimeFormat('en', longSpan ? { year: 'numeric' } : { month: 'short', year: '2-digit' });
    const xTicks = [0, 1, 2, 3, 4].map(i => {
      const t = t0 + ((t1 - t0) * i) / 4;
      return { x: Math.min(Math.max(x(t), PAD.l + 16), W - PAD.r - 16), label: fmt.format(t) };
    });

    return {
      pts, xs, ys, line, area, xTicks,
      yTicks: tickVals.map(v => ({ value: v, y: y(v), label: compact(v) })),
      last: pts[pts.length - 1],
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
    return pct > 60 ? `calc(${pct}% - 150px)` : `calc(${pct}% + 14px)`;
  }
}
