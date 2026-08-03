import { demoCandles, defaultSetups, retiredSetups, retiredSetupIds } from '@/constants/seed';
import { evaluateSetupRules } from '@/lib/rules';
import { levelsForSetup } from '@/lib/setupLevels';

const ACTIVE_NEW_IDS = [
  'setup-prior-day-high',
  'setup-ema-stack',
  'setup-dryup-thrust',
  'setup-mean-reclaim',
  'setup-earnings-momentum',
  'setup-bull-flag',
  'setup-atr-expansion',
];

describe('playbook setup roster', () => {
  it('keeps stronger setups active and preserves retired code', () => {
    for (const id of ACTIVE_NEW_IDS) {
      expect(defaultSetups.find((s) => s.id === id)).toBeTruthy();
    }
    expect(retiredSetups.length).toBeGreaterThan(0);
    expect(retiredSetupIds.has('setup-trend-pullback-active')).toBe(true);
    expect(defaultSetups.find((s) => s.id === 'setup-trend-pullback-active')).toBeFalsy();
  });

  it('evaluates active setups without throwing on demo candles', () => {
    for (const setup of defaultSetups) {
      const levels = levelsForSetup(setup, demoCandles.AAPL);
      const results = evaluateSetupRules(setup, {
        item: {
          id: 't',
          symbol: 'AAPL',
          thesis: 'test',
          ...levels,
          setupId: setup.id,
          notes: '',
          createdAt: '',
        },
        quote: null,
        candles: demoCandles.AAPL,
        spyCandles: demoCandles.SPY,
        qqqCandles: demoCandles.QQQ,
        news: [],
        earningsDates: ['2026-07-20'],
        asOfTime: demoCandles.AAPL[demoCandles.AAPL.length - 1].time,
        session: {
          phase: 'rth',
          label: 'RTH',
          tradable: true,
          detail: 'ok',
        },
        gates: {
          marketRegime: false,
          earningsBlackout: false,
          weeklyTrend: false,
          sectorRs: false,
          volatility: false,
        },
      });
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((r) => ['pass', 'fail', 'unknown'].includes(r.verdict))).toBe(true);
    }
  });
});
