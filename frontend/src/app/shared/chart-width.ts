import { DestroyRef, ElementRef, Signal, inject, signal } from '@angular/core';

/**
 * The rendered width of the host element, as a signal, clamped to [min, max].
 * Charts draw in a viewBox as wide as the space they get, so text stays at its real size on a phone instead of
 * shrinking with the whole drawing. The cap keeps desktop drawings at their designed proportions.
 */
export function observeWidth(max = 800, min = 300): Signal<number> {
  const host = inject(ElementRef).nativeElement as HTMLElement;
  const width = signal(max);
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(entries => {
      const w = Math.round(entries[0].contentRect.width);
      if (w > 0) width.set(Math.min(max, Math.max(min, w)));
    });
    observer.observe(host);
    inject(DestroyRef).onDestroy(() => observer.disconnect());
  }
  return width;
}
