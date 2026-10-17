import { Component, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MoneyPipe } from './money.pipe';
import { Slice } from '../core/api';

/** Horizontal share-of-total bars: label, bar scaled to 0-100% of the portfolio, and the exact weight. */
@Component({
  selector: 'app-breakdown-bars',
  imports: [MoneyPipe, DecimalPipe],
  styles: `
    :host { display: block; }
    h4 { margin: 0 0 1rem; }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: .8rem; }
    li { display: grid; grid-template-columns: minmax(6rem, 11rem) 1fr 4.5rem; gap: .9rem; align-items: center; }
    .label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: .85rem; }
    .track { height: 10px; border-radius: 5px; background: var(--line-soft); overflow: hidden; }
    .fill { display: block; height: 100%; border-radius: 5px; background: var(--gold); min-width: 2px; }
    .fill.none { background: var(--muted); opacity: .6; }
    .pct { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; font-size: .85rem; }
  `,
  template: `
    <h4>{{ title() }}</h4>
    <ul>
      @for (s of slices(); track s.label) {
        <li [title]="s.label + ': ' + (s.weightPercent | number: '1.1-1') + '% · ' + (s.value | money: currency() : 'symbol' : '1.0-0')">
          <span class="label">{{ s.label }}</span>
          <span class="track"><span class="fill" [class.none]="s.label === 'Unclassified'" [style.width.%]="s.weightPercent"></span></span>
          <span class="pct">{{ s.weightPercent | number: '1.1-1' }}%</span>
        </li>
      } @empty {
        <li class="label">No data</li>
      }
    </ul>
  `,
})
export class BreakdownBars {
  readonly title = input.required<string>();
  readonly slices = input.required<Slice[]>();
  readonly currency = input('USD');
}
