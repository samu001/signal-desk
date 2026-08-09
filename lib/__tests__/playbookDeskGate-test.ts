import { demoCandles, defaultSetups } from '@/constants/seed';
import { runBacktest } from '@/lib/backtest';
import { collectDeskAllowSignalTimes } from '@/lib/deskBacktest';
import { runCombinedPlaybookBacktest } from '@/lib/playbookCombined';

describe('Playbook + Desk Soft/Strong gate', () => {
  const setup = defaultSetups.find((s) => s.id === 'setup-prior-day-high')!;
  const candles = demoCandles.AAPL;
  const spy = demoCandles.SPY;

  it('collectDeskAllowSignalTimes returns signal-bar timestamps only', () => {
    const allowed = collectDeskAllowSignalTimes({
      symbol: 'AAPL',
      candles,
      spyCandles: spy,
      sourceLabel: 'demo',
      setups: defaultSetups,
      evalBars: candles.length,
    });
    // Every allow time must be an actual bar time (not a fill/next-open time).
    const barTimes = new Set(candles.map((c) => c.time));
    for (const t of allowed) {
      expect(barTimes.has(t)).toBe(true);
    }
  });

  it('empty allow set blocks every Playbook entry', () => {
    const open = runBacktest({
      setup,
      symbol: 'AAPL',
      candles,
      spyCandles: spy,
      sourceLabel: 'demo',
    });
    const gated = runBacktest({
      setup,
      symbol: 'AAPL',
      candles,
      spyCandles: spy,
      sourceLabel: 'demo',
      allowEntryAtSignalTime: () => false,
    });
    expect(gated.trades).toHaveLength(0);
    // Open path is unchanged (this is just a smoke that demo can fire).
    expect(open.notes.some((n) => /Desk Soft\/Strong gate/i.test(n))).toBe(false);
    expect(gated.notes.some((n) => /Desk Soft\/Strong gate/i.test(n))).toBe(true);
  });

  it('Desk gate never adds trades the ungated Playbook would not take', () => {
    const allowed = collectDeskAllowSignalTimes({
      symbol: 'AAPL',
      candles,
      spyCandles: spy,
      sourceLabel: 'demo',
      setups: defaultSetups,
      evalBars: candles.length,
    });
    const open = runCombinedPlaybookBacktest({
      symbol: 'AAPL',
      setups: defaultSetups.filter((s) => s.enabled !== false),
      candles,
      spyCandles: spy,
      sourceLabel: 'demo',
    });
    const gated = runCombinedPlaybookBacktest({
      symbol: 'AAPL',
      setups: defaultSetups.filter((s) => s.enabled !== false),
      candles,
      spyCandles: spy,
      sourceLabel: 'demo',
      allowEntryAtSignalTime: (t) => allowed.has(t),
    });
    expect(gated.trades.length).toBeLessThanOrEqual(open.trades.length);
    // Every gated fill's signal bar (prior bar) must be in the allow set —
    // entryTime is the next-bar open after the signal close.
    const byTime = new Map(candles.map((c, i) => [c.time, i]));
    for (const t of gated.trades) {
      const fillIdx = byTime.get(t.entryTime);
      expect(fillIdx).toBeGreaterThan(0);
      const signalTime = candles[fillIdx! - 1].time;
      expect(allowed.has(signalTime)).toBe(true);
    }
  });
});
