import { demoCandles, defaultSetups, defaultWatchlist, retiredSetups } from '@/constants/seed';
import { evaluateSetupRules, scoreRuleResults } from '@/lib/rules';

describe('evaluateSetupRules', () => {
  it('scores trend pullback checks against demo AAPL history', () => {
    // Retired setup kept for rule coverage (still evaluates the same checks).
    const setup = retiredSetups.find((s) => s.id === 'setup-trend-pullback')!;
    const item = defaultWatchlist.find((w) => w.symbol === 'AAPL')!;
    const results = evaluateSetupRules(setup, {
      item,
      quote: {
        symbol: 'AAPL',
        price: 208.4,
        change: 1,
        percentChange: 0.5,
        high: 209,
        low: 206,
        open: 207,
        previousClose: 207,
        source: 'demo',
      },
      candles: demoCandles.AAPL,
      spyCandles: demoCandles.SPY,
      news: [],
      session: {
        phase: 'rth',
        label: 'RTH open',
        tradable: true,
        detail: 'ok',
      },
    });

    const scored = scoreRuleResults(results);
    // Default live gates append earnings_clear only (regime gate is per-setup now).
    expect(results.length).toBe(setup.entryChecks.length + 1);
    expect(scored.passed).toBeGreaterThan(0);
    expect(results.find((r) => r.id === 'above_sma_50')?.verdict).toBe('pass');
    expect(results.find((r) => r.id === 'near_or_in_buy_zone')?.verdict).toBe('pass');
    expect(results.find((r) => r.id === 'market_regime_ok')).toBeUndefined();
    // Omitted calendar stays unknown; empty array (fetch returned nothing) fails closed.
    expect(results.find((r) => r.id === 'earnings_clear')?.verdict).toBe('unknown');
  });

  it('fails earnings_clear when the calendar fetch returned no dates', () => {
    const setup = defaultSetups.find((s) => s.id === 'setup-prior-day-high')!;
    const item = defaultWatchlist.find((w) => w.symbol === 'AAPL')!;
    const results = evaluateSetupRules(setup, {
      item,
      quote: null,
      candles: demoCandles.AAPL,
      spyCandles: demoCandles.SPY,
      qqqCandles: demoCandles.QQQ,
      news: [],
      earningsDates: [],
      session: {
        phase: 'rth',
        label: 'RTH open',
        tradable: true,
        detail: 'ok',
      },
    });
    expect(results.find((r) => r.id === 'earnings_clear')?.verdict).toBe('fail');
  });

  it('fails earnings_clear inside the blackout window', () => {
    const setup = defaultSetups.find((s) => s.id === 'setup-prior-day-high')!;
    const item = defaultWatchlist.find((w) => w.symbol === 'AAPL')!;
    const asOf = demoCandles.AAPL[demoCandles.AAPL.length - 1].time;
    const day = new Date(asOf * 1000).toISOString().slice(0, 10);
    const results = evaluateSetupRules(setup, {
      item,
      quote: null,
      candles: demoCandles.AAPL,
      spyCandles: demoCandles.SPY,
      qqqCandles: demoCandles.QQQ,
      news: [],
      earningsDates: [day],
      asOfTime: asOf,
      session: {
        phase: 'rth',
        label: 'RTH open',
        tradable: true,
        detail: 'ok',
      },
    });
    expect(results.find((r) => r.id === 'earnings_clear')?.verdict).toBe('fail');
  });

  it('fails negative catalyst when headlines match', () => {
    const setup = retiredSetups.find((s) => s.id === 'setup-breakout-hold')!;
    const item = defaultWatchlist.find((w) => w.symbol === 'NVDA')!;
    const results = evaluateSetupRules(setup, {
      item,
      quote: null,
      candles: demoCandles.NVDA,
      spyCandles: demoCandles.SPY,
      news: [
        {
          id: '1',
          headline: 'Analyst downgrade hits chip sector',
          datetime: Date.now() / 1000,
          source: 'test',
        },
      ],
      session: {
        phase: 'rth',
        label: 'RTH open',
        tradable: true,
        detail: 'ok',
      },
    });

    expect(results.find((r) => r.id === 'no_negative_catalyst')?.verdict).toBe('fail');
  });
});
