import { Component, input, model } from '@angular/core';

export interface TabItem { id: string; label: string }

/** Segmented control that stays pinned below the header, so long pages are navigated by topic instead of by scrolling. */
@Component({
  selector: 'app-tabs',
  styles: `
    :host { position: sticky; top: 65px; z-index: 5; display: block; margin: 0 -2.5rem 2rem; padding: .75rem 2.5rem;
      background: color-mix(in srgb, var(--bg) 82%, transparent); backdrop-filter: blur(14px); border-bottom: 1px solid var(--line-soft); }
    .tabs { display: flex; gap: .25rem; overflow-x: auto; scrollbar-width: none; }
    .tabs::-webkit-scrollbar { display: none; }
    button {
      flex: none; background: transparent; color: var(--muted); border: 1px solid transparent; border-radius: 999px;
      padding: .45rem 1.1rem; font-weight: 500; font-size: .85rem; letter-spacing: .02em;
    }
    button:hover { color: var(--text); filter: none; }
    button.on { color: var(--gold-bright); border-color: rgb(var(--gold-rgb) / .35); background: rgb(var(--gold-rgb) / .1); }
    @media (max-width: 720px) { :host { margin: 0 -1rem 1.5rem; padding: .6rem 1rem; } }
  `,
  template: `
    <div class="tabs" role="tablist">
      @for (t of tabs(); track t.id) {
        <button type="button" role="tab" [class.on]="t.id === active()" [attr.aria-selected]="t.id === active()" (click)="active.set(t.id)">{{ t.label }}</button>
      }
    </div>
  `,
})
export class Tabs {
  readonly tabs = input.required<TabItem[]>();
  readonly active = model.required<string>();
}
