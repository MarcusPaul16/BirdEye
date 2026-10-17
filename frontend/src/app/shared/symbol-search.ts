import { Component, DestroyRef, inject, model, output, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Subject, catchError, debounceTime, distinctUntilChanged, filter, of, switchMap } from 'rxjs';
import { API_URL } from '../core/api';

export interface SymbolMatch { symbol: string; name: string; exchange?: string; type?: string }

/** Text input that suggests tickers by company name (or partial symbol) while you type. */
@Component({
  selector: 'app-symbol-search',
  imports: [FormsModule],
  styles: `
    :host { position: relative; display: inline-block; min-width: 260px; }
    input { width: 100%; }
    ul {
      position: absolute; left: 0; right: 0; top: calc(100% + 6px); z-index: 20; margin: 0; padding: .35rem; list-style: none;
      min-width: 360px; max-height: 320px; overflow-y: auto;
      background: var(--surface-2); border: 1px solid var(--line); border-radius: 12px;
      box-shadow: var(--shadow-pop);
    }
    li {
      display: grid; grid-template-columns: 6.5rem 1fr auto; gap: .75rem; align-items: center;
      padding: .55rem .65rem; border-radius: 8px; cursor: pointer; text-transform: none; letter-spacing: normal;
    }
    li.active, li:hover { background: rgb(var(--gold-rgb) / .12); }
    .sym { font-weight: 600; letter-spacing: .06em; color: var(--gold-bright); }
    .name { color: var(--text); font-size: .85rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ex { color: var(--muted); font-size: .7rem; letter-spacing: .06em; text-transform: uppercase; }
    .none { padding: .7rem; color: var(--muted); font-size: .85rem; text-transform: none; letter-spacing: normal; }
  `,
  template: `
    <input
      role="combobox" aria-autocomplete="list" autocomplete="off" spellcheck="false"
      [attr.aria-expanded]="open()" [placeholder]="placeholder()"
      [ngModel]="value()" [ngModelOptions]="{ standalone: true }"
      (ngModelChange)="type($event)" (keydown)="key($event)" (blur)="blur()" (focus)="reopen()" />
    @if (open()) {
      <ul role="listbox">
        @for (m of items(); track m.symbol; let i = $index) {
          <li role="option" [class.active]="i === active()" [attr.aria-selected]="i === active()"
              (mousedown)="$event.preventDefault(); choose(m)" (mouseenter)="active.set(i)">
            <span class="sym">{{ m.symbol }}</span>
            <span class="name">{{ m.name }}</span>
            <span class="ex">{{ m.type === 'ETF' ? 'ETF · ' : '' }}{{ m.exchange }}</span>
          </li>
        } @empty {
          <li class="none">No matches</li>
        }
      </ul>
    }
  `,
})
export class SymbolSearch {
  readonly value = model('');
  readonly placeholder = model('Ticker or company name');
  /** Fired when a suggestion is chosen. */
  readonly picked = output<string>();
  /** Fired when the field loses focus with a non-empty value (typed ticker without picking a suggestion). */
  readonly committed = output<string>();

  private readonly http = inject(HttpClient);
  private readonly query$ = new Subject<string>();

  protected readonly items = signal<SymbolMatch[]>([]);
  protected readonly open = signal(false);
  protected readonly active = signal(-1);

  constructor() {
    this.query$.pipe(
      debounceTime(250),
      distinctUntilChanged(),
      filter(q => {
        const ok = q.trim().length >= 2;
        if (!ok) { this.items.set([]); this.open.set(false); }
        return ok;
      }),
      // switchMap drops the in-flight request when a newer keystroke arrives, so stale results never overwrite fresh ones.
      switchMap(q => this.http.get<SymbolMatch[]>(`${API_URL}/company-search`, { params: { q: q.trim() } }).pipe(catchError(() => of([])))),
      takeUntilDestroyed(inject(DestroyRef)),
    ).subscribe(items => { this.items.set(items); this.active.set(-1); this.open.set(true); });
  }

  protected type(text: string) {
    this.value.set(text);
    this.query$.next(text);
  }

  protected blur() {
    this.open.set(false);
    if (this.value().trim()) this.committed.emit(this.value().trim());
  }

  protected reopen() {
    if (this.items().length && this.value().trim().length >= 2) this.open.set(true);
  }

  protected choose(m: SymbolMatch) {
    this.value.set(m.symbol);
    this.open.set(false);
    this.items.set([]);
    this.picked.emit(m.symbol);
  }

  protected key(e: KeyboardEvent) {
    const n = this.items().length;
    if (e.key === 'ArrowDown' && n) {
      e.preventDefault();
      this.open.set(true);
      this.active.set((this.active() + 1) % n);
    } else if (e.key === 'ArrowUp' && n) {
      e.preventDefault();
      this.active.set((this.active() - 1 + n) % n);
    } else if (e.key === 'Enter' && this.open() && this.active() >= 0) {
      e.preventDefault(); // choose the highlighted suggestion instead of submitting the form
      this.choose(this.items()[this.active()]);
    } else if (e.key === 'Escape') {
      this.open.set(false);
    }
  }
}
