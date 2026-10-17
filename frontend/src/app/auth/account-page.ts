import { Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { AuthService } from './auth.service';

@Component({
  selector: 'app-account-page',
  imports: [FormsModule],
  styles: `
    .who { display: flex; align-items: center; gap: 1rem; }
    .avatar { display: grid; place-items: center; width: 52px; height: 52px; border-radius: 50%; background: var(--hero-bg); color: #fff; font-size: 1.3rem; font-weight: 700; }
    .who strong { display: block; font-size: 1.1rem; }
    .who span { color: var(--muted); }
    form { flex-direction: column; align-items: stretch; max-width: 380px; gap: 1rem; }
    .ok { color: var(--pos); background: rgb(43 208 124 / .12); border-radius: var(--radius-sm); padding: .8rem 1rem; margin: 0 0 1rem; max-width: 380px; }
    .error { max-width: 380px; }
  `,
  template: `
    <div class="page-head">
      <span class="eyebrow">Account</span>
      <h2>Your account</h2>
    </div>

    <div class="card">
      <div class="who">
        <span class="avatar" aria-hidden="true">{{ (auth.email() ?? '?')[0].toUpperCase() }}</span>
        <div><strong>{{ auth.email() }}</strong><span>All the data in this app belongs to this account.</span></div>
      </div>
    </div>

    <div class="card">
      <h3>Change password</h3>
      @if (done()) { <p class="ok" role="status">Password changed.</p> }
      @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
      <form (submit)="$event.preventDefault(); change()">
        <label>Current password <input name="current" type="password" autocomplete="current-password" [(ngModel)]="current" required /></label>
        <label>New password <input name="next" type="password" autocomplete="new-password" minlength="10" [(ngModel)]="next" required /></label>
        <label>Repeat the new password <input name="again" type="password" autocomplete="new-password" [(ngModel)]="again" required /></label>
        <div><button [disabled]="busy() || !current || next.length < 10 || next !== again">Change password</button></div>
        @if (again && next !== again) { <small>The two new passwords are different.</small> }
      </form>
    </div>

    <div class="card">
      <h3>Sign out</h3>
      <p style="color: var(--muted); margin-top: 0">Ends the session on this device. Your data stays safe in your account.</p>
      <button type="button" class="ghost" (click)="auth.logout()">Sign out</button>
    </div>
  `,
})
export class AccountPage {
  protected readonly auth = inject(AuthService);
  protected readonly error = signal('');
  protected readonly done = signal(false);
  protected readonly busy = signal(false);

  protected current = '';
  protected next = '';
  protected again = '';

  protected async change() {
    this.error.set(''); this.done.set(false); this.busy.set(true);
    try {
      await this.auth.changePassword(this.current, this.next);
      this.current = this.next = this.again = '';
      this.done.set(true);
    } catch (e) {
      const body = (e as HttpErrorResponse).error;
      this.error.set(body && typeof body === 'object' && 'error' in body ? String(body.error) : 'Something went wrong. Please try again.');
    } finally {
      this.busy.set(false);
    }
  }
}
