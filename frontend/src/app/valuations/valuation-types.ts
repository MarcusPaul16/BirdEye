export interface KeyValue { label: string; value: string }

export interface ModelResult {
  id: string; name: string; applicable: boolean; reliable: boolean;
  fairValue: number | null; low: number | null; high: number | null;
  description: string; inputs: KeyValue[]; note: string | null;
}

/** Rates are fractions (0.08 = 8%). */
export interface Assumptions {
  discountRate: number; terminalGrowth: number; growth: number; dividendGrowth: number; bondYield: number; projectionYears: number;
}

export interface ChannelPoint { date: string; price: number; cheap: number; fair: number; rich: number }
export interface ChannelResult {
  currentYield: number; cheapYield: number; medianYield: number; richYield: number; lookbackYears: number;
  dividendPerShare: number; points: ChannelPoint[];
}
export interface Sensitivity { discountRates: number[]; growths: number[]; values: (number | null)[][] }

export type Verdict = 'Undervalued' | 'Fair' | 'Overvalued';

export interface ValuationReport {
  symbol: string; currency: string; price: number;
  assumptions: Assumptions; defaults: Assumptions;
  models: ModelResult[];
  blendedFairValue: number | null; upside: number | null; verdict: Verdict | null;
  analystTarget: number | null; channel: ChannelResult | null; sensitivity: Sensitivity | null; impliedGrowth: number | null;
  warnings: string[];
}

export interface ValuationResponse { name: string; sector: string | null; report: ValuationReport }
