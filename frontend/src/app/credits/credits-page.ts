import { Component } from '@angular/core';
import { MoneyPipe } from '../shared/money.pipe';

// MOCK: static test data. Real loan tracking comes after income and investments.
const MOCK_LOANS = [
  { name: 'Mortgage (mock)', remaining: 85000, monthly: 2200, currency: 'USD' },
  { name: 'Car loan (mock)', remaining: 7500, monthly: 450, currency: 'USD' },
];

@Component({
  selector: 'app-credits-page',
  imports: [MoneyPipe],
  template: `
    <div class="page-head">
      <span class="eyebrow">Liabilities</span>
      <h2>Credits <span class="badge">mock</span></h2>
      <p>Placeholder data. Real loan tracking comes after income and investments.</p>
    </div>
    <div class="card table-wrap">
      <table>
        <thead><tr><th>Loan</th><th class="num">Remaining</th><th class="num">Monthly payment</th></tr></thead>
        <tbody>
          @for (l of loans; track l.name) {
            <tr><td>{{ l.name }}</td><td class="num">{{ l.remaining | money: l.currency : 'symbol' : '1.0-0' }}</td><td class="num">{{ l.monthly | money: l.currency : 'symbol' : '1.0-0' }}</td></tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class CreditsPage {
  protected readonly loans = MOCK_LOANS;
}
