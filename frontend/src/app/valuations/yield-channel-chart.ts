import { observeWidth } from '../shared/chart-width';
import { Component, computed, input, signal } from '@angular/core';
import { MoneyPipe } from '../shared/money.pipe';
import { compact, niceTicks } from '../companies/charts/chart-utils';
import { ChannelPoint } from './valuation-types';

const H = 320;
const PAD = { l: 52, r: 56, t: 16, b: 28 };

/** Share price against the prices at which it would yield its historically high, median and low dividend yield. */
@Component({
  selector: 'app-yield-channel-chart',
  imports: [MoneyPipe],
  styles: `
    :host { display: block; }
    .legend { display: flex; gap: 1.25rem; flex-wrap: wrap; margin: 0 0 .75rem; color: var(--muted); font-size: .75rem; }
    .legend i { display: inline-block; vertical-align: middle; margin-right: .4rem; width: 16px; height: 2px; }
    .plot { position: relative; }
    svg { width: 100%; height: auto; display: block; touch-action: pan-y; }
    .grid { stroke: var(--line-soft); stroke-width: 1; }
    .axis-label { fill: var(--muted); font-size: 11px; font-family: var(--sans); }
    .price { fill: none; stroke: var(--accent); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
    .band { fill: none; stroke-width: 1.5; stroke-linejoin: round; }
    .cheap { stroke: var(--pos); } .fair { stroke: var(--text); } .rich { stroke: var(--neg); }
    i.cheap { background: var(--pos); } i.fair { background: var(--text); } i.rich { background: var(--neg); } i.price { background: var(--accent); height: 3px; }
    .end-label { font-size: 11px; font-family: var(--sans); fill: var(--muted); }
    .cross { stroke: var(--muted); stroke-width: 1; }
    .dot { fill: var(--accent); stroke: var(--surface); stroke-width: 2; }
    .tip {
      position: absolute; top: 8px; pointer-events: none; min-width: 170px;
      background: var(--bg); border: 1px solid var(--line); border-radius: 10px; padding: .55rem .75rem;
      box-shadow: var(--shadow-pop);
    }
    .tip .d { display: block; color: var(--muted); font-size: .75rem; margin-bottom: .3rem; }
    .tip .r { display: flex; justify-content: space-between; gap: 1rem; font-size: .85rem; }
    .tip .r b { font-variant-numeric: tabular-nums; }
    .tip i { display: inline-block; width: 12px; height: 2px; margin-right: .4rem; vertical-align: middle; }
  `,
  template: `
    <div class="legend">
      <span><i class="price"></i>Price</span>
      <span><i class="cheap"></i>Cheap (high historical yield)</span>
      <span><i class="fair"></i>Fair (median yield)</span>
      <span><i class="rich"></i>Rich (low historical yield)</span>
    </div>
    @if (view(); as v) {
      <div class="plot">
        <svg [attr.viewBox]="'0 0 ' + W() + ' ' + H" role="img" aria-label="Share price within its dividend yield channel"
             (pointermove)="move($event, v.xs)" (pointerleave)="hover.set(null)">
          <defs><clipPath id="channel-clip"><rect [attr.x]="pad.l" [attr.y]="pad.t" [attr.width]="W() - pad.l - pad.r" [attr.height]="H - pad.t - pad.b" /></clipPath></defs>
          @for (t of v.yTicks; track t.value) {
            <line class="grid" [attr.x1]="pad.l" [attr.x2]="W() - pad.r" [attr.y1]="t.y" [attr.y2]="t.y" />
            <text class="axis-label" [attr.x]="pad.l - 8" [attr.y]="t.y + 4" text-anchor="end">{{ t.label }}</text>
          }
          @for (t of v.xTicks; track t.label) {
            <text class="axis-label" [attr.x]="t.x" [attr.y]="H - 8" text-anchor="middle">{{ t.label }}</text>
          }
          <g clip-path="url(#channel-clip)">
            <path class="band rich" [attr.d]="v.rich" />
            <path class="band fair" [attr.d]="v.fair" />
            <path class="band cheap" [attr.d]="v.cheap" />
            <path class="price" [attr.d]="v.price" />
          </g>
          <text class="end-label" [attr.x]="W() - pad.r + 6" [attr.y]="v.ends.rich + 4">Rich</text>
          <text class="end-label" [attr.x]="W() - pad.r + 6" [attr.y]="v.ends.fair + 4">Fair</text>
          <text class="end-label" [attr.x]="W() - pad.r + 6" [attr.y]="v.ends.cheap + 4">Cheap</text>
          @if (hovered(); as h) {
            <line class="cross" [attr.x1]="v.xs[h]" [attr.x2]="v.xs[h]" [attr.y1]="pad.t" [attr.y2]="H - pad.b" />
            <circle class="dot" [attr.cx]="v.xs[h]" [attr.cy]="v.priceYs[h]" r="5" />
          } @else {
            <circle class="dot" [attr.cx]="v.xs[v.xs.length - 1]" [attr.cy]="v.priceYs[v.priceYs.length - 1]" r="5" />
          }
        </svg>
        @if (hovered(); as h) {
          <div class="tip" [style.left]="tipLeft(v.xs[h])">
            <span class="d">{{ points()[h].date }}</span>
            <div class="r"><span><i style="background: var(--accent)"></i>Price</span><b>{{ points()[h].price | money: currency() }}</b></div>
            <div class="r"><span><i style="background: var(--neg)"></i>Rich</span><b>{{ points()[h].rich | money: currency() }}</b></div>
            <div class="r"><span><i style="background: var(--text)"></i>Fair</span><b>{{ points()[h].fair | money: currency() }}</b></div>
            <div class="r"><span><i style="background: var(--pos)"></i>Cheap</span><b>{{ points()[h].cheap | money: currency() }}</b></div>
          </div>
        }
      </div>
    }
  `,
})
export class YieldChannelChart {
  readonly points = input.required<ChannelPoint[]>();
  readonly currency = input('USD');

  protected readonly W = observeWidth();
  protected readonly H = H;
  protected readonly pad = PAD;
  protected readonly hover = signal<number | null>(null);

  protected readonly view = computed(() => {
    const W = this.W();
    const pts = this.points();
    if (pts.length < 2) return null;

    const times = pts.map(p => Date.parse(p.date));
    const all = pts.flatMap(p => [p.price, p.cheap, p.fair, p.rich]);
    const ticks = niceTicks(Math.max(0, Math.min(...all) * 0.95), Math.max(...all) * 1.05, 4);
    const lo = ticks[0], hi = ticks[ticks.length - 1];
    const t0 = times[0], t1 = times[times.length - 1];
    const x = (t: number) => PAD.l + ((t - t0) / (t1 - t0)) * (W - PAD.l - PAD.r);
    const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
    const xs = times.map(x);
    const path = (pick: (p: ChannelPoint) => number) => pts.map((p, i) => `${i ? 'L' : 'M'}${xs[i].toFixed(1)},${y(pick(p)).toFixed(1)}`).join('');

    const long = t1 - t0 > 2 * 365 * 864e5;
    const fmt = new Intl.DateTimeFormat('en', long ? { year: 'numeric' } : { month: 'short', year: '2-digit' });
    const last = pts[pts.length - 1];
    return {
      xs, priceYs: pts.map(p => y(p.price)),
      price: path(p => p.price), cheap: path(p => p.cheap), fair: path(p => p.fair), rich: path(p => p.rich),
      yTicks: ticks.map(v => ({ value: v, y: y(v), label: compact(v) })),
      xTicks: [0, 1, 2, 3, 4].map(i => {
        const t = t0 + ((t1 - t0) * i) / 4;
        return { x: Math.min(Math.max(x(t), PAD.l + 16), W - PAD.r - 16), label: fmt.format(t) };
      }),
      ends: { cheap: Math.min(Math.max(y(last.cheap), PAD.t + 4), H - PAD.b), fair: Math.min(Math.max(y(last.fair), PAD.t + 4), H - PAD.b), rich: Math.min(Math.max(y(last.rich), PAD.t + 4), H - PAD.b) },
    };
  });

  protected readonly hovered = computed(() => {
    const i = this.hover();
    return i !== null && i < this.points().length ? i : null;
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
    return pct > 60 ? `calc(${pct}% - 190px)` : `calc(${pct}% + 14px)`;
  }
}
