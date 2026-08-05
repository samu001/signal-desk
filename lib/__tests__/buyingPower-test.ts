import {
  analyzeBuyingPower,
  buyingPowerNeedsWarning,
  scaleDollarsForBuyingPower,
} from '@/lib/buyingPower';

function ts(isoDate: string): number {
  return Math.floor(new Date(`${isoDate}T16:00:00.000Z`).getTime() / 1000);
}

describe('buying-power check (honesty audit #7)', () => {
  it('flags a single oversized trade vs account equity', () => {
    // $100k account, 1% risk, $1 risk/share → 1,000 shares × $200 = $200k notional
    const report = analyzeBuyingPower({
      trades: [
        {
          symbol: 'BIG',
          entryTime: ts('2024-01-02'),
          exitTime: ts('2024-01-03'),
          entry: 200,
          stop: 199,
        },
      ],
      accountSize: 100_000,
      riskPercent: 1, // Settings-style: 1 = 1%
    });
    expect(report.oversizeTrades).toBe(1);
    expect(report.peakNotional).toBeCloseTo(200_000, 0);
    expect(report.peakNotionalPct).toBeGreaterThan(1);
    expect(buyingPowerNeedsWarning(report)).toBe(true);
  });

  it('flags overlapping opens when peak notional exceeds account', () => {
    // Two concurrent $60k notionals on a $100k account
    const report = analyzeBuyingPower({
      trades: [
        {
          symbol: 'AAA',
          entryTime: ts('2024-01-02'),
          exitTime: ts('2024-01-10'),
          entry: 60,
          stop: 59, // risk $1 → 1,000 sh × $60 = $60k
        },
        {
          symbol: 'BBB',
          entryTime: ts('2024-01-03'),
          exitTime: ts('2024-01-10'),
          entry: 60,
          stop: 59,
        },
      ],
      accountSize: 100_000,
      riskPercent: 1,
    });
    expect(report.peakNotional).toBeCloseTo(120_000, 0);
    expect(report.peakPositions).toBe(2);
    expect(report.leverageDays).toBeGreaterThan(0);
    expect(buyingPowerNeedsWarning(report)).toBe(true);
  });

  it('passes when concurrent notionals fit in the account', () => {
    const report = analyzeBuyingPower({
      trades: [
        {
          symbol: 'AAA',
          entryTime: ts('2024-01-02'),
          exitTime: ts('2024-01-03'),
          entry: 50,
          stop: 49, // 1,000 sh × $50 = $50k
        },
        {
          symbol: 'BBB',
          entryTime: ts('2024-01-05'),
          exitTime: ts('2024-01-06'),
          entry: 50,
          stop: 49,
        },
      ],
      accountSize: 100_000,
      riskPercent: 1,
    });
    expect(report.peakNotional).toBeCloseTo(50_000, 0);
    expect(report.leverageDays).toBe(0);
    expect(report.oversizeTrades).toBe(0);
    expect(buyingPowerNeedsWarning(report)).toBe(false);
  });

  it('releases capital after exit day (same capacity occupancy model)', () => {
    const report = analyzeBuyingPower({
      trades: [
        {
          symbol: 'AAA',
          entryTime: ts('2024-01-02'),
          exitTime: ts('2024-01-03'),
          entry: 80,
          stop: 79,
        },
        {
          symbol: 'BBB',
          entryTime: ts('2024-01-04'),
          exitTime: ts('2024-01-05'),
          entry: 80,
          stop: 79,
        },
      ],
      accountSize: 100_000,
      riskPercent: 1,
    });
    // Each trade is $80k; sequential so peak is one position
    expect(report.peakNotional).toBeCloseTo(80_000, 0);
    expect(report.peakPositions).toBe(1);
    expect(buyingPowerNeedsWarning(report)).toBe(false);
  });

  it('scales dollars by 1/peakNotionalPct when the book needs leverage', () => {
    const report = analyzeBuyingPower({
      trades: [
        {
          symbol: 'BIG',
          entryTime: ts('2024-01-02'),
          exitTime: ts('2024-01-03'),
          entry: 200,
          stop: 199, // $200k notional on $100k account → 2×
        },
      ],
      accountSize: 100_000,
      riskPercent: 1,
    });
    // 10R at $1,000/R = $10,000 unconstrained → $5,000 fundable at 50% scale
    const dollars = scaleDollarsForBuyingPower({
      totalR: 10,
      riskPerTrade: 1_000,
      report,
    });
    expect(dollars.unconstrainedDollars).toBe(10_000);
    expect(dollars.scale).toBeCloseTo(0.5, 5);
    expect(dollars.scaledDollars).toBeCloseTo(5_000, 0);
    expect(dollars.scaled).toBe(true);
  });

  it('leaves dollars unchanged when peak notional fits the account', () => {
    const report = analyzeBuyingPower({
      trades: [
        {
          symbol: 'AAA',
          entryTime: ts('2024-01-02'),
          exitTime: ts('2024-01-03'),
          entry: 50,
          stop: 49,
        },
      ],
      accountSize: 100_000,
      riskPercent: 1,
    });
    const dollars = scaleDollarsForBuyingPower({
      totalR: 4.5,
      riskPerTrade: 1_000,
      report,
    });
    expect(dollars.scale).toBe(1);
    expect(dollars.scaledDollars).toBeCloseTo(4_500, 0);
    expect(dollars.scaled).toBe(false);
  });
});
