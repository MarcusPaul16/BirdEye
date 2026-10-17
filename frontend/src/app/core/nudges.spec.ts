import { Nudge, NudgeInput, buildNudges, pickRandom } from './nudges';

const base: NudgeInput = {
  today: '2026-10-17', currency: 'RON', taxRate: 0.16, dividendsMonthly: 0, recurring: [], spentThisMonth: 0, average12: 0,
  incomeMonthly: 0, dividendYieldPct: null, dividendGrowthPct: null, next: null,
};
const input = (o: Partial<NudgeInput>): NudgeInput => ({ ...base, ...o });
const ids = (o: Partial<NudgeInput>) => buildNudges(input(o)).map(n => n.id);
// Intl puts a no-break space between "RON" and the number (so they never split across lines); compare with plain spaces.
const text = (o: Partial<NudgeInput>, id: string) => (buildNudges(input(o)).find(n => n.id === id)?.text ?? '').replace(/\u00a0/g, ' ');

describe('dividends covering a bill', () => {
  const disney = { name: 'Disney+', category: 'Subscriptions', monthly: 40 };

  it('says so when the monthly dividends pay for a subscription, with what is left over', () => {
    const t = text({ dividendsMonthly: 128, recurring: [disney] }, 'covers:Disney+');
    expect(t).toContain('**RON 128**');
    expect(t).toContain('**Disney+**');
    expect(t).toContain('RON 88');
  });

  it('never claims coverage when the dividends fall short', () => {
    expect(ids({ dividendsMonthly: 39.99, recurring: [disney] }).some(id => id.startsWith('covers:'))).toBe(false);
  });

  it('claims nothing about dividends when there are none', () => {
    const got = ids({ dividendsMonthly: 0, recurring: [disney], dividendYieldPct: 5, dividendGrowthPct: 5 });
    expect(got.filter(id => ['coverage', 'growth', 'covers-all-subscriptions'].includes(id) || id.startsWith('covers:') || id.startsWith('almost:'))).toEqual([]);
  });

  it('prefers a subscription over a more expensive bill of another kind', () => {
    const got = ids({ dividendsMonthly: 500, recurring: [{ name: 'Gym', category: 'Health', monthly: 300 }, { name: 'Netflix', category: 'Subscriptions', monthly: 50 }] });
    expect(got).toContain('covers:Netflix');
    expect(got).not.toContain('covers:Gym');
  });

  it('picks the most expensive subscription the dividends can pay for', () => {
    const got = ids({ dividendsMonthly: 100, recurring: [disney, { name: 'Spotify', category: 'Subscriptions', monthly: 30 }, { name: 'HBO', category: 'Subscriptions', monthly: 70 }] });
    expect(got).toContain('covers:HBO');
  });

  it('ignores zero-cost entries', () => {
    expect(ids({ dividendsMonthly: 100, recurring: [{ name: 'Free trial', category: 'Subscriptions', monthly: 0 }] }).some(id => id.startsWith('covers:'))).toBe(false);
  });

  it('says all subscriptions are covered only with two or more of them, and only when the total fits', () => {
    const two = [disney, { name: 'Spotify', category: 'Subscriptions', monthly: 30 }];
    expect(ids({ dividendsMonthly: 70, recurring: two })).toContain('covers-all-subscriptions');
    expect(ids({ dividendsMonthly: 69, recurring: two })).not.toContain('covers-all-subscriptions');
    expect(ids({ dividendsMonthly: 500, recurring: [disney] })).not.toContain('covers-all-subscriptions');
  });

  it('encourages when close to covering a bill, but not when far from it', () => {
    const t = text({ dividendsMonthly: 31, recurring: [disney] }, 'almost:Disney+');
    expect(t).toContain('RON 9 a month');
    expect(ids({ dividendsMonthly: 5, recurring: [disney] })).not.toContain('almost:Disney+');
  });
});

describe('coverage of spending', () => {
  it('shows the share of spending covered and what 1,000 invested would add after tax', () => {
    // 5% yield, 16% tax: 1000 x 0.05 x 0.84 / 12 = 3.5 a month
    const t = text({ dividendsMonthly: 50, average12: 1000, dividendYieldPct: 5 }, 'coverage');
    expect(t).toContain('**5.0%**');
    expect(t).toContain('RON 3.50');
  });

  it('stays quiet when the share is negligible', () => {
    expect(ids({ dividendsMonthly: 1, average12: 5000 })).not.toContain('coverage');
  });

  it('falls back to this month spending when there is no history', () => {
    expect(ids({ dividendsMonthly: 50, average12: 0, spentThisMonth: 500 })).toContain('coverage');
  });
});

describe('savings and spending', () => {
  it('celebrates keeping at least a fifth of the income', () => {
    expect(text({ incomeMonthly: 10000, spentThisMonth: 2500 }, 'savings')).toContain('**75%**');
    expect(ids({ incomeMonthly: 10000, spentThisMonth: 8100 })).not.toContain('savings');
    expect(ids({ incomeMonthly: 10000, spentThisMonth: 12000 })).not.toContain('savings');
  });

  it('praises below-average spending only late in the month', () => {
    expect(text({ today: '2026-10-25', average12: 1000, spentThisMonth: 800 }, 'below-average')).toContain('**20% less**');
    expect(ids({ today: '2026-10-05', average12: 1000, spentThisMonth: 100 })).not.toContain('below-average');
    expect(ids({ today: '2026-10-25', average12: 1000, spentThisMonth: 900 })).not.toContain('below-average');
  });
});

describe('growth and payouts', () => {
  it('uses the rule of 72 for the doubling time', () => {
    const t = text({ dividendsMonthly: 20, dividendGrowthPct: 4.2 }, 'growth');
    expect(t).toContain('**4.2%**');
    expect(t).toContain('**17 years**');
  });

  it('needs real growth to talk about it', () => {
    expect(ids({ dividendsMonthly: 20, dividendGrowthPct: 2 })).not.toContain('growth');
    expect(ids({ dividendsMonthly: 20, dividendGrowthPct: -5 })).not.toContain('growth');
  });

  it('announces a payout that is close, with the right wording for the day', () => {
    const next = (paymentDate: string) => ({ symbol: 'O', paymentDate, net: 10.89 });
    expect(text({ next: next('2026-10-19') }, 'next-payout')).toContain('in 2 days');
    expect(text({ next: next('2026-10-18') }, 'next-payout')).toContain('tomorrow');
    expect(text({ next: next('2026-10-17') }, 'next-payout')).toContain('today');
    expect(ids({ next: next('2026-11-30') })).not.toContain('next-payout');
    expect(ids({ next: next('2026-10-10') })).not.toContain('next-payout');
  });
});

describe('robustness', () => {
  it('produces nothing, and nothing odd, for an empty profile', () => {
    expect(buildNudges(base)).toEqual([]);
  });

  it('never prints NaN or Infinity', () => {
    const all = buildNudges(input({
      dividendsMonthly: 128, recurring: [{ name: 'A', category: 'Subscriptions', monthly: 40 }, { name: 'B', category: 'Subscriptions', monthly: 20 }, { name: 'C', category: 'Housing', monthly: 500 }],
      spentThisMonth: 700, average12: 900, incomeMonthly: 9000, dividendYieldPct: 5.5, dividendGrowthPct: 4, today: '2026-10-25',
      next: { symbol: 'KO', paymentDate: '2026-10-27', net: 3 },
    }));
    expect(all.length).toBeGreaterThan(4);
    for (const n of all) expect(n.text).not.toMatch(/NaN|Infinity|undefined/);
  });
});

describe('the random pick for "Motivate me"', () => {
  const tips = [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }, { id: 'c', text: 'C' }];

  it('is empty when there is nothing to say', () => expect(pickRandom([])).toBeNull());

  it('returns the only tip even if it was just shown', () => {
    expect(pickRandom([tips[0]], 'a')?.id).toBe('a');
  });

  it('never repeats the previous tip when there is a choice', () => {
    for (const r of [0, 0.2, 0.5, 0.74, 0.99]) expect(pickRandom(tips, 'b', () => r)?.id).not.toBe('b');
  });

  it('can reach every tip, and stays in range for extreme random values', () => {
    expect(new Set([0, 0.34, 0.67].map(r => pickRandom(tips, null, () => r)!.id)).size).toBe(3);
    expect(pickRandom(tips, null, () => 0.999999)?.id).toBe('c');
    expect(pickRandom(tips, null, () => 1)?.id).toBe('c');
    expect(pickRandom(tips, null, () => 0)?.id).toBe('a');
  });

  it('with a real random source, many presses show every tip and never the same one twice in a row', () => {
    let previous: string | null = null;
    const seen = new Set<string>();
    for (let n = 0; n < 200; n++) {
      const tip: Nudge = pickRandom(tips, previous)!;
      expect(tip.id).not.toBe(previous);
      seen.add(tip.id);
      previous = tip.id;
    }
    expect(seen.size).toBe(3);
  });
});
