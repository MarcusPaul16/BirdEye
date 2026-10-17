import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { DecimalPipe, PercentPipe } from '@angular/common';
import { Api, DividendCalendar, DividendCalendarEvent, DividendEventKind, errorMessage } from '../core/api';
import { MoneyPipe } from '../shared/money.pipe';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const KIND_LABEL: Record<DividendEventKind, string> = { Paid: 'Paid', Pending: 'Owed', Confirmed: 'Confirmed', Projected: 'Projected' };
const KIND_HINT: Record<DividendEventKind, string> = {
  Paid: 'Already paid (payment date is an estimate unless the source announced it)',
  Pending: 'The ex-date has passed, so the dividend is owed but not yet paid',
  Confirmed: 'Ex-date announced by the data source; the amount is an estimate',
  Projected: "Estimated from last year's payment, adjusted for the company's recent growth",
};

/** A dividend shows up twice on the calendar: on its ex-dividend date (the last chance to own the shares) and on its payment date. */
interface Marker { type: 'ex' | 'pay'; date: string; e: DividendCalendarEvent }

const ym = (date: string) => date.slice(0, 7);
const utc = (date: string) => { const [y, m, d] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };

@Component({
  selector: 'app-calendar-page',
  imports: [MoneyPipe, DecimalPipe, PercentPipe],
  styles: `
    .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; margin-bottom: 1.25rem; }
    .toolbar h3 { margin: 0; min-width: 11ch; }
    .nav { display: flex; gap: .5rem; align-items: center; }
    .nav button { padding: .35rem .8rem; }
    .totals { color: var(--muted); font-size: .85rem; }
    .totals strong { color: var(--text); font-variant-numeric: tabular-nums; }

    .legend { display: flex; flex-wrap: wrap; gap: 1.25rem; margin: 0 0 1rem; color: var(--muted); font-size: .75rem; }
    .legend span { display: inline-flex; align-items: center; gap: .45rem; }
    .swatch { width: 14px; height: 10px; border-radius: 3px; display: inline-block; }
    .k-Paid { background: var(--accent); }
    .k-Pending, .k-Confirmed { background: rgb(var(--accent-rgb) / .5); }
    .k-Projected { background: repeating-linear-gradient(45deg, rgb(var(--accent-rgb) / .4) 0 3px, transparent 3px 6px); box-shadow: 0 0 0 1px rgb(var(--accent-rgb) / .6) inset; }

    .months { display: flex; align-items: flex-end; gap: 4px; height: 150px; padding-bottom: 0; }
    .m { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: stretch; height: 100%; cursor: pointer; background: transparent;
      border: 0; padding: 0; border-radius: 8px; color: var(--muted); font-weight: 400; }
    .m:hover { background: rgb(var(--accent-rgb) / .06); filter: none; }
    .m .stack { flex: 1; display: flex; flex-direction: column-reverse; justify-content: flex-start; gap: 2px; padding: 0 2px; }
    .m .seg { display: block; border-radius: 3px 3px 0 0; min-height: 2px; }
    .m .lab { font-size: .65rem; text-align: center; padding: .35rem 0 .2rem; }
    .m.on { color: var(--accent-strong); background: rgb(var(--accent-rgb) / .1); box-shadow: 0 0 0 1px rgb(var(--accent-rgb) / .4) inset; }
    .m.now .lab { font-weight: 700; color: var(--text); }
    .m.on.now .lab { color: var(--accent-strong); }
    .year { font-size: .6rem; opacity: .7; display: block; }
    .l1 { display: none; }

    .grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; }
    .dow { text-align: center; color: var(--muted); font-size: .68rem; padding: .35rem 0; }
    .day {
      min-height: 84px; padding: .5rem; border-radius: 14px; border: 0; background: transparent; text-align: left;
      display: flex; flex-direction: column; gap: 3px; cursor: default; color: var(--text); font-weight: 400;
    }
    .day:disabled { opacity: 1; }
    .day.empty { background: transparent; }
    .day.has { cursor: pointer; background: var(--surface-2); }
    .day.has:hover { filter: brightness(1.15); }
    .day.sel { box-shadow: 0 0 0 2px var(--accent) inset; }
    .day .n { font-size: .75rem; color: var(--muted); font-variant-numeric: tabular-nums; }
    .day.today .n { color: var(--on-accent); background: var(--accent); border-radius: 999px; padding: 0 .4rem; align-self: flex-start; font-weight: 700; }
    .chip { font-size: .68rem; font-weight: 600; padding: .1rem .4rem; border-radius: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .chip.k-Paid { color: var(--on-accent); }
    .chip.k-Pending, .chip.k-Confirmed { color: var(--text); border: 1px solid var(--accent); }
    .chip.k-Projected { color: var(--text); border: 1px dashed var(--accent); }
    .chip.ex { color: var(--muted); border: 1px solid var(--muted); font-weight: 500; background: transparent; }
    .more { font-size: .65rem; color: var(--muted); }
    .keys { display: flex; flex-wrap: wrap; gap: 1.25rem; margin: 0 0 1rem; color: var(--muted); font-size: .75rem; }
    .keys span { display: inline-flex; align-items: center; gap: .45rem; }
    .keys .chip { font-size: .62rem; }

    .gridwrap { position: relative; }
    .pop {
      position: absolute; z-index: 30; width: 300px; left: var(--x); top: var(--y);
      background: var(--surface-2); border: 1px solid var(--accent-soft); border-radius: 12px; padding: .9rem 1rem 1rem;
      box-shadow: var(--shadow-pop);
    }
    .pop::before {
      content: ''; position: absolute; top: 18px; width: 10px; height: 10px; background: var(--surface-2);
      border-left: 1px solid var(--accent-soft); border-bottom: 1px solid var(--accent-soft);
    }
    .pop.right::before { left: -6px; transform: rotate(45deg); }
    .pop.left::before { right: -6px; transform: rotate(-135deg); }
    .pop header { display: flex; align-items: flex-start; justify-content: space-between; gap: .5rem; margin-bottom: .6rem; }
    .pop h4 { margin: 0; font-size: 1.15rem; line-height: 1.2; }
    .pop .close { padding: .1rem .45rem; font-size: .8rem; }
    .pop ul { list-style: none; margin: 0; padding: 0; }
    .pop li { padding: .65rem 0; border-top: 1px solid var(--line-soft); display: grid; grid-template-columns: 1fr auto; gap: .15rem .75rem; align-items: center; }
    .pop .sym { font-weight: 600; color: var(--accent-strong); }
    .pop .sub { color: var(--muted); font-size: .75rem; font-variant-numeric: tabular-nums; grid-column: 1; }
    .pop .amt { font-weight: 600; font-variant-numeric: tabular-nums; grid-column: 2; grid-row: 1; text-align: right; }
    .pop .state { grid-column: 2; grid-row: 2; justify-self: end; }
    .pop .sum { display: flex; justify-content: space-between; border-top: 1px solid var(--line); padding-top: .65rem; font-size: .85rem; color: var(--muted); }
    .pop .sum strong { color: var(--text); font-variant-numeric: tabular-nums; }
    .agenda li.sel { background: rgb(var(--accent-rgb) / .08); border-radius: 8px; }
    .agenda { list-style: none; margin: 0; padding: 0; }
    .agenda li { display: grid; grid-template-columns: 7.5rem 5.5rem 6.5rem 1fr auto; gap: .75rem; align-items: center; padding: .85rem .25rem; border-bottom: 1px solid var(--line-soft); }
    .agenda li:last-child { border-bottom: 0; }
    .agenda .when { font-variant-numeric: tabular-nums; }
    .agenda .when small { display: block; color: var(--muted); font-size: .68rem; letter-spacing: normal; text-transform: none; }
    .agenda .sym { font-weight: 600; color: var(--accent-strong); }
    .agenda .detail { color: var(--muted); font-size: .8rem; font-variant-numeric: tabular-nums; }
    .agenda .net { font-weight: 600; font-variant-numeric: tabular-nums; text-align: right; }
    .state { font-size: .65rem; padding: .15rem .55rem; border-radius: 999px; border: 1px solid var(--accent-soft); color: var(--accent); text-align: center; }
    .state.Projected { border-style: dashed; color: var(--muted); border-color: var(--line); }
    .state.Paid { background: rgb(var(--accent-rgb) / .12); }
    .state.ex { border-style: solid; color: var(--text); border-color: var(--muted); }
    .pop h5 { margin: .85rem 0 .1rem; font-family: var(--sans); font-weight: 500; font-size: .66rem; color: var(--muted); }
    .pop .hint { color: var(--muted); font-size: .75rem; line-height: 1.4; grid-column: 1 / -1; }
    .agenda .muted { color: var(--muted); font-size: .8rem; text-align: right; }
    .note { margin-top: 1rem; }

    @media (max-width: 720px) {
      .day { min-height: 52px; padding: .3rem; }
      .chip { font-size: 0; padding: 0; width: 8px; height: 8px; border-radius: 50%; }
      .chip.ex { border-radius: 2px; transform: rotate(45deg); border: 1.5px solid var(--text); width: 7px; height: 7px; }
      .keys .chip { font-size: 0; }
      .chips { flex-direction: row !important; flex-wrap: wrap; }
      .more { display: none; }
      .agenda li { grid-template-columns: 1fr auto; row-gap: .15rem; }
      .agenda .state, .agenda .detail { grid-column: 1; }
      .agenda .net { grid-row: 1; grid-column: 2; }
      .months { height: 110px; gap: 2px; }
      .m .lab { font-size: .6rem; }
      .l3 { display: none; }
      .l1 { display: inline; }
      .year { display: none; }
      .agenda .state { justify-self: start; }
      /* On a phone the popup becomes a panel at the bottom of the screen, where a thumb reaches it. */
      .pop { position: fixed; left: 1rem; right: 1rem; top: auto; bottom: calc(5rem + env(safe-area-inset-bottom)); width: auto; max-height: 55vh; overflow-y: auto; }
      .pop::before { display: none; }
    }
  `,
  template: `
    <div class="page-head">
      <span class="eyebrow">Income calendar</span>
      <h2>Dividend calendar</h2>
      <p>When the dividends of the stocks you hold are paid, what is already in, and what to expect. Amounts are net of {{ (data()?.taxRate ?? 0.16) | percent }} tax, in RON.</p>
    </div>

    @if (error()) { <p class="error">{{ error() }}</p> }
    @if (!data() && !error()) { <div class="skeleton"></div><div class="skeleton tall"></div> }

    @if (data(); as d) {
      @if (d.unavailable.length) { <p class="warn">No dividend data for {{ d.unavailable.join(', ') }}, so they are missing below.</p> }

      <p class="insight">
        @if (d.next; as n) {
          Next dividend: <strong>{{ n.symbol }}</strong> pays about <strong>{{ n.netRon | money: d.currency : 'symbol' : '1.0-0' }}</strong>
          on <strong>{{ shortDate(n.paymentDate) }}</strong>{{ n.kind === 'Confirmed' ? ' (confirmed)' : n.kind === 'Pending' ? ' (owed)' : ' (projected)' }}.
          Over the next 12 months expect about <strong>{{ d.next12MonthsNetRon | money: d.currency : 'symbol' : '1.0-0' }}</strong>,
          around <strong>{{ d.next12MonthsNetRon / 12 | money: d.currency : 'symbol' : '1.0-0' }}</strong> a month@if (best(); as b) {; the biggest month is <strong>{{ b.label }}</strong> with {{ b.total | money: d.currency : 'symbol' : '1.0-0' }}}.
          @if (nextEx(); as x) {
            The next ex-dividend date is <strong>{{ shortDate(x.date) }}</strong> for <strong>{{ x.e.symbol }}</strong>
            ({{ inDays(x.date) }}{{ x.e.kind === 'Projected' ? ', estimated' : '' }}): own the shares before it to get that dividend.
          }
        } @else {
          No dividends to show yet. Add stock transactions in Portfolio and they appear here.
        }
      </p>

      <div class="card">
        <div class="toolbar">
          <h3>Month by month</h3>
          <div class="legend" style="margin: 0">
            @for (k of kinds; track k) { <span [title]="hint(k)"><i class="swatch k-{{ k }}"></i>{{ label(k) }}</span> }
          </div>
        </div>
        <div class="months" role="group" aria-label="Net dividends per month">
          @for (m of months(); track m.key) {
            <button type="button" class="m" [class.on]="m.key === month()" [class.now]="m.key === thisMonth()" (click)="select(m.key)"
                    [title]="m.label + ': ' + (m.total | money: d.currency : 'symbol' : '1.0-0')">
              <span class="stack">
                @for (s of m.segments; track s.kind) {
                  <i class="seg k-{{ s.kind }}" [style.height.%]="s.height"></i>
                }
              </span>
              <span class="lab"><span class="l3">{{ m.short }}</span><span class="l1">{{ m.short[0] }}</span>@if (m.month === 0) { <span class="year">{{ m.year }}</span> }</span>
            </button>
          }
        </div>
      </div>

      <div class="card">
        <div class="toolbar">
          <div class="nav">
            <button type="button" class="ghost" (click)="step(-1)" [disabled]="!canStep(-1)" aria-label="Previous month">‹</button>
            <h3>{{ monthTitle() }}</h3>
            <button type="button" class="ghost" (click)="step(1)" [disabled]="!canStep(1)" aria-label="Next month">›</button>
            @if (month() !== thisMonth()) { <button type="button" class="ghost" (click)="select(thisMonth())">Today</button> }
          </div>
          <div class="totals">
            @if (monthTotals(); as t) {
              <strong>{{ t.total | money: d.currency : 'symbol' : '1.0-0' }}</strong> this month
              @if (t.received > 0) { · {{ t.received | money: d.currency : 'symbol' : '1.0-0' }} paid }
              @if (t.expected > 0) { · {{ t.expected | money: d.currency : 'symbol' : '1.0-0' }} expected }
            }
          </div>
        </div>

        <div class="keys" aria-label="Legend">
          <span><i class="chip k-Paid">ABC</i>Payment date</span>
          <span><i class="chip ex">ex ABC</i>Ex-dividend date: own the shares before it</span>
        </div>

        <div class="gridwrap" #wrap>
        <div class="grid" role="grid" [attr.aria-label]="monthTitle()">
          @for (w of weekdays; track w) { <div class="dow">{{ w }}</div> }
          @for (c of cells(); track $index) {
            @if (c.date === null) {
              <div class="day empty"></div>
            } @else {
              <button type="button" class="day" [class.has]="c.marks.length" [class.today]="c.date === d.today" [class.sel]="c.date === day()"
                      [disabled]="!c.marks.length" (click)="toggleDay(c.date, $event, wrap)"
                      [attr.aria-expanded]="c.date === day()" [attr.aria-haspopup]="c.marks.length ? 'dialog' : null">
                <span class="n">{{ c.n }}</span>
                @if (c.marks.length) {
                  <span class="chips" style="display: flex; flex-direction: column; gap: 3px">
                    @for (m of c.marks.slice(0, 2); track m.type + m.e.symbol + m.e.exDate) {
                      <span class="chip" [class]="m.type === 'ex' ? 'ex' : 'k-' + m.e.kind">{{ m.type === 'ex' ? 'ex ' : '' }}{{ m.e.symbol }}</span>
                    }
                    @if (c.marks.length > 2) { <span class="more">+{{ c.marks.length - 2 }} more</span> }
                  </span>
                }
              </button>
            }
          }
        </div>

        @if (day() && popover(); as p) {
          <div class="pop" [class.right]="p.side === 'right'" [class.left]="p.side === 'left'" role="dialog" [attr.aria-label]="'Dividends on ' + longDate(day()!)"
               [style.--x.px]="p.x" [style.--y.px]="p.y">
            <header>
              <h4>{{ longDate(day()!) }}</h4>
              <button type="button" class="ghost close" (click)="day.set(null)" aria-label="Close">✕</button>
            </header>
            @if (dayEx().length) {
              <h5>Ex-dividend date{{ dayEx().length > 1 ? 's' : '' }}</h5>
              <ul>
                @for (m of dayEx(); track m.e.symbol + m.e.exDate) {
                  <li>
                    <span class="sym">{{ m.e.symbol }}</span>
                    <span class="amt">{{ m.e.amountPerShare | money: m.e.currency : 'symbol' : '1.2-4' }}<small> / sh</small></span>
                    <span class="sub">{{ m.e.shares | number: '1.0-4' }} sh {{ isPast(m.date) ? 'held' : 'to hold' }} · pays {{ shortDate(m.e.paymentDate) }}{{ m.e.paymentDateIsEstimate ? ' (est.)' : '' }}</span>
                    <span class="state ex">{{ m.e.kind === 'Projected' ? 'Ex-date (est.)' : 'Ex-date' }}</span>
                    <span class="hint">{{ isPast(m.date) ? 'The ex-date has passed: you were entitled to this dividend.' : 'Own the shares before this day to receive this dividend; buying on the day itself is too late.' }}</span>
                  </li>
                }
              </ul>
            }
            @if (dayPay().length) {
              <h5>Payment{{ dayPay().length > 1 ? 's' : '' }}</h5>
              <ul>
                @for (m of dayPay(); track m.e.symbol + m.e.exDate) {
                  <li>
                    <span class="sym">{{ m.e.symbol }}</span>
                    <span class="amt">{{ m.e.netRon | money: d.currency : 'symbol' : '1.2-2' }}</span>
                    <span class="sub">{{ m.e.shares | number: '1.0-4' }} sh × {{ m.e.amountPerShare | money: m.e.currency : 'symbol' : '1.2-4' }}<br>ex-date {{ shortDate(m.e.exDate) }}{{ m.e.paymentDateIsEstimate ? ' · payment date estimated' : '' }}</span>
                    <span class="state {{ m.e.kind }}" [title]="hint(m.e.kind)">{{ label(m.e.kind) }}</span>
                  </li>
                }
              </ul>
            }
            @if (dayPay().length > 1) {
              <div class="sum"><span>Total, net</span><strong>{{ dayTotal() | money: d.currency : 'symbol' : '1.2-2' }}</strong></div>
            }
          </div>
        }
        </div>
      </div>

      <div class="card">
        <div class="toolbar">
          <h3>{{ monthTitle() }}</h3>
        </div>
        <ul class="agenda">
          @for (m of agenda(); track m.type + m.e.symbol + m.e.exDate) {
            <li [class.sel]="m.date === day()">
              @if (m.type === 'pay') {
                <span class="when">{{ shortDate(m.date) }}<small>{{ m.e.paymentDateIsEstimate ? 'estimated · ' : '' }}ex-date {{ shortDate(m.e.exDate) }}</small></span>
                <span class="sym">{{ m.e.symbol }}</span>
                <span class="state {{ m.e.kind }}" [title]="hint(m.e.kind)">{{ label(m.e.kind) }}</span>
                <span class="detail">{{ m.e.shares | number: '1.0-4' }} sh × {{ m.e.amountPerShare | money: m.e.currency : 'symbol' : '1.2-4' }}</span>
                <span class="net">{{ m.e.netRon | money: d.currency : 'symbol' : '1.2-2' }}</span>
              } @else {
                <span class="when">{{ shortDate(m.date) }}<small>{{ m.e.kind === 'Projected' ? 'estimated' : isPast(m.date) ? 'passed' : inDays(m.date) }}</small></span>
                <span class="sym">{{ m.e.symbol }}</span>
                <span class="state ex">Ex-date</span>
                <span class="detail">{{ isPast(m.date) ? 'You held' : 'Own before this day:' }} {{ m.e.shares | number: '1.0-4' }} sh × {{ m.e.amountPerShare | money: m.e.currency : 'symbol' : '1.2-4' }}</span>
                <span class="muted">pays {{ shortDate(m.e.paymentDate) }}</span>
              }
            </li>
          } @empty {
            <li style="display: block; color: var(--muted)">No dividends this month.</li>
          }
        </ul>
        <p class="note">
          To receive a dividend you must own the shares before its ex-dividend date. Paid and owed dividends use the shares you held on each ex-date. Announced ex-dates come from Yahoo Finance; payment dates are estimated
          (ex-date + 14 days) unless announced. Everything further out, ex-dates included, is projected from last year's payments with the company's recent growth, so
          treat it as a guide: companies can change or skip a dividend. Converted at today's BNR rates.
        </p>
      </div>
    }
  `,
})
export class CalendarPage {
  private readonly api = inject(Api);

  protected readonly weekdays = WEEKDAYS;
  protected readonly kinds: DividendEventKind[] = ['Paid', 'Pending', 'Confirmed', 'Projected'];
  protected readonly data = signal<DividendCalendar | null>(null);
  protected readonly error = signal('');
  protected readonly month = signal('');
  protected readonly day = signal<string | null>(null);
  /** Where the popup sits, relative to the calendar grid: next to the selected day, on whichever side has room. */
  protected readonly popover = signal<{ x: number; y: number; side: 'left' | 'right' | 'none' } | null>(null);


  constructor() {
    this.api.dividendCalendar().subscribe({
      next: d => {
        this.data.set(d);
        // Open on the current month, unless nothing happens in it: then on the month of the next dividend.
        const now = ym(d.today);
        const busy = d.events.some(e => ym(e.paymentDate) === now);
        this.month.set(!busy && d.next ? ym(d.next.paymentDate) : now);
      },
      error: e => this.error.set(errorMessage(e)),
    });
  }

  protected readonly thisMonth = computed(() => ym(this.data()?.today ?? ''));
  protected label(k: DividendEventKind) { return KIND_LABEL[k]; }
  protected hint(k: DividendEventKind) { return KIND_HINT[k]; }

  protected shortDate(date: string) {
    const d = utc(date);
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)}${d.getUTCFullYear() !== utc(this.data()?.today ?? date).getUTCFullYear() ? ' ' + d.getUTCFullYear() : ''}`;
  }

  private readonly byMonth = computed(() => {
    const map = new Map<string, DividendCalendarEvent[]>();
    for (const e of this.data()?.events ?? []) map.set(ym(e.paymentDate), [...(map.get(ym(e.paymentDate)) ?? []), e]);
    return map;
  });

  /** One entry per month of the window, with the net amount split by how certain it is (stacked in the bar). */
  protected readonly months = computed(() => {
    const d = this.data();
    if (!d) return [];
    const [fy, fm] = d.from.split('-').map(Number), [ty, tm] = d.to.split('-').map(Number);
    const list: { key: string; year: number; month: number; label: string; short: string; total: number; parts: Record<DividendEventKind, number> }[] = [];
    for (let y = fy, m = fm - 1; y < ty || (y === ty && m <= tm - 1); m++) {
      if (m > 11) { m = 0; y++; }
      const key = `${y}-${String(m + 1).padStart(2, '0')}`;
      const parts: Record<DividendEventKind, number> = { Paid: 0, Pending: 0, Confirmed: 0, Projected: 0 };
      for (const e of this.byMonth().get(key) ?? []) parts[e.kind] += e.netRon;
      list.push({ key, year: y, month: m, label: `${MONTHS[m]} ${y}`, short: MONTHS[m].slice(0, 3), total: parts.Paid + parts.Pending + parts.Confirmed + parts.Projected, parts });
    }
    const max = Math.max(1, ...list.map(x => x.total));
    return list.map(x => ({
      ...x,
      segments: this.kinds.filter(k => x.parts[k] > 0).map(k => ({ kind: k, height: (x.parts[k] / max) * 100 })),
    }));
  });

  protected readonly best = computed(() => {
    const today = this.thisMonth();
    const future = this.months().filter(m => m.key >= today && m.total > 0);
    return future.length ? future.reduce((a, b) => (b.total > a.total ? b : a)) : null;
  });

  protected select(key: string) { this.month.set(key); this.day.set(null); }

  protected canStep(delta: number) {
    const keys = this.months().map(m => m.key), i = keys.indexOf(this.month());
    return i >= 0 && i + delta >= 0 && i + delta < keys.length;
  }

  protected step(delta: number) {
    const keys = this.months().map(m => m.key), i = keys.indexOf(this.month());
    if (this.canStep(delta)) this.select(keys[i + delta]);
  }

  protected toggleDay(date: string, event: Event, wrap: HTMLElement) {
    if (this.day() === date) { this.day.set(null); return; }
    const cell = event.currentTarget as HTMLElement;
    const popWidth = 300, gap = 10;
    const room = wrap.clientWidth;
    // Rough height (header + one block per event) so a popup near the bottom still starts inside the grid.
    const height = 90 + 74 * (this.markersByDate().get(date)?.length ?? 1);
    let x = cell.offsetLeft + cell.offsetWidth + gap, side: 'left' | 'right' | 'none' = 'right';
    if (x + popWidth > room) {
      x = cell.offsetLeft - popWidth - gap;
      side = 'left';
      if (x < 0) { x = Math.max(0, Math.min(room - popWidth, cell.offsetLeft)); side = 'none'; }
    }
    const below = side === 'none';
    const y = below ? cell.offsetTop + cell.offsetHeight + gap : Math.max(0, Math.min(cell.offsetTop, wrap.clientHeight - height));
    this.popover.set({ x, y, side });
    this.day.set(date);
  }

  protected readonly dayMarks = computed(() => (this.day() ? this.markersByDate().get(this.day()!) ?? [] : []));
  protected readonly dayEx = computed(() => this.dayMarks().filter(m => m.type === 'ex'));
  protected readonly dayPay = computed(() => this.dayMarks().filter(m => m.type === 'pay'));
  protected readonly dayTotal = computed(() => this.dayPay().reduce((a, m) => a + m.e.netRon, 0));

  protected longDate(date: string) {
    const d = utc(date);
    return `${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  }

  @HostListener('document:keydown.escape') protected onEscape() { this.day.set(null); }

  /** A click anywhere outside the popup and the day cells closes it. */
  @HostListener('document:click', ['$event']) protected onDocumentClick(e: MouseEvent) {
    if (this.day() && !(e.target as HTMLElement).closest('.pop, .day')) this.day.set(null);
  }

  protected monthTitle() {
    const [y, m] = this.month().split('-').map(Number);
    return m ? `${MONTHS[m - 1]} ${y}` : '';
  }

  protected readonly monthEvents = computed(() => this.byMonth().get(this.month()) ?? []);

  /** Every event twice: on its ex-date and on its payment date. */
  private readonly markers = computed<Marker[]>(() =>
    (this.data()?.events ?? []).flatMap(e => [{ type: 'ex' as const, date: e.exDate, e }, { type: 'pay' as const, date: e.paymentDate, e }]));

  private readonly markersByDate = computed(() => {
    const map = new Map<string, Marker[]>();
    for (const m of this.markers()) map.set(m.date, [...(map.get(m.date) ?? []), m]);
    return map;
  });

  /** The selected month's markers in date order, the ex-date first when both fall on the same day. */
  protected readonly monthMarkers = computed(() =>
    this.markers().filter(m => ym(m.date) === this.month()).sort((a, b) => a.date.localeCompare(b.date) || (a.type === b.type ? 0 : a.type === 'ex' ? -1 : 1) || a.e.symbol.localeCompare(b.e.symbol)));

  /** The soonest upcoming ex-dividend date (today included), whatever its certainty. */
  protected readonly nextEx = computed(() => {
    const today = this.data()?.today ?? '';
    return this.markers().filter(m => m.type === 'ex' && m.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
  });

  protected isPast(date: string) { return date < (this.data()?.today ?? ''); }

  protected inDays(date: string) {
    const n = Math.round((utc(date).getTime() - utc(this.data()?.today ?? date).getTime()) / 864e5);
    return n === 0 ? 'today' : n === 1 ? 'tomorrow' : n === -1 ? 'yesterday' : n > 0 ? `in ${n} days` : `${-n} days ago`;
  }

  protected readonly monthTotals = computed(() => {
    const e = this.monthEvents();
    const received = e.filter(x => x.kind === 'Paid').reduce((a, x) => a + x.netRon, 0);
    const expected = e.filter(x => x.kind !== 'Paid').reduce((a, x) => a + x.netRon, 0);
    return { received, expected, total: received + expected };
  });

  protected readonly agenda = computed(() => this.monthMarkers());

  /** Weeks of the selected month, Monday first. Cells outside the month are empty. */
  protected readonly cells = computed(() => {
    const [y, m] = this.month().split('-').map(Number);
    if (!m) return [];
    const offset = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const total = Math.ceil((offset + days) / 7) * 7;
    return Array.from({ length: total }, (_, i) => {
      const n = i - offset + 1;
      if (n < 1 || n > days) return { date: null as string | null, n: 0, marks: [] as Marker[] };
      const date = `${y}-${String(m).padStart(2, '0')}-${String(n).padStart(2, '0')}`;
      // Payments first, then ex-dates, so the cell shows money arriving before the reminders.
      const marks = [...(this.markersByDate().get(date) ?? [])].sort((a, b) => (a.type === b.type ? a.e.symbol.localeCompare(b.e.symbol) : a.type === 'pay' ? -1 : 1));
      return { date, n, marks };
    });
  });
}
