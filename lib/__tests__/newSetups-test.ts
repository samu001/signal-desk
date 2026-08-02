import { demoCandles, defaultSetups } from '@/constants/seed';
import { evaluateSetupRules } from '@/lib/rules';
import { levelsForSetup } from '@/lib/setupLevels';

const NEW_IDS = [
  'setup-prior-day-high',
  'setup-ema-stack',
  'setup-rs-breakout',
  'setup-dryup-thrust',
  'setup-mean-reclaim',
];

describe('new playbook setups', () => {
  it('includes the five replacement candidates in defaults', () => {
    for (const id of NEW_IDS) {
      expect(defaultSetups.find((s) => s.id === id)).toBeTruthy();
    }
  });

  it('evaluates each new setup without throwing on demo candles', () => {
    for (const id of NEW_IDS) {
      const setup = defaultSetups.find((s) => s.id === id)!;
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
