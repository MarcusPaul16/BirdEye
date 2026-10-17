import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_URL } from '../core/api';

export interface AuthStatus { authenticated: boolean; email: string | null; registrationOpen: boolean; setupCodeRequired: boolean }
export interface Claimed { people: number; incomeSources: number; transactions: number; expenses: number }
export interface RegisterResult { email: string; claimed: Claimed | null }

/**
 * Who is signed in. The session itself lives in an HttpOnly cookie the browser sends by itself; this only remembers the answer of
 * /api/auth/status so the app knows whether to show the sign-in page. After signing in or out the page is reloaded (see the callers), so
 * nothing from one account can linger in memory for the next.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);

  readonly email = signal<string | null>(null);
  readonly registrationOpen = signal(false);
  readonly setupCodeRequired = signal(false);
  readonly ready = signal(false);

  /** Run before the app starts routing, so the guards know the answer. A failure just means "not signed in". */
  async init(): Promise<void> {
    try {
      const s = await firstValueFrom(this.http.get<AuthStatus>(`${API_URL}/auth/status`));
      this.email.set(s.authenticated ? s.email : null);
      this.registrationOpen.set(s.registrationOpen);
      this.setupCodeRequired.set(s.setupCodeRequired);
    } catch {
      this.email.set(null);
    } finally {
      this.ready.set(true);
    }
  }

  login(email: string, password: string, rememberMe: boolean) {
    return firstValueFrom(this.http.post<{ email: string }>(`${API_URL}/auth/login`, { email, password, rememberMe }));
  }

  register(email: string, password: string, setupCode: string | null) {
    return firstValueFrom(this.http.post<RegisterResult>(`${API_URL}/auth/register`, { email, password, setupCode }));
  }

  async logout(): Promise<void> {
    try { await firstValueFrom(this.http.post(`${API_URL}/auth/logout`, null)); } catch { /* the cookie is cleared server-side; the reload below settles it either way */ }
    window.location.assign('/login');
  }

  changePassword(currentPassword: string, newPassword: string) {
    return firstValueFrom(this.http.post(`${API_URL}/auth/password`, { currentPassword, newPassword }));
  }

  /** The session ended (cookie expired, signed out elsewhere): go to the sign-in page with a clean slate. */
  expired() {
    if (window.location.pathname.startsWith('/login')) return;
    const back = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.assign(`/login?returnUrl=${back}`);
  }
}
