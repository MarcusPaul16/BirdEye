import { Component, computed, input } from '@angular/core';
import { compact, niceTicks } from '../companies/charts/chart-utils';
import { observeWidth } from '../shared/chart-width';
import { ModelResult } from './valuation-types';

const PAD = { l: 178, r: 64, t: 36, b: 30 };
const ROW = 38;
const NARROW_BELOW = 560;

/** Range bar per valuation model (low to high, dot at the fair value) against the current price. */
@Component({
  selector: 'app-football-field',
  styles: `
    :host { display: block; }
    svg { width: 100%; height: auto; display: block; }
    .grid { stroke: var(--line-soft); stroke-width: 1; }
    .axis-label { fill: var(--muted); font-size: 11px; font-family: var(--sans); }
    .row-label { fill: var(--text); font-size: 12px; font-family: var(--sans); }
    .dim { opacity: .45; }
    .range { fill: var(--gold); opacity: .3; }
    .dot { fill: var(--gold-bright); stroke: var(--surface); stroke-width: 2; }
    .ref-dot { fill: var(--surface); stroke: var(--muted); stroke-width: 2; }
    .val { fill: var(--text); font-size: 11px; font-weight: 600; font-family: var(--sans); paint-order: stroke; stroke: var(--surface); stroke-width: 4px; stroke-linejoin: round; }
    .sub-label { fill: var(--muted); font-size: 10px; font-family: var(--sans); letter-spacing: .04em; }
    .price-line { stroke: var(--text); stroke-width: 1.5; }
    .price-label { fill: var(--text); font-size: 11px; font-weight: 600; font-family: var(--sans); }
    .legend { display: flex; gap: 1.25rem; flex-wrap: wrap; margin: 0 0 .75rem; color: var(--muted); font-size: .75rem; }
    .legend i { display: inline-block; vertical-align: middle; margin-right: .4rem; }
    .legend .bar { width: 16px; height: 8px; border-radius: 4px; background: var(--gold); opacity: .4; }
    .legend .pt { width: 9px; height: 9px; border-radius: 50%; background: var(--gold-bright); }
    .legend .ln { width: 2px; height: 12px; background: var(--text); }
  `,
  template: `
    <div class="legend">
      <span><i class="bar"></i>Range of the model</span>
      <span><i class="pt"></i>Fair value</span>
      <span><i class="ln"></i>Current price</span>
    </div>
    @if (view(); as v) {
      <svg [attr.viewBox]="'0 0 ' + W() + ' ' + v.height" role="img" aria-label="Fair value by model compared with the current price">
        @for (t of v.ticks; track t.value) {
          <line class="grid" [attr.x1]="t.x" [attr.x2]="t.x" [attr.y1]="pad.t" [attr.y2]="v.height - pad.b" />
          <text class="axis-label" [attr.x]="t.x" [attr.y]="v.height - 10" text-anchor="middle">{{ t.label }}</text>
        }
        @for (r of v.rows; track r.id) {
          <g [class.dim]="!r.reliable">
            @if (v.narrow) {
              <text class="row-label" [attr.x]="v.padL" [attr.y]="r.y - 15">{{ r.name }}{{ r.reliable ? '' : ' · excluded from blend' }}</text>
            } @else {
              <text class="row-label" [attr.x]="v.padL - 14" [attr.y]="r.reliable ? r.y + 4 : r.y" text-anchor="end">{{ r.name }}</text>
              @if (!r.reliable) { <text class="sub-label" [attr.x]="v.padL - 14" [attr.y]="r.y + 13" text-anchor="end">excluded from blend</text> }
            }
            @if (r.x1 !== null && r.x2 !== null) {
              <rect class="range" [attr.x]="r.x1" [attr.y]="r.y - 5" [attr.width]="r.x2 - r.x1" height="10" rx="5" />
            }
            <circle class="dot" [attr.cx]="r.x" [attr.cy]="r.y" r="5.5" />
            <text class="val" [attr.x]="r.labelX" [attr.y]="r.y + 4" [attr.text-anchor]="r.labelLeft ? 'end' : 'start'">{{ r.label }}</text>
            <title>{{ r.name }}: {{ r.title }}</title>
          </g>
        }
        @if (v.target) {
          <g>
            @if (v.narrow) {
              <text class="row-label dim" [attr.x]="v.padL" [attr.y]="v.target.y - 15">Analyst target (reference)</text>
            } @else {
              <text class="row-label dim" [attr.x]="v.padL - 14" [attr.y]="v.target.y + 4" text-anchor="end">Analyst target (reference)</text>
            }
            <circle class="ref-dot" [attr.cx]="v.target.x" [attr.cy]="v.target.y" r="5.5" />
            <text class="val" [attr.x]="v.target.x + 12" [attr.y]="v.target.y + 4">{{ v.target.label }}</text>
          </g>
        }
        <line class="price-line" [attr.x1]="v.priceX" [attr.x2]="v.priceX" [attr.y1]="pad.t - 10" [attr.y2]="v.height - pad.b" />
        <text class="price-label" [attr.x]="v.priceX" [attr.y]="pad.t - 16" text-anchor="middle">Price {{ v.priceLabel }}</text>
      </svg>
    } @else {
      <p class="empty">No model could be computed for this company.</p>
    }
  `,
})
export class FootballField {
  readonly models = input.required<ModelResult[]>();
  readonly price = input.required<number>();
  readonly analystTarget = input<number | null>(null);

  protected readonly W = observeWidth();
  protected readonly pad = PAD;

  protected readonly view = computed(() => {
    const W = this.W();
    const models = this.models().filter(m => m.applicable && m.fairValue !== null);
    if (!models.length) return null;

    // On a phone there is no room for names beside the bars, so each name sits above its bar and the bars get the full width.
    const narrow = W < NARROW_BELOW;
    const padL = narrow ? 14 : PAD.l;
    const rowH = narrow ? 54 : ROW;

    const price = this.price(), target = this.analystTarget();
    const values = [price, ...(target ? [target] : [])];
    for (const m of models) values.push(m.fairValue!, m.low ?? m.fairValue!, m.high ?? m.fairValue!);

    const ticks = niceTicks(Math.max(0, Math.min(...values) * 0.9), Math.max(...values) * 1.05, narrow ? 4 : 5);
    const d0 = ticks[0], d1 = ticks[ticks.length - 1];
    const x = (v: number) => padL + ((v - d0) / (d1 - d0)) * (W - padL - PAD.r);
    const fmt = (v: number) => (v >= 100 ? v.toFixed(0) : v.toFixed(2));

    const priceX = x(price);
    const rows = models.map((m, i) => {
      const x1 = m.low !== null && m.high !== null ? x(m.low) : null;
      const x2 = m.low !== null && m.high !== null ? x(m.high) : null;
      const right = (x2 ?? x(m.fairValue!)) + 12;
      // A label to the right of the bar would sit on the price line: put it on the left of the bar instead.
      const labelLeft = right - 4 < priceX && priceX < right + 32;
      return {
        id: m.id, name: m.name, reliable: m.reliable, y: PAD.t + i * rowH + rowH / 2 + (narrow ? 8 : 0),
        x: x(m.fairValue!), x1, x2, label: fmt(m.fairValue!), labelLeft,
        labelX: labelLeft ? (x1 ?? x(m.fairValue!)) - 12 : right,
        title: m.low !== null && m.high !== null ? `${fmt(m.fairValue!)} (range ${fmt(m.low)} to ${fmt(m.high)})` : fmt(m.fairValue!),
      };
    });
    const targetRow = target ? { y: PAD.t + rows.length * rowH + rowH / 2 + (narrow ? 8 : 0), x: x(target), label: fmt(target) } : null;
    const height = PAD.t + (rows.length + (targetRow ? 1 : 0)) * rowH + PAD.b + (narrow ? 8 : 0);

    return {
      rows, target: targetRow, height, priceX, priceLabel: fmt(price), narrow, padL,
      ticks: ticks.map(v => ({ value: v, x: x(v), label: compact(v) })),
    };
  });
}
