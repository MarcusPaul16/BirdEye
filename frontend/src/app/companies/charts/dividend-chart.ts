import { observeWidth } from '../../shared/chart-width';
import { Component, computed, input, signal } from '@angular/core';
import { MoneyPipe } from '../../shared/money.pipe';
import { amount, compact, niceTicks } from './chart-utils';

export interface DividendPoint { exDate: string; paymentDate?: string | null; amountPerShare: number; currency: string }
type Grain = 'year' | 'quarter';

interface Period { key: number; label: string; axis: string; total: number; count: number; partial: boolean }

const H = 280;
const PAD = { l: 52, r: 24, t: 28, b: 28 };
const WINDOW: Record<Grain, number> = { year: 15, quarter: 16 };
const MAX_BAR = 24;

@Component({
  selector: 'app-dividend-chart',
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
    .ranges button.on { color: var(--gold-bright); border-color: rgb(var(--gold-rgb) / .35); background: rgb(var(--gold-rgb) / .1); }
    .plot { position: relative; }
    svg { width: 100%; height: auto; display: block; }
    .grid { stroke: var(--line-soft); stroke-width: 1; }
    .axis-label { fill: var(--muted); font-size: 11px; font-family: var(--sans); }
    .bar { fill: var(--gold); }
    .bar.dim { opacity: .55; }
    .bar.on { fill: var(--gold-bright); opacity: 1; }
    .hit { fill: transparent; }
    .value-label { fill: var(--text); font-size: 11px; font-weight: 600; font-family: var(--sans); }
    .tip {
      position: absolute; top: 8px; pointer-events: none; min-width: 150px;
      background: var(--bg); border: 1px solid var(--line); border-radius: 10px; padding: .55rem .75rem;
      box-shadow: var(--shadow-pop);
    }
    .tip .v { display: block; font-weight: 600; font-size: 1rem; }
    .tip .d { display: block; color: var(--muted); font-size: .75rem; margin-top: .15rem; }
    details { margin-top: 1rem; color: var(--muted); }
    summary { cursor: pointer; font-size: .75rem; letter-spacing: .12em; text-transform: uppercase; }
    .tbl { max-height: 220px; overflow: auto; margin-top: .5rem; }
    .note { color: var(--muted); font-size: .75rem; margin: .75rem 0 0; }
  `,
  template: `
    <div class="head">
      <h3>Dividends per share</h3>
      <div class="ranges" role="group" aria-label="Group dividends by">
        <button type="button" [class.on]="grain() === 'year'" (click)="setGrain('year')">Yearly</button>
        <button type="button" [class.on]="grain() === 'quarter'" (click)="setGrain('quarter')">Quarterly</button>
      </div>
    </div>

    @if (view(); as v) {
      <div class="plot">
        <svg [attr.viewBox]="'0 0 ' + W() + ' ' + H" role="img"
             [attr.aria-label]="'Dividends per share by ' + grain()" (pointerleave)="hover.set(null)">
          @for (t of v.yTicks; track t.value) {
            <line class="grid" [attr.x1]="pad.l" [attr.x2]="W() - pad.r" [attr.y1]="t.y" [attr.y2]="t.y" />
            <text class="axis-label" [attr.x]="pad.l - 8" [attr.y]="t.y + 4" text-anchor="end">{{ t.label }}</text>
          }
          @for (b of v.bars; track b.key; let i = $index) {
            <rect class="hit" [attr.x]="b.slotX" [attr.y]="pad.t" [attr.width]="v.slot" [attr.height]="H - pad.t - pad.b"
                  (pointerenter)="hover.set(i)" (pointermove)="hover.set(i)" />
            @if (b.total > 0) {
              <path class="bar" [class.dim]="b.partial" [class.on]="hover() === i" [attr.d]="b.path" />
              <text class="value-label" [attr.x]="b.cx" [attr.y]="b.top - 6" text-anchor="middle">{{ b.valueLabel }}</text>
            }
            <text class="axis-label" [attr.x]="b.cx" [attr.y]="H - 8" text-anchor="middle">{{ b.axis }}</text>
          }
        </svg>

        @if (hovered(); as h) {
          <div class="tip" [style.left]="tipLeft(v.bars[h.i].cx)">
            <span class="v">{{ h.bar.total | money: currency() : 'symbol' : '1.2-4' }}</span>
            <span class="d">{{ h.bar.label }}{{ h.bar.partial ? ' (in progress)' : '' }} ·
              {{ h.bar.count }} payment{{ h.bar.count === 1 ? '' : 's' }}</span>
          </div>
        }
      </div>
      <p class="note">Last {{ v.bars.length }} {{ grain() === 'year' ? 'years' : 'quarters' }}, by estimated payment date (ex-date + 14 days; the data source publishes ex-dates only). The table lists the full history.</p>

      <details>
        <summary>Table view</summary>
        <div class="tbl">
          <table>
            <thead><tr><th>Period</th><th class="num">Per share</th><th class="num">Payments</th></tr></thead>
            <tbody>
              @for (b of tableRows(); track b.key) {
                <tr><td>{{ b.label }}</td><td class="num">{{ b.total | money: currency() : 'symbol' : '1.2-4' }}</td><td class="num">{{ b.count }}</td></tr>
              }
            </tbody>
          </table>
        </div>
      </details>
    } @else {
      <p class="empty">No dividends paid.</p>
    }
  `,
})
export class DividendChart {
  readonly dividends = input.required<DividendPoint[]>();

  protected readonly W = observeWidth();
  protected readonly H = H;
  protected readonly pad = PAD;
  protected readonly grain = signal<Grain>('year');
  protected readonly hover = signal<number | null>(null);

  protected readonly currency = computed(() => this.dividends()[0]?.currency ?? 'USD');

  /** Contiguous periods from the first payment to now; periods without a payment are kept as empty slots. */
  private readonly periods = computed<Period[]>(() => {
    const grain = this.grain();
    const divs = this.dividends();
    if (!divs.length) return [];

    const keyOf = (date: string) => {
      const y = +date.slice(0, 4), m = +date.slice(5, 7);
      return grain === 'year' ? y : y * 4 + Math.floor((m - 1) / 3);
    };
    const sums = new Map<number, { total: number; count: number }>();
    for (const d of divs) {
      const k = keyOf(d.paymentDate ?? d.exDate);
      const e = sums.get(k) ?? { total: 0, count: 0 };
      e.total += d.amountPerShare;
      e.count++;
      sums.set(k, e);
    }

    const now = new Date();
    const nowKey = grain === 'year' ? now.getFullYear() : now.getFullYear() * 4 + Math.floor(now.getMonth() / 3);
    const first = Math.min(...sums.keys());
    const out: Period[] = [];
    for (let k = first; k <= Math.max(nowKey, ...sums.keys()); k++) {
      const e = sums.get(k) ?? { total: 0, count: 0 };
      const year = grain === 'year' ? k : Math.floor(k / 4);
      const q = (k % 4) + 1;
      out.push({
        key: k, total: e.total, count: e.count, partial: k === nowKey,
        label: grain === 'year' ? `${year}` : `${year} Q${q}`,
        axis: grain === 'year' ? `${year}` : `Q${q} ’${String(year).slice(2)}`,
      });
    }
    return out;
  });

  protected readonly tableRows = computed(() => [...this.periods()].filter(p => p.count > 0).reverse());

  protected readonly view = computed(() => {
    const W = this.W();
    const data = this.periods().slice(-WINDOW[this.grain()]);
    if (!data.some(d => d.total > 0)) return null;

    const ticks = niceTicks(0, Math.max(...data.map(d => d.total)) * 1.08, 4);
    const yMax = ticks[ticks.length - 1];
    const base = H - PAD.b;
    const y = (v: number) => PAD.t + (1 - v / yMax) * (base - PAD.t);

    const slot = (W - PAD.l - PAD.r) / data.length;
    const bw = Math.min(MAX_BAR, slot - 2); // 2px surface gap between neighbours
    const r = Math.min(4, bw / 2);

    const bars = data.map((d, i) => {
      const slotX = PAD.l + i * slot;
      const cx = slotX + slot / 2;
      const x0 = cx - bw / 2, x1 = cx + bw / 2;
      const top = Math.min(y(d.total), base - 1);
      // Rounded data end (top), square at the baseline.
      const path = `M${x0},${base}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x1 - r}Q${x1},${top} ${x1},${top + r}V${base}Z`;
      return { ...d, slotX, cx, top, path, valueLabel: amount(d.total) };
    });

    return { bars, slot, yTicks: ticks.map(v => ({ value: v, y: y(v), label: compact(v) })) };
  });

  protected readonly hovered = computed(() => {
    const i = this.hover(), v = this.view();
    return v && i !== null && v.bars[i]?.total > 0 ? { i, bar: v.bars[i] } : null;
  });

  protected setGrain(g: Grain) { this.hover.set(null); this.grain.set(g); }

  protected tipLeft(px: number) {
    const W = this.W();
    const pct = (px / W) * 100;
    return pct > 60 ? `calc(${pct}% - 170px)` : `calc(${pct}% + 14px)`;
  }
}
