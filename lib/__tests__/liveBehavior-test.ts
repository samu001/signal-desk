import { demoCandles, demoQuotes, defaultSetups, getDemoFundamentals, getDemoNews } from '@/constants/seed';
import { DEFAULT_LIVE_GATES } from '@/lib/backtestProfile';
import {
  applyLiveExitTuning,
  committedPositionCount,
  DEFAULT_LIVE_BEHAVIOR,
  describeLiveBehavior,
  isDefaultLiveBehavior,
  normalizeLiveBehavior,
  stopCooldownStatus,
} from '@/lib/liveBehavior';
import { buildRecommendation } from '@/lib/recommend';
import { Trade } from '@/types/trading';

function makeTrade(patch: Partial<Trade>): Trade {
  return {
    id: 't-1',
    symbol: 'AAPL',
    setupId: null,
    side: 'long',
    entry: 100,
    stop: 95,
    target: 110,
    shares: 10,
    riskAmount: 50,
    checklist: [],
    notes: '',
    status: 'closed',
    followedPlan: null,
    openedAt: '2026-01-01T15:00:00.000Z',
    closedAt: '2026-01-10T20:00:00.000Z',
    exitPrice: 94,
    ...patch,
  };
}

describe('normalizeLiveBehavior', () => {
  it('returns production defaults for missing/legacy state', () => {
    const cfg = normalizeLiveBehavior(undefined);
    expect(cfg).toEqual(DEFAULT_LIVE_BEHAVIOR);
    expect(isDefaultLiveBehavior(cfg)).toBe(true);
  });

  it('repairs partial persisted shapes and clamps invalid numbers', () => {
    const cfg = normalizeLiveBehavior({
      entryEngine: 'playbook',
      gates: { marketRegime: true } as never,
      stopCooldownBars: -2,
      maxOpenPositions: 3.6,
      exitTuning: { targetR: 1.5, atrCapMult: 0, pctCap: -1 },
    });
    expect(cfg.entryEngine).toBe('playbook');
    expect(cfg.gates.marketRegime).toBe(true);
    // Missing gate keys fall back to live defaults.
    expect(cfg.gates.earningsBlackout).toBe(DEFAULT_LIVE_GATES.earningsBlackout);
    expect(cfg.stopCooldownBars).toBe(0);
    expect(cfg.maxOpenPositions).toBe(4);
    expect(cfg.exitTuning).toEqual({ targetR: 1.5 });
    expect(isDefaultLiveBehavior(cfg)).toBe(false);
  });

  it('rejects unknown entry engines', () => {
    const cfg = normalizeLiveBehavior({ entryEngine: 'yolo' as never });
    expect(cfg.entryEngine).toBe('playbook_desk');
  });
});

describe('describeLiveBehavior', () => {
  it('summarizes the default config', () => {
    const text = describeLiveBehavior(DEFAULT_LIVE_BEHAVIOR);
    expect(text).toMatch(/Playbook \+ Desk gate/);
    expect(text).toMatch(/earnings blackout/);
    expect(text).toMatch(/production exits/);
  });

  it('mentions cooldown, cap, and tuning when active', () => {
    const text = describeLiveBehavior(
      normalizeLiveBehavior({
        entryEngine: 'playbook',
        stopCooldownBars: 3,
        maxOpenPositions: 2,
        exitTuning: { targetR: 1.5, atrCapMult: 2, pctCap: 0.08 },
      })
    );
    expect(text).toMatch(/3-day stop cooldown/);
    expect(text).toMatch(/max 2 open/);
    expect(text).toMatch(/target 1.5R/);
  });
});

describe('stopCooldownStatus', () => {
  const day = 86_400;
  const exitSec = Date.parse('2026-01-10T20:00:00.000Z') / 1000;
  const barsAfter = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      time: exitSec + (i + 1) * day,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 1_000_000,
    }));

  it('is null when the cooldown is off or there is no stop-out', () => {
    expect(
      stopCooldownStatus({ symbol: 'AAPL', trades: [makeTrade({})], stopCooldownBars: 0 })
    ).toBeNull();
    // Winner exit (above stop) never starts a cooldown.
    expect(
      stopCooldownStatus({
        symbol: 'AAPL',
        trades: [makeTrade({ exitPrice: 109 })],
        stopCooldownBars: 3,
        now: Date.parse('2026-01-11T00:00:00.000Z'),
      })
    ).toBeNull();
  });

  it('blocks for N trading days after a stop-out, counted from daily bars', () => {
    const blocked = stopCooldownStatus({
      symbol: 'aapl',
      trades: [makeTrade({})],
      candles: barsAfter(1),
      stopCooldownBars: 3,
    });
    expect(blocked).not.toBeNull();
    expect(blocked!.barsRemaining).toBe(2);
    expect(blocked!.detail).toMatch(/2 trading days left/);

    const released = stopCooldownStatus({
      symbol: 'AAPL',
      trades: [makeTrade({})],
      candles: barsAfter(3),
      stopCooldownBars: 3,
    });
    expect(released).toBeNull();
  });

  it('falls back to calendar days without bars', () => {
    const blocked = stopCooldownStatus({
      symbol: 'AAPL',
      trades: [makeTrade({})],
      stopCooldownBars: 3,
      now: Date.parse('2026-01-11T20:00:00.000Z'),
    });
    expect(blocked?.barsRemaining).toBe(2);
    const released = stopCooldownStatus({
      symbol: 'AAPL',
      trades: [makeTrade({})],
      stopCooldownBars: 3,
      now: Date.parse('2026-01-14T20:00:00.000Z'),
    });
    expect(released).toBeNull();
  });
});

describe('applyLiveExitTuning', () => {
  const levels = { entryLow: 99, entryHigh: 101, stop: 90, target: 112 };

  it('is a no-op for production tuning', () => {
    expect(applyLiveExitTuning(levels, 3, undefined)).toEqual(levels);
    expect(applyLiveExitTuning(levels, 3, {})).toEqual(levels);
  });

  it('tightens the stop to the ATR cap and rewrites the target from tuned risk', () => {
    // entryMid 100, 2×ATR(3) → stop 94; 1.5R target → 100 + 1.5×6 = 109.
    const tuned = applyLiveExitTuning(levels, 3, { targetR: 1.5, atrCapMult: 2, pctCap: 0.08 });
    expect(tuned.stop).toBeCloseTo(94, 2);
    expect(tuned.target).toBeCloseTo(109, 2);
    expect(tuned.entryLow).toBe(levels.entryLow);
    expect(tuned.entryHigh).toBe(levels.entryHigh);
  });

  it('never loosens the stop or pushes it into the buy zone', () => {
    // Structural stop 98 is already tighter than 2.5×ATR — keep it.
    const tight = applyLiveExitTuning({ ...levels, stop: 98 }, 3, { atrCapMult: 2.5 });
    expect(tight.stop).toBeCloseTo(98, 2);
    // A huge pct cap would land the stop inside the zone — clamp under entryLow.
    const wide = applyLiveExitTuning(levels, 20, { pctCap: 0.005 });
    expect(wide.stop).toBeLessThan(levels.entryLow);
  });
});

describe('committedPositionCount', () => {
  it('counts open + planned, not closed', () => {
    expect(
      committedPositionCount([
        makeTrade({ status: 'open' }),
        makeTrade({ id: 't-2', status: 'planned' }),
        makeTrade({ id: 't-3', status: 'closed' }),
      ])
    ).toBe(2);
  });
});

describe('buildRecommendation with live behavior knobs', () => {
  const fixture = {
    symbol: 'AAPL',
    quote: { symbol: 'AAPL', ...demoQuotes.AAPL, source: 'yahoo' as const },
    candles: demoCandles.AAPL,
    spyCandles: demoCandles.SPY,
    qqqCandles: demoCandles.QQQ,
    news: getDemoNews('AAPL'),
    fundamentals: getDemoFundamentals('AAPL'),
    candleSource: 'yahoo' as const,
    setups: defaultSetups,
  };

  it('forces Wait while a stop cooldown is active', () => {
    const rec = buildRecommendation({
      ...fixture,
      stopCooldown: { barsRemaining: 2, detail: 'Stopped out 2026-01-10 — 2 trading days left' },
    });
    expect(rec.stance).toBe('wait');
    expect(rec.tradeable).toBe(false);
    expect(rec.summary).toMatch(/post-stop cooldown/i);
    expect(rec.factors.some((f) => f.name === 'Stop cooldown' && f.verdict === 'fail')).toBe(true);
  });

  it('Playbook engine issues Soft/Strong from rules alone when a setup matches', () => {
    const gated = buildRecommendation({ ...fixture });
    const rec = buildRecommendation({ ...fixture, entryEngine: 'playbook' });
    if (rec.matchedSetups.length) {
      expect(['soft_buy', 'strong_buy']).toContain(rec.stance);
      expect(rec.factors.some((f) => f.name === 'Entry engine')).toBe(true);
    } else {
      expect(rec.stance).toBe(gated.stance);
    }
  });

  it('earnings blackout gate off disables the stance-level earnings block', () => {
    const today = new Date().toISOString().slice(0, 10);
    const earnings = {
      date: today,
      daysUntil: 0,
      blocked: true,
      detail: 'Earnings today',
    };
    const blocked = buildRecommendation({ ...fixture, earnings });
    expect(blocked.stance).toBe('wait');
    expect(blocked.summary).toMatch(/earnings/i);

    const open = buildRecommendation({
      ...fixture,
      earnings,
      gates: { ...DEFAULT_LIVE_GATES, earningsBlackout: false },
    });
    expect(open.summary).not.toMatch(/too close to earnings/i);
  });

  it('exit tuning reshapes primary and per-option levels', () => {
    const prod = buildRecommendation({ ...fixture });
    const tuned = buildRecommendation({
      ...fixture,
      exitTuning: { targetR: 1.5, atrCapMult: 1.5, pctCap: 0.08 },
    });
    if (prod.matchedSetups.length) {
      expect(tuned.levels.stop).toBeGreaterThanOrEqual(prod.levels.stop);
      expect(tuned.factors.some((f) => f.name === 'Exit tuning')).toBe(true);
      for (const option of tuned.setupOptions) {
        expect(option.levels.stop).toBeLessThan(option.levels.entryLow);
        expect(option.levels.target).toBeGreaterThan(option.levels.entryHigh);
      }
    }
  });
});
