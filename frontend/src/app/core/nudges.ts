import { formatMoney } from '../shared/money.pipe';

export interface NudgeInput {
  /** yyyy-MM-dd, the user's local date. */
  today: string;
  currency: string;
  taxRate: number;
  /** Portfolio dividends per month, after tax, in `currency`. */
  dividendsMonthly: number;
  /** Recurring expenses that are still running, with their monthly cost in `currency`. */
  recurring: { name: string; category: string; monthly: number }[];
  spentThisMonth: number;
  /** Average monthly spending over the last 12 months (months without expenses count as zero). */
  average12: number;
  incomeMonthly: number;
  /** Gross dividend yield of the portfolio, in percent. */
  dividendYieldPct: number | null;
  /** Year-on-year growth of the dividend per share across the holdings, in percent. */
  dividendGrowthPct: number | null;
  next: { symbol: string; paymentDate: string; net: number } | null;
}

/** `text` marks the figures to emphasise with **double asterisks**; the component renders them without injecting HTML. */
export interface Nudge { id: string; text: string }

const SUBSCRIPTION_LIKE = new Set(['Subscriptions', 'Entertainment']);

const day = (date: string) => Math.floor(Date.parse(date + 'T00:00:00Z') / 864e5);

/**
 * Motivational observations about the user's own numbers. Each rule fires only when its claim is true for this data, so a tip never says
 * dividends cover something they do not. 
 */
export function buildNudges(i: NudgeInput): Nudge[] {
  const out: Nudge[] = [];
  // Whole numbers for anything from 10 up or exactly whole ("RON 9"), cents only for small fractional amounts ("RON 3.50").
  const money = (v: number) => {
    const digits = v >= 10 || Number.isInteger(v) ? 0 : 2;
    return formatMoney(v, i.currency, digits, digits);
  };
  const active = i.recurring.filter(r => r.monthly > 0);
  const div = i.dividendsMonthly;
  const pref = (r: { category: string }) => (SUBSCRIPTION_LIKE.has(r.category) ? 0 : 1);

  if (div > 0) {
    // 1. A bill the dividends already cover. Subscriptions first: they are what people like to see "paid for".
    const covered = active.filter(r => r.monthly <= div).sort((a, b) => pref(a) - pref(b) || b.monthly - a.monthly)[0];
    if (covered) {
      out.push({
        id: `covers:${covered.name}`,
        text: `Hey! Your monthly dividends (**${money(div)}** after tax) could pay for **${covered.name}** (${money(covered.monthly)} a month)${div - covered.monthly >= 1 ? ` and still leave ${money(div - covered.monthly)}` : ''}.`,
      });
    }

    // 2. All subscriptions together.
    const subs = active.filter(r => r.category === 'Subscriptions');
    const subsTotal = subs.reduce((a, r) => a + r.monthly, 0);
    if (subs.length >= 2 && subsTotal <= div) {
      out.push({ id: 'covers-all-subscriptions', text: `Your dividends now cover **all ${subs.length} of your subscriptions** (${money(subsTotal)} a month together).` });
    }

    // 3. Close to covering one more bill.
    const next = active.filter(r => r.monthly > div && div >= r.monthly * 0.25).sort((a, b) => pref(a) - pref(b) || a.monthly - b.monthly)[0];
    if (next) {
      out.push({ id: `almost:${next.name}`, text: `You are **${money(next.monthly - div)} a month** away from paying for **${next.name}** with dividends. Keep going!` });
    }

    // 4. Share of spending covered, and what a bit more invested would add.
    const base = i.average12 > 0 ? i.average12 : i.spentThisMonth;
    if (base > 0 && (div / base) * 100 >= 0.5) {
      const pct = (div / base) * 100;
      const add = i.dividendYieldPct && i.dividendYieldPct > 0 ? (1000 * (i.dividendYieldPct / 100) * (1 - i.taxRate)) / 12 : 0;
      out.push({
        id: 'coverage',
        text: `Your dividends already cover **${pct >= 10 ? pct.toFixed(0) : pct.toFixed(1)}%** of your monthly spending.${add >= 0.5 ? ` At today's yield, every ${money(1000)} you invest adds about **${money(add)}** a month after tax.` : ''}`,
      });
    }
  }

  // 5. Saving a good share of income this month.
  if (i.incomeMonthly > 0 && i.spentThisMonth > 0) {
    const kept = ((i.incomeMonthly - i.spentThisMonth) / i.incomeMonthly) * 100;
    if (kept >= 20) out.push({ id: 'savings', text: `You are keeping **${kept.toFixed(0)}%** of this month's income. Nice work!` });
  }

  // 6. Spending below the usual, once the month is far enough along to mean something.
  const dayOfMonth = +i.today.slice(8, 10);
  if (i.average12 > 0 && i.spentThisMonth > 0 && dayOfMonth >= 20 && i.spentThisMonth <= i.average12 * 0.85) {
    out.push({ id: 'below-average', text: `You have spent **${(((i.average12 - i.spentThisMonth) / i.average12) * 100).toFixed(0)}% less** than in a usual month. Well done!` });
  }

  // 7. Dividend growth, with the rule of 72 for the doubling time.
  const g = i.dividendGrowthPct;
  if (g !== null && g >= 3 && div > 0) {
    out.push({
      id: 'growth',
      text: `The dividends you earn have been growing about **${g.toFixed(1)}%** a year. If that holds, they double in roughly **${Math.round(72 / g)} years**, even if you add nothing.`,
    });
  }

  // 8. The next payout, when it is close.
  if (i.next) {
    const days = day(i.next.paymentDate) - day(i.today);
    if (days >= 0 && days <= 21 && i.next.net > 0) {
      out.push({ id: 'next-payout', text: `Coming up: **${i.next.symbol}** pays about **${money(i.next.net)}** ${days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`}.` });
    }
  }
  return out;
}

/**
 * A tip chosen at random for the "Motivate me" button. It never repeats the one just shown (when there is more than one), so every press
 * gives something new. `random` is injectable so the choice is testable.
 */
export function pickRandom(nudges: Nudge[], previousId: string | null = null, random: () => number = Math.random): Nudge | null {
  if (!nudges.length) return null;
  const pool = nudges.length > 1 ? nudges.filter(n => n.id !== previousId) : nudges;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}
