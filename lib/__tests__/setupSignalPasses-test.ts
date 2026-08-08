import { demoCandles, defaultSetups, defaultWatchlist, retiredSetups } from '@/constants/seed';
import { evaluateSetupRules, setupSignalPasses } from '@/lib/rules';
import { RuleResult } from '@/lib/rules';

describe('setupSignalPasses (fail closed)', () => {
  const session = {
    phase: 'rth' as const,
    label: 'RTH open',
    tradable: true,
    detail: 'ok',
  };

  it('blocks when the core check (entryChecks[0]) is unknown', () => {
    const setup = retiredSetups.find((s) => s.id === 'setup-earnings-momentum')!;
    expect(setup.entryChecks[0]).toBe('post_earnings_hold');
    const item = defaultWatchlist.find((w) => w.symbol === 'AAPL')!;
    // No earnings calendar → post_earnings_hold is unknown; remaining checks
    // can still look fine — without fail-closed this would degrade to momentum.
    const results = evaluateSetupRules(setup, {
      item,
      quote: null,
      candles: demoCandles.AAPL,
      spyCandles: demoCandles.SPY,
      news: [],
      earningsDates: [],
      gates: {
        marketRegime: false,
        earningsBlackout: false,
        weeklyTrend: false,
        sectorRs: false,
        volatility: false,
      },
      session,
    });
    expect(results.find((r) => r.id === 'post_earnings_hold')?.verdict).toBe('unknown');
    const { pass } = setupSignalPasses(setup, results, {
      skipCheckIds: ['session_tradable'],
    });
    expect(pass).toBe(false);
  });

  it('fails earnings_clear when the calendar fetch returned empty (fail closed)', () => {
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
      session,
    });
    expect(results.find((r) => r.id === 'earnings_clear')?.verdict).toBe('fail');
    expect(setupSignalPasses(setup, results).pass).toBe(false);
  });

  it('passes earnings_clear when status is ok with an empty near-term window', () => {
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
      earningsCalendarStatus: 'ok',
      session,
    });
    expect(results.find((r) => r.id === 'earnings_clear')?.verdict).toBe('pass');
  });

  it('allows a signal when core passes and earnings are clear', () => {
    const setup = defaultSetups.find((s) => s.id === 'setup-prior-day-high')!;
    const item = defaultWatchlist.find((w) => w.symbol === 'AAPL')!;
    const asOf = demoCandles.AAPL[demoCandles.AAPL.length - 1].time;
    // Far-future earnings date — outside ±1 day blackout.
    const results = evaluateSetupRules(setup, {
      item,
      quote: null,
      candles: demoCandles.AAPL,
      spyCandles: demoCandles.SPY,
      qqqCandles: demoCandles.QQQ,
      news: [],
      earningsDates: ['2099-01-01'],
      asOfTime: asOf,
      session,
    });
    expect(results.find((r) => r.id === 'earnings_clear')?.verdict).toBe('pass');
    // Core may or may not pass on demo bars — assert the helper doesn't
    // invent a block when earnings_clear and core are both known.
    const core = results.find((r) => r.id === setup.entryChecks[0]);
    expect(core?.verdict).not.toBe('unknown');
    const synthetic: RuleResult[] = results.map((r) =>
      r.id === setup.entryChecks[0] ? { ...r, verdict: 'pass' as const } : r
    );
    // Force other checks to pass so only the helper logic is under test.
    const forced = synthetic.map((r) =>
      r.verdict === 'fail' && r.id !== 'earnings_clear' ? { ...r, verdict: 'pass' as const } : r
    );
    expect(setupSignalPasses(setup, forced).pass).toBe(true);
  });
});
