import { Component, ElementRef, HostListener, computed, effect, inject, signal } from '@angular/core';
import { NudgeService } from '../core/nudge.service';
import { Nudge, pickRandom } from '../core/nudges';

/**
 * The "Motivate me" button. Pressing it opens a panel with a short, true observation about the user's own numbers; pressing it again
 * (or "Another one") shows a different one. Closes with the cross, Escape, or a click elsewhere.
 */
@Component({
  selector: 'app-motivate',
  styles: `
    :host { display: block; }
    .btn {
      display: flex; align-items: center; justify-content: center; gap: .6rem; width: 100%; padding: .8rem 1rem; border-radius: 999px;
      background: var(--hero-bg); color: #fff; font-weight: 700; font-size: .92rem;
    }
    .btn svg { flex: none; }
    .panel {
      position: fixed; z-index: 40; left: calc(var(--side, 248px) + 12px); bottom: 1.25rem; width: min(380px, calc(100vw - 2rem));
      padding: 1.25rem 1.25rem 1.1rem; border-radius: var(--radius); background: var(--surface); box-shadow: var(--shadow-pop);
      border: 1px solid var(--line);
    }
    .head { display: flex; align-items: center; gap: .75rem; margin-bottom: .75rem; }
    .ico { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 50%; background: var(--hero-bg); color: #fff; flex: none; }
    .head strong { flex: 1; font-size: .95rem; }
    .close { background: transparent; color: var(--muted); padding: .3rem .55rem; border-radius: 50%; font-size: .85rem; }
    .close:hover:not(:disabled) { background: var(--surface-2); color: var(--text); filter: none; }
    p { margin: 0 0 1rem; line-height: 1.55; font-size: 1.02rem; white-space: pre-wrap; }
    .b { font-weight: 700; color: var(--accent-strong); }
    .muted { color: var(--muted); }
    .acts { display: flex; justify-content: flex-end; }
    @media (max-width: 900px) {
      :host { width: auto; }
      .btn { width: auto; padding: .55rem 1rem; font-size: .85rem; }
      .panel { left: 1rem; right: 1rem; width: auto; bottom: calc(5rem + env(safe-area-inset-bottom)); }
    }
  `,
  template: `
    <button type="button" class="btn" (click)="press()" [attr.aria-expanded]="open()" aria-haspopup="dialog">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /><path d="M19 3v4M17 5h4M5 17v4M3 19h4" />
      </svg>
      <span>Motivate me</span>
    </button>

    @if (open()) {
      <div class="panel" role="dialog" aria-label="A motivational tip">
        <div class="head">
          <span class="ico" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z" />
            </svg>
          </span>
          <strong>Keep going</strong>
          <button type="button" class="close" (click)="open.set(false)" aria-label="Close">✕</button>
        </div>

        @if (tip(); as t) {
          <p aria-live="polite">@for (part of parts(t.text); track $index) {<span [class.b]="part.bold">{{ part.t }}</span>}</p>
          @if (count() > 1) { <div class="acts"><button type="button" class="ghost" (click)="another()">Another one</button></div> }
        } @else if (waiting()) {
          <p class="muted" aria-live="polite">Finding something to cheer about…</p>
        } @else {
          <p class="muted">Nothing to cheer about just yet. Add your income, your expenses and a few stocks, and I will find something.</p>
        }
      </div>
    }
  `,
})
export class Motivate {
  private readonly service = inject(NudgeService);
  private readonly host = inject(ElementRef).nativeElement as HTMLElement;

  protected readonly open = signal(false);
  protected readonly tip = signal<Nudge | null>(null);
  protected readonly waiting = signal(false);
  protected readonly count = computed(() => this.service.nudges()?.length ?? 0);

  constructor() {
    // Warm the data up shortly after the app opens, so the first press is instant.
    setTimeout(() => this.service.load(), 2500);

    // If the button was pressed before the data arrived, show a tip as soon as it does.
    effect(() => {
      const list = this.service.nudges();
      if (this.waiting() && list) { this.waiting.set(false); this.choose(list); }
    });
  }

  protected press() {
    // Pressing while the panel is open is the same as "Another one": the button is a tip dispenser.
    if (this.open() && this.tip()) { this.another(); return; }
    this.open.set(true);
    this.service.load(); // refreshes when the data is over a minute old; the current tips stay usable meanwhile
    const list = this.service.nudges();
    if (list) this.choose(list); else this.waiting.set(true);
  }

  protected another() {
    const list = this.service.nudges();
    if (list) this.choose(list);
  }

  private choose(list: Nudge[]) { this.tip.set(pickRandom(list, this.tip()?.id ?? null)); }

  /** Splits "text with **bold** figures" into plain and emphasised pieces, so no HTML is ever injected. */
  protected parts(text: string) {
    return text.split('**').map((t, i) => ({ t, bold: i % 2 === 1 })).filter(p => p.t !== '');
  }

  @HostListener('document:keydown.escape') protected onEscape() { this.open.set(false); }

  @HostListener('document:click', ['$event']) protected onDocumentClick(e: MouseEvent) {
    if (this.open() && !this.host.contains(e.target as Node)) this.open.set(false);
  }
}
