import { demoCandles } from '@/constants/seed';
import {
  assessEarningsGate,
  assessMarketRegime,
  isEarningsBlackout,
} from '@/lib/playbookGates';

describe('playbookGates', () => {
  it('marks risk-on when SPY is above rising MAs', () => {
    const regime = assessMarketRegime(demoCandles.SPY, demoCandles.QQQ);
    expect(regime.ok).toBe(true);
    expect(regime.label).toBe('Risk-on');
  });

  it('blocks risk-off when both benchmarks fail', () => {
    const down = demoCandles.SPY.map((c, i) => ({
      ...c,
      close: 600 - i * 2,
      high: 605 - i * 2,
      low: 595 - i * 2,
      open: 602 - i * 2,
    }));
    const regime = assessMarketRegime(down, down);
    expect(regime.ok).toBe(false);
    expect(regime.label).toBe('Risk-off');
  });

  it('applies ±1 day earnings blackout', () => {
    expect(isEarningsBlackout('2026-05-10', ['2026-05-10'])).toBe(true);
    expect(isEarningsBlackout('2026-05-09', ['2026-05-10'])).toBe(true);
    expect(isEarningsBlackout('2026-05-11', ['2026-05-10'])).toBe(true);
    expect(isEarningsBlackout('2026-05-12', ['2026-05-10'])).toBe(false);

    const gate = assessEarningsGate('2026-05-10', ['2026-05-10']);
    expect(gate.blocked).toBe(true);
    expect(gate.nearestDate).toBe('2026-05-10');
  });

  it('stays clear when no earnings dates are loaded', () => {
    expect(isEarningsBlackout('2026-05-10', [])).toBe(false);
    expect(assessEarningsGate('2026-05-10', undefined).blocked).toBe(false);
  });
});
