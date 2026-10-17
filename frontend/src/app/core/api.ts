import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';

// Same-origin: the dev server proxies /api to the backend (see proxy.conf.json), so it works from any device that can reach the app.
export const API_URL = '/api';

export type IncomeType = 'Salary' | 'Freelance' | 'Rental' | 'Dividends' | 'Other';
export type IncomeFrequency = 'OneTime' | 'Monthly' | 'Yearly';
export type TransactionType = 'Buy' | 'Sell';

export interface Person { id: number; name: string }
export interface IncomeSource {
  id: number; personId: number; name: string; type: IncomeType; amount: number;
  currency: string; frequency: IncomeFrequency;
}
export type IncomeRequest = Omit<IncomeSource, 'id'>;
export interface IncomeSummary {
  currency: string;
  householdMonthly: number;
  perPerson: { personId: number; person: string; monthly: number }[];
  dividends: {
    available: boolean; error: string | null; taxRate: number; grossMonthly: number; monthly: number;
    holdings: { symbol: string; quantity: number; dividendPerShare: number; currency: string; grossMonthly: number; monthly: number }[];
  };
}

export interface StockTransaction {
  id: number; symbol: string; type: TransactionType; quantity: number; price: number;
  fees: number; currency: string; date: string;
}
export type TransactionRequest = Omit<StockTransaction, 'id'>;
export interface Valuation {
  currency: string;
  valuation: {
    position: { symbol: string; quantity: number; averageCost: number; costBasis: number; realizedGain: number };
    currentPrice: number; marketValue: number; unrealizedGain: number;
    dividendsReceived: number; totalReturn: number; totalReturnPercent: number;
  };
}
export interface Portfolio {
  positions: Valuation[];
  totals: { currency: string; marketValue: number; costBasis: number; totalReturn: number; totalReturnPercent: number };
}

export interface DividendGrowthRates { yoy: number | null; cagr3: number | null; cagr5: number | null; cagr10: number | null }
export interface DividendMetrics {
  currency: string;
  positions: {
    symbol: string; currency: string; quantity: number; price: number; averageCost: number;
    dividendPerShare: number; annualIncome: number; yield: number; yieldOnCost: number; growth: DividendGrowthRates;
  }[];
  totals: { annualIncome: number; yield: number; yieldOnCost: number; growth: DividendGrowthRates; growthYear: number };
}

export interface Slice { label: string; value: number; weightPercent: number }
export interface Diversification {
  currency: string; totalValue: number; holdings: number; largestPosition: Slice | null;
  top3Percent: number; effectiveHoldings: number;
  byPosition: Slice[]; bySector: Slice[]; byCountry: Slice[]; byCurrency: Slice[];
}

export type DividendEventKind = 'Paid' | 'Pending' | 'Confirmed' | 'Projected';
export interface DividendCalendarEvent {
  symbol: string; exDate: string; paymentDate: string; kind: DividendEventKind; paymentDateIsEstimate: boolean;
  shares: number; amountPerShare: number; currency: string; gross: number; grossRon: number; netRon: number;
}
export interface DividendCalendar {
  currency: string; taxRate: number; from: string; to: string; today: string; unavailable: string[];
  events: DividendCalendarEvent[]; next: DividendCalendarEvent | null; next12MonthsNetRon: number;
}

export const EXPENSE_CATEGORIES = ['Housing', 'Utilities', 'Groceries', 'Transport', 'Health', 'Subscriptions', 'Dining', 'Shopping', 'Entertainment', 'Insurance', 'Education', 'Loans', 'Other'] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export type Recurrence = 'OneTime' | 'Monthly' | 'Quarterly' | 'Yearly';

export interface ExpenseRequest {
  name: string; category: ExpenseCategory; amount: number; currency: string; date: string; recurrence: Recurrence; endDate: string | null;
}
export interface ExpenseItem {
  id: number; name: string; category: ExpenseCategory; date: string; amount: number; currency: string; amountRon: number;
  recurrence: Recurrence; recurring: boolean; endDate: string | null;
}
export interface ExpenseSummary {
  currency: string; month: string; items: ExpenseItem[]; total: number; recurringTotal: number; oneTimeTotal: number; fixedMonthly: number;
  byCategory: Slice[]; series: { month: string; total: number; recurring: number; oneTime: number }[]; average12: number;
}
export interface RecurringExpense {
  id: number; name: string; category: ExpenseCategory; amount: number; currency: string; recurrence: Recurrence;
  since: string; endDate: string | null; active: boolean; monthlyRon: number;
}
export interface RecurringExpenses { currency: string; items: RecurringExpense[]; activeMonthlyRon: number }

export interface LoanRequest {
  name: string; principal: number; currency: string; annualRatePercent: number; startDate: string; months: number; earlyRepaymentFeePercent: number;
}
export interface Installment { number: number; date: string; payment: number; interest: number; principal: number; balance: number }
export interface LoanStatus {
  paid: number; remaining: number; balance: number; paidPrincipal: number; paidInterest: number; remainingInterest: number; totalInterest: number;
  endDate: string; next: Installment | null; notStarted: boolean; finished: boolean;
  /** Cash paid so far, and what is still to pay until the end at the regular instalment (principal and interest). */
  paidTotal: number; remainingTotal: number;
  /** True when the figures follow the payments the user recorded, false when every instalment is assumed paid on time. */
  tracked: boolean; scheduledBalance: number; originalEndDate: string;
}
export interface LoanRow extends LoanRequest { id: number; payment: number; status: LoanStatus; paidPercent: number; paymentCount: number }
export interface LoanPaymentRow { id: number; date: string; amount: number; note: string | null }
export interface LoansResponse {
  currency: string; today: string; loans: LoanRow[];
  totals: { balanceRon: number; monthlyPaymentRon: number; remainingInterestRon: number; next: { name: string; date: string; amountRon: number } | null };
}
export interface ScheduleRow extends Installment { paid: boolean }
export interface CurrentLoan { payment: number; remainingMonths: number; endDate: string; remainingInterest: number; balance: number }
export interface EarlyScenario {
  amount: number; fee: number; atInstallment: number; atDate: string; newPayment: number; remainingMonths: number; endDate: string;
  monthsSaved: number; remainingInterest: number; interestSaved: number; netSaving: number; paidOff: boolean;
}
export interface BalancePoint { date: string; balance: number }
export interface EarlyResponse {
  today: string; currency: string; current: CurrentLoan; shorten: EarlyScenario; reduce: EarlyScenario;
  chart: { current: BalancePoint[]; shorten: BalancePoint[]; reduce: BalancePoint[] };
}
export interface ExtraResponse {
  today: string; currency: string; current: CurrentLoan; scenario: EarlyScenario; chart: { current: BalancePoint[]; scenario: BalancePoint[] };
}
export interface PlanSummary {
  months: number; debtFreeDate: string; totalInterest: number; totalFees: number; totalPaid: number; monthsSaved: number; interestSaved: number; netSaving: number;
  order: { name: string; month: number; date: string }[]; balances: number[];
}
export interface StrategyResponse {
  today: string; currency: string; extraPerMonth?: number;
  debts: { name: string; balance: number; annualRatePercent: number; minimumPayment: number; earlyRepaymentFeePercent: number }[];
  minimums: PlanSummary | null; snowball: PlanSummary | null; avalanche: PlanSummary | null;
}

export function errorMessage(e: { error?: unknown }): string {
  const body = e.error;
  if (typeof body === 'string' && body) return body;
  if (body && typeof body === 'object' && 'error' in body) return String((body as { error: unknown }).error);
  return 'Unexpected error.';
}

@Injectable({ providedIn: 'root' })
export class Api {
  private readonly http = inject(HttpClient);

  people = () => this.http.get<Person[]>(`${API_URL}/people`);
  addPerson = (name: string) => this.http.post<Person>(`${API_URL}/people`, { name });
  deletePerson = (id: number) => this.http.delete(`${API_URL}/people/${id}`);

  incomeSources = () => this.http.get<IncomeSource[]>(`${API_URL}/income`);
  incomeSummary = () => this.http.get<IncomeSummary>(`${API_URL}/income/summary`);
  addIncome = (r: IncomeRequest) => this.http.post<IncomeSource>(`${API_URL}/income`, r);
  deleteIncome = (id: number) => this.http.delete(`${API_URL}/income/${id}`);

  transactions = () => this.http.get<StockTransaction[]>(`${API_URL}/portfolio/transactions`);
  addTransaction = (r: TransactionRequest) => this.http.post<StockTransaction>(`${API_URL}/portfolio/transactions`, r);
  deleteTransaction = (id: number) => this.http.delete(`${API_URL}/portfolio/transactions/${id}`);
  dividendMetrics = () => this.http.get<DividendMetrics>(`${API_URL}/portfolio/dividends`);
  diversification = () => this.http.get<Diversification>(`${API_URL}/portfolio/diversification`);
  dividendCalendar = () => this.http.get<DividendCalendar>(`${API_URL}/portfolio/dividend-calendar`);
  expenseSummary = (month?: string) => this.http.get<ExpenseSummary>(`${API_URL}/expenses/summary`, { params: month ? { month } : {} });
  recurringExpenses = () => this.http.get<RecurringExpenses>(`${API_URL}/expenses/recurring`);
  addExpense = (r: ExpenseRequest) => this.http.post(`${API_URL}/expenses`, r);
  updateExpense = (id: number, r: ExpenseRequest) => this.http.put(`${API_URL}/expenses/${id}`, r);
  deleteExpense = (id: number) => this.http.delete(`${API_URL}/expenses/${id}`);
  loans = () => this.http.get<LoansResponse>(`${API_URL}/loans`);
  addLoan = (r: LoanRequest) => this.http.post(`${API_URL}/loans`, r);
  updateLoan = (id: number, r: LoanRequest) => this.http.put(`${API_URL}/loans/${id}`, r);
  deleteLoan = (id: number) => this.http.delete(`${API_URL}/loans/${id}`);
  loanSchedule = (id: number) => this.http.get<{ today: string; tracked: boolean; installments: ScheduleRow[] }>(`${API_URL}/loans/${id}/schedule`);
  loanPayments = (id: number) => this.http.get<{ payments: LoanPaymentRow[]; total: number }>(`${API_URL}/loans/${id}/payments`);
  addLoanPayment = (id: number, body: { date: string; amount: number; note: string | null }) => this.http.post(`${API_URL}/loans/${id}/payments`, body);
  deleteLoanPayment = (id: number, paymentId: number) => this.http.delete(`${API_URL}/loans/${id}/payments/${paymentId}`);
  recordScheduledPayments = (id: number) => this.http.post<{ recorded: number }>(`${API_URL}/loans/${id}/payments/scheduled`, {});
  earlyRepayment = (id: number, amount: number, when: string | null) => this.http.post<EarlyResponse>(`${API_URL}/loans/${id}/early-repayment`, { amount, when });
  extraMonthly = (id: number, extraPerMonth: number) => this.http.post<ExtraResponse>(`${API_URL}/loans/${id}/extra-monthly`, { extraPerMonth });
  strategy = (extraPerMonth: number) => this.http.post<StrategyResponse>(`${API_URL}/loans/strategy`, { extraPerMonth });
  valuation = () => this.http.get<Portfolio>(`${API_URL}/portfolio/valuation`);
}
