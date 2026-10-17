import { Injectable, effect, signal } from '@angular/core';

export type Theme = 'light' | 'dark';

const KEY = 'birdeye-theme';

/**
 * Light / dark theme. Follows the device setting until the user picks one with the toggle; that choice is then remembered.
 * The first paint is handled by a small script in index.html, so the page never flashes the wrong theme.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly media = matchMedia('(prefers-color-scheme: light)');
  readonly theme = signal<Theme>(this.stored() ?? (this.media.matches ? 'light' : 'dark'));

  constructor() {
    effect(() => { document.documentElement.dataset['theme'] = this.theme(); });
    // Without an explicit choice, keep following the device (for example when it switches to dark at night).
    this.media.addEventListener('change', e => { if (!this.stored()) this.theme.set(e.matches ? 'light' : 'dark'); });
  }

  toggle() {
    const next: Theme = this.theme() === 'dark' ? 'light' : 'dark';
    this.theme.set(next);
    document.documentElement.dataset['theme'] = next; // apply now rather than waiting for the effect to flush
    try { localStorage.setItem(KEY, next); } catch { /* private mode: the choice just will not persist */ }
  }

  private stored(): Theme | null {
    try {
      const v = localStorage.getItem(KEY);
      return v === 'light' || v === 'dark' ? v : null;
    } catch { return null; }
  }
}
