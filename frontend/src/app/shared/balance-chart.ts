import { Component, computed, input, signal } from '@angular/core';
import { compact, niceTicks } from '../companies/charts/chart-utils';
import { formatMoney } from './money.pipe';
import { observeWidth } from './chart-width';

export interface BalanceSeries {
  label: string;
  /** Any CSS colour, normally a design token such as var(--accent). */
  color: string;
  points: { date: string; value: number }[];
  dashed?: boolean;
}

const H = 300;
const PAD = { l: 56, r: 20, t: 16, b: 28 };

/** Remaining balance over time, one line per scenario, with a crosshair that reads every line at the same date. */
@Component({
  selector: 'app-balance-chart',
  styles: `
    :host { display: block; }
    .legend { display: flex; flex-wrap: wrap; gap: 1.25rem; margin: 0 0 .75rem; color: var(--muted); font-size: .8rem; }
    .legend i { display: inline-block; width: 16px; height: 3px; border-radius: 2px; margin-right: .45rem; vertical-align: middle; }
    .plot { position: relative; }
    svg { width: 100%; height: auto; display: block; touch-action: pan-y; }
    .grid { stroke: var(--line-soft); stroke-width: 1; }
    .axis { fill: var(--muted); font-size: 11px; font-family: var(--sans); }
    .line { fill: none; stroke-width: 2.25; stroke-linejoin: round; stroke-linecap: round; }
    .cross { stroke: var(--muted); stroke-width: 1; }
    .dot { stroke: var(--surface); stroke-width: 2; }
    .tip { position: absolute; top: 8px; pointer-events: none; min-width: 190px; background: var(--bg); border: 1px solid var(--line); border-radius: 12px; padding: .6rem .8rem; box-shadow: var(--shadow-pop); font-size: .85rem; }
    .tip .d { display: block; color: var(--muted); font-size: .75rem; margin-bottom: .3rem; }
    .tip .r { display: flex; justify-content: space-between; gap: 1rem; }
    .tip .r b { font-variant-numeric: tabular-nums; }
    .tip i { display: inline-block; width: 12px; height: 3px; border-radius: 2px; margin-right: .4rem; vertical-align: middle; }
  `,
  template: `
    <div class="legend">
      @for (s of series(); track s.label) { <span><i [style.background]="s.color"></i>{{ s.label }}</span> }
    </div>
    @if (view(); as v) {
      <div class="plot">
        <svg [attr.viewBox]="'0 0 ' + W() + ' ' + H" role="img" aria-label="Remaining balance over time" (pointermove)="move($event)" (pointerleave)="hover.set(null)">
          @for (t of v.yTicks; track t.value) {
            <line class="grid" [attr.x1]="pad.l" [attr.x2]="W() - pad.r" [attr.y1]="t.y" [attr.y2]="t.y" />
            <text class="axis" [attr.x]="pad.l - 8" [attr.y]="t.y + 4" text-anchor="end">{{ t.label }}</text>
          }
          @for (t of v.xTicks; track t.label) {
            <text class="axis" [attr.x]="t.x" [attr.y]="H - 8" text-anchor="middle">{{ t.label }}</text>
          }
          @for (l of v.lines; track l.label) {
            <path class="line" [attr.d]="l.d" [attr.stroke]="l.color" [attr.stroke-dasharray]="l.dashed ? '6 5' : null" />
          }
          @if (hoverX(); as hx) { <line class="cross" [attr.x1]="hx" [attr.x2]="hx" [attr.y1]="pad.t" [attr.y2]="H - pad.b" /> }
          @for (d of hoverDots(); track d.label) { <circle class="dot" [attr.cx]="d.x" [attr.cy]="d.y" r="5" [attr.fill]="d.color" /> }
        </svg>
        @if (tip(); as t) {
          <div class="tip" [style.left]="tipLeft(t.x)">
            <span class="d">{{ t.date }}</span>
            @for (r of t.rows; track r.label) { <div class="r"><span><i [style.background]="r.color"></i>{{ r.label }}</span><b>{{ r.text }}</b></div> }
          </div>
        }
      </div>
    }
  `,
})
export class BalanceChart {
  readonly series = input.required<BalanceSeries[]>();
  readonly currency = input('RON');

  protected readonly H = H;
  protected readonly pad = PAD;
  protected readonly W = observeWidth(800, 300);
  protected readonly hover = signal<number | null>(null);

  protected readonly view = computed(() => {
    const W = this.W();
    const all = this.series().filter(s => s.points.length);
    if (!all.length) return null;
    const t = (d: string) => Date.parse(d + 'T00:00:00Z');
    const t0 = Math.min(...all.map(s => t(s.points[0].date))), t1 = Math.max(...all.map(s => t(s.points[s.points.length - 1].date)));
    const max = Math.max(...all.flatMap(s => s.points.map(p => p.value)), 1);
    const ticks = niceTicks(0, max * 1.04, 4), top = ticks[ticks.length - 1];
    const x = (ms: number) => PAD.l + ((ms - t0) / Math.max(1, t1 - t0)) * (W - PAD.l - PAD.r);
    const y = (v: number) => PAD.t + (1 - v / top) * (H - PAD.t - PAD.b);

    const long = t1 - t0 > 2 * 365 * 864e5;
    const fmt = new Intl.DateTimeFormat('en', long ? { year: 'numeric' } : { month: 'short', year: '2-digit' });
    return {
      t0, t1, x, y,
      lines: all.map(s => ({ ...s, d: s.points.map((p, i) => `${i ? 'L' : 'M'}${x(t(p.date)).toFixed(1)},${y(p.value).toFixed(1)}`).join('') })),
      yTicks: ticks.map(v => ({ value: v, y: y(v), label: compact(v) })),
      xTicks: [0, 1, 2, 3, 4].map(i => { const ms = t0 + ((t1 - t0) * i) / 4; return { x: Math.min(Math.max(x(ms), PAD.l + 18), W - PAD.r - 18), label: fmt.format(ms) }; }),
    };
  });

  /** The date under the pointer, snapped to the nearest instalment date of any line. */
  private readonly hoveredMs = computed(() => {
    const v = this.view(), px = this.hover();
    if (!v || px === null) return null;
    const ms = v.t0 + ((px - PAD.l) / Math.max(1, this.W() - PAD.l - PAD.r)) * (v.t1 - v.t0);
    const dates = this.series().flatMap(s => s.points.map(p => Date.parse(p.date + 'T00:00:00Z')));
    return dates.reduce((best, d) => (Math.abs(d - ms) < Math.abs(best - ms) ? d : best), dates[0]);
  });

  protected readonly hoverX = computed(() => { const v = this.view(), ms = this.hoveredMs(); return v && ms !== null ? v.x(ms) : null; });

  /** Each line's balance at the hovered date: its last point on or before it (a finished loan stays at zero). */
  private readonly readings = computed(() => {
    const ms = this.hoveredMs();
    if (ms === null) return [];
    return this.series().filter(s => s.points.length).map(s => {
      const upTo = s.points.filter(p => Date.parse(p.date + 'T00:00:00Z') <= ms);
      const value = upTo.length ? upTo[upTo.length - 1].value : s.points[0].value;
      return { label: s.label, color: s.color, value };
    });
  });

  protected readonly hoverDots = computed(() => {
    const v = this.view(), ms = this.hoveredMs();
    return v && ms !== null ? this.readings().map(r => ({ ...r, x: v.x(ms), y: v.y(r.value) })) : [];
  });

  protected readonly tip = computed(() => {
    const ms = this.hoveredMs(), v = this.view();
    if (ms === null || !v) return null;
    return {
      x: v.x(ms), date: new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric', day: 'numeric', timeZone: 'UTC' }).format(ms),
      rows: this.readings().map(r => ({ ...r, text: formatMoney(r.value, this.currency(), 0, 0) })),
    };
  });

  protected move(e: PointerEvent) {
    const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
    this.hover.set(((e.clientX - rect.left) / rect.width) * this.W());
  }

  protected tipLeft(px: number) {
    const pct = (px / this.W()) * 100;
    return pct > 60 ? `calc(${pct}% - 210px)` : `calc(${pct}% + 14px)`;
  }
}
