import { defaultSetups, demoCandles } from '@/constants/seed';
import { buildRecommendation } from '@/lib/recommend';
import { matchPlaybookSetups } from '@/lib/setupMatch';
import { Candle } from '@/types/trading';

const DAY = 86400;

/** Dead-quiet bars: ATR ~0, so the volatility band gate must fail. */
function quietBars(n: number, price = 100, start = 1_700_000_000): Candle[] {
  return Array.from({ length: n }, (_, i) => ({
    time: start + i * DAY,
    open: price,
    high: price,
    low: price,
    close: price,
    volume: 1_000_000,
  }));
}

const NO_GATES = {
  marketRegime: false,
  earningsBlackout: false,
  weeklyTrend: false,
  sectorRs: false,
  volatility: false,
};

describe('gate threading through the Desk confirmation chain', () => {
  it('matchPlaybookSetups applies an overridden volatility gate', () => {
    const bars = quietBars(70);
    const withGate = matchPlaybookSetups({
      symbol: 'TEST',
      setups: defaultSetups,
      quote: null,
      candles: bars,
      spyCandles: demoCandles.SPY,
      historicalMode: true,
      gates: { ...NO_GATES, volatility: true },
    });
    for (const match of withGate) {
      expect(match.failedChecks).toContain('Volatility band OK');
    }

    const withoutGate = matchPlaybookSetups({
      symbol: 'TEST',
      setups: defaultSetups,
      quote: null,
      candles: bars,
      spyCandles: demoCandles.SPY,
      historicalMode: true,
      gates: NO_GATES,
    });
    for (const match of withoutGate) {
      expect(match.failedChecks).not.toContain('Volatility band OK');
    }
  });

  it('buildRecommendation forwards gates into Playbook confirmation', () => {
    const bars = quietBars(70);
    const rec = buildRecommendation({
      symbol: 'TEST',
      quote: null,
      candles: bars,
      spyCandles: demoCandles.SPY,
      candleSource: 'yahoo',
      historicalMode: true,
      setups: defaultSetups,
      gates: { ...NO_GATES, volatility: true },
    });
    // Every setup fails the shared volatility gate → it surfaces as a blocker.
    expect(rec.matchedSetups).toHaveLength(0);
    expect(
      rec.playbookBlockers.some((b) => /volatility/i.test(b.label))
    ).toBe(true);
  });
});
