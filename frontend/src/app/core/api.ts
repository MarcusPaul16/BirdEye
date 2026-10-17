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
  valuation = () => this.http.get<Portfolio>(`${API_URL}/portfolio/valuation`);
}
