import { Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { AuthService, Claimed } from './auth.service';

type Mode = 'signin' | 'register';

@Component({
  selector: 'app-login-page',
  imports: [FormsModule],
  styles: `
    :host { display: grid; place-items: center; min-height: calc(100vh - 4rem); }
    .card { width: min(440px, 100%); margin: 0; padding: 2rem; }
    .brand { display: flex; align-items: center; gap: .6rem; margin-bottom: 1.75rem; color: var(--text); }
    .brand svg { color: var(--accent); }
    .brand span { font-size: 1.4rem; font-weight: 800; letter-spacing: -.04em; }
    .brand em { font-style: normal; color: var(--accent); }
    h1 { font-size: 1.75rem; margin: 0 0 .4rem; letter-spacing: -.03em; }
    .lead { color: var(--muted); margin: 0 0 1.5rem; line-height: 1.5; }
    form { flex-direction: column; align-items: stretch; gap: 1rem; }
    label { gap: .45rem; }
    .pw { position: relative; display: flex; }
    .pw input { flex: 1; padding-right: 4.5rem; }
    .pw button { position: absolute; right: .35rem; top: 50%; transform: translateY(-50%); padding: .3rem .7rem; font-size: .8rem; }
    .check { flex-direction: row; align-items: center; gap: .6rem; color: var(--text); font-weight: 400; }
    .check input { width: 18px; height: 18px; accent-color: var(--hero-bg); }
    .submit { width: 100%; padding: .9rem; font-size: 1rem; margin-top: .25rem; }
    .switch { margin-top: 1.25rem; text-align: center; color: var(--muted); }
    .switch button { background: none; color: var(--accent-strong); padding: 0; font-weight: 600; border-radius: 4px; }
    .info { background: rgb(var(--accent-rgb) / .12); border-radius: var(--radius-sm); padding: .85rem 1rem; margin: 0 0 1.25rem; font-size: .9rem; line-height: 1.5; }
    .error { margin: 0 0 1rem; }
    .claimed { list-style: none; margin: 1rem 0 1.5rem; padding: 0; display: grid; gap: .5rem; }
    .claimed li { display: flex; justify-content: space-between; background: var(--surface-2); border-radius: var(--radius-sm); padding: .7rem 1rem; }
    .claimed strong { font-variant-numeric: tabular-nums; }
    .hint { color: var(--muted); font-size: .8rem; font-weight: 400; }
  `,
  template: `
    <div class="card">
      <div class="brand">
        <svg width="30" height="30" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M2 16s5-9 14-9 14 9 14 9-5 9-14 9S2 16 2 16Z" /><circle cx="16" cy="16" r="5.5" /><circle cx="16" cy="16" r="2" fill="currentColor" />
        </svg>
        <span>Bird<em>Eye</em></span>
      </div>

      @if (claimed(); as c) {
        <h1>You're all set</h1>
        <p class="lead">Your account is ready, and the data you had already recorded now belongs to it:</p>
        <ul class="claimed">
          <li><span>People</span><strong>{{ c.people }}</strong></li>
          <li><span>Income sources</span><strong>{{ c.incomeSources }}</strong></li>
          <li><span>Stock transactions</span><strong>{{ c.transactions }}</strong></li>
          <li><span>Expenses</span><strong>{{ c.expenses }}</strong></li>
        </ul>
        <button type="button" class="submit" (click)="finish()">Continue</button>
      } @else {
        <h1>{{ mode() === 'signin' ? 'Welcome back' : 'Create your account' }}</h1>
        <p class="lead">{{ mode() === 'signin' ? 'Sign in to see your finances.' : 'Use your email and a password of at least 10 characters.' }}</p>

        @if (mode() === 'register' && auth.setupCodeRequired()) {
          <p class="info">This is the first account, so it also receives the data already stored. To prove you have access to the server, enter the
            <strong>setup code</strong> from the API log.</p>
        }
        @if (error()) { <p class="error" role="alert">{{ error() }}</p> }

        <form (submit)="$event.preventDefault(); submit()">
          <label>Email
            <input name="email" type="email" autocomplete="username" [(ngModel)]="email" required autofocus />
          </label>
          <label>Password
            <span class="pw">
              <input name="password" [type]="show() ? 'text' : 'password'" [attr.autocomplete]="mode() === 'signin' ? 'current-password' : 'new-password'"
                     [(ngModel)]="password" required [attr.minlength]="mode() === 'register' ? 10 : null" />
              <button type="button" class="ghost" (click)="show.set(!show())" [attr.aria-label]="show() ? 'Hide password' : 'Show password'">{{ show() ? 'Hide' : 'Show' }}</button>
            </span>
            @if (mode() === 'register') { <span class="hint">At least 10 characters. A few random words work well.</span> }
          </label>
          @if (mode() === 'register' && auth.setupCodeRequired()) {
            <label>Setup code
              <input name="setupCode" autocomplete="off" spellcheck="false" placeholder="XXXX-XXXX" [(ngModel)]="setupCode" required />
            </label>
          }
          @if (mode() === 'signin') {
            <label class="check"><input name="remember" type="checkbox" [(ngModel)]="remember" /> Keep me signed in</label>
          }
          <button class="submit" [disabled]="busy() || !email.trim() || !password">{{ busy() ? 'One moment…' : mode() === 'signin' ? 'Sign in' : 'Create account' }}</button>
        </form>

        @if (auth.registrationOpen()) {
          <p class="switch">
            @if (mode() === 'signin') { {{ auth.setupCodeRequired() ? 'No account yet?' : 'New here?' }} <button type="button" (click)="setMode('register')">Create an account</button> }
            @else { Already have an account? <button type="button" (click)="setMode('signin')">Sign in</button> }
          </p>
        }
      }
    </div>
  `,
})
export class LoginPage {
  protected readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);

  // With no account yet the only useful thing to do is create one.
  protected readonly mode = signal<Mode>(this.auth.setupCodeRequired() ? 'register' : 'signin');
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly show = signal(false);
  protected readonly claimed = signal<Claimed | null>(null);

  protected email = '';
  protected password = '';
  protected setupCode = '';
  protected remember = true;

  protected setMode(mode: Mode) { this.mode.set(mode); this.error.set(''); }

  /** Only paths inside this app: a crafted ?returnUrl= must not be able to send someone to another site after signing in. */
  private target() {
    const back = this.route.snapshot.queryParamMap.get('returnUrl');
    return back && back.startsWith('/') && !back.startsWith('//') ? back : '/portfolio';
  }

  protected finish() { window.location.assign(this.target()); }

  protected async submit() {
    this.error.set('');
    this.busy.set(true);
    try {
      if (this.mode() === 'signin') {
        await this.auth.login(this.email.trim(), this.password, this.remember);
        this.finish(); // a full load, so nothing from a previous account can linger in memory
      } else {
        const result = await this.auth.register(this.email.trim(), this.password, this.auth.setupCodeRequired() ? this.setupCode.trim() : null);
        if (result.claimed) this.claimed.set(result.claimed); else this.finish();
      }
    } catch (e) {
      this.error.set(this.message(e));
    } finally {
      this.busy.set(false);
    }
  }

  private message(e: unknown): string {
    const err = e as HttpErrorResponse;
    const body = err.error;
    if (body && typeof body === 'object' && 'error' in body) return String(body.error);
    return err.status === 0 ? 'Cannot reach the server. Check your connection and try again.' : 'Something went wrong. Please try again.';
  }
}
