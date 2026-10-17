import { Injectable, inject, signal } from '@angular/core';
import { catchError, forkJoin, of } from 'rxjs';
import { Api } from './api';
import { Nudge, NudgeInput, buildNudges } from './nudges';

export const localDate = () => new Date().toLocaleDateString('sv'); // yyyy-MM-dd in local time

/** Gathers the numbers the tips are based on, once per session. Each source can fail on its own without losing the rest. */
@Injectable({ providedIn: 'root' })
export class NudgeService {
  private readonly api = inject(Api);
  private loadedAt = 0;
  private inflight = false;

  /** null while loading; an empty list when there is nothing to say. */
  readonly nudges = signal<Nudge[] | null>(null);
  readonly loading = signal(false);

  /** Loads the data unless it is fresh (under a minute old) or already loading; the previous tips stay available meanwhile. */
  load() {
    if (this.inflight || Date.now() - this.loadedAt < 60_000) return;
    this.inflight = true;
    this.loading.set(true);
    const safe = <T>(o: import('rxjs').Observable<T>) => o.pipe(catchError(() => of(null)));
    forkJoin({
      income: safe(this.api.incomeSummary()),
      recurring: safe(this.api.recurringExpenses()),
      expenses: safe(this.api.expenseSummary()),
      dividends: safe(this.api.dividendMetrics()),
      calendar: safe(this.api.dividendCalendar()),
    }).subscribe(d => {
      const input: NudgeInput = {
        today: localDate(),
        currency: 'RON',
        taxRate: d.income?.dividends.taxRate ?? 0.16,
        dividendsMonthly: d.income?.dividends.monthly ?? 0,
        recurring: (d.recurring?.items ?? []).filter(r => r.active).map(r => ({ name: r.name, category: r.category, monthly: r.monthlyRon })),
        spentThisMonth: d.expenses?.total ?? 0,
        average12: d.expenses?.average12 ?? 0,
        incomeMonthly: d.income?.householdMonthly ?? 0,
        dividendYieldPct: d.dividends?.totals.yield ?? null,
        dividendGrowthPct: d.dividends?.totals.growth.yoy ?? null,
        next: d.calendar?.next ? { symbol: d.calendar.next.symbol, paymentDate: d.calendar.next.paymentDate, net: d.calendar.next.netRon } : null,
      };
      this.nudges.set(buildNudges(input));
      this.loadedAt = Date.now();
      this.inflight = false;
      this.loading.set(false);
    });
  }
}
