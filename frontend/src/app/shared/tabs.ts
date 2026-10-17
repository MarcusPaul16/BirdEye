import { Component, input, model } from '@angular/core';

export interface TabItem { id: string; label: string }

/** Pill tabs pinned to the top while scrolling, so long pages are navigated by topic instead of by scrolling. */
@Component({
  selector: 'app-tabs',
  styles: `
    :host {
      position: sticky; top: 0; z-index: 5; display: block; margin: 0 calc(-1 * var(--page-pad, 3rem)) 1.5rem; padding: .75rem var(--page-pad, 3rem);
      background: color-mix(in srgb, var(--bg) 90%, transparent); backdrop-filter: blur(14px);
    }
    .tabs { display: flex; gap: .4rem; overflow-x: auto; scrollbar-width: none; }
    .tabs::-webkit-scrollbar { display: none; }
    button {
      flex: none; background: transparent; color: var(--muted); border-radius: 999px; padding: .55rem 1.15rem;
      font-weight: 600; font-size: .9rem;
    }
    button:hover:not(:disabled) { color: var(--text); background: var(--surface); filter: none; }
    button.on { color: var(--bg); background: var(--text); }
    @media (max-width: 900px) { :host { top: 56px; } }
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
