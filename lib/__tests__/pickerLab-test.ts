import {
  applyPickerRule,
  bestSelectablePicker,
  comparePickerRules,
  interpretPickerLab,
  PickerTrade,
  relativeStrength20,
  walkForwardExpectancyScores,
} from '@/lib/pickerLab';
import { Candle } from '@/types/trading';

const DAY = 86400;
const T0 = 1_700_000_000;

function candles(closes: number[], startTime = T0): Candle[] {
  return closes.map((close, i) => ({
    time: startTime + i * DAY,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1000,
  }));
}

function trade(overrides: Partial<PickerTrade> & { entryDay: number; r: number }): PickerTrade {
  const entryTime = T0 + overrides.entryDay * DAY;
  return {
    symbol: 'AAA',
    entryTime,
    exitTime: entryTime + 5 * DAY,
    r: overrides.r,
    priorityScore: 1,
    setupId: 'setup-1',
    rs20: null,
    entry: 100,
    stop: 95,
    ...overrides,
  };
}

describe('relativeStrength20', () => {
  it('returns symbol 20-bar return minus benchmark 20-bar return at the prior close', () => {
    // Symbol +10% over 20 bars, benchmark +2% → RS ≈ 0.08.
    const sym = candles(Array.from({ length: 30 }, (_, i) => 100 * (1 + 0.005 * i)));
    const spy = candles(Array.from({ length: 30 }, (_, i) => 400 * (1 + 0.001 * i)));
    const entryTime = T0 + 25 * DAY;
    const rs = relativeStrength20(sym, spy, entryTime);
    expect(rs).not.toBeNull();
    // Entry fills at bar 25's open — the last knowable close is bar 24's.
    const symRet = sym[24].close / sym[4].close;
    const spyRet = spy[24].close / spy[4].close;
    expect(rs!).toBeCloseTo(symRet - spyRet, 10);
  });

  it('returns null when either series has fewer than 21 bars before entry', () => {
    const sym = candles(Array.from({ length: 10 }, () => 100));
    const spy = candles(Array.from({ length: 40 }, () => 400));
    expect(relativeStrength20(sym, spy, T0 + 9 * DAY)).toBeNull();
    expect(relativeStrength20(spy, sym, T0 + 9 * DAY)).toBeNull();
  });

  it('ignores bars after the entry time', () => {
    const flat = Array.from({ length: 25 }, () => 100);
    // Big spike AFTER entry must not affect RS at entry.
    const spiked = candles([...flat, 500, 500, 500]);
    const spy = candles(Array.from({ length: 30 }, () => 400));
    const entryTime = T0 + 24 * DAY;
    expect(relativeStrength20(spiked, spy, entryTime)).toBeCloseTo(0, 10);
  });

  it('REGRESSION: never reads the entry bar itself (fills happen at its open)', () => {
    // Flat history, then the entry day closes +50%. That day-one pop is the
    // trade's own result — if RS sees it, the picker is peeking at the future.
    const flat = Array.from({ length: 30 }, () => 100);
    const symBars = candles(flat);
    const entryIndex = 25;
    symBars[entryIndex] = { ...symBars[entryIndex], close: 150, high: 150 };
    const spy = candles(Array.from({ length: 30 }, () => 400));
    const entryTime = symBars[entryIndex].time;

    const rs = relativeStrength20(symBars, spy, entryTime);
    expect(rs).not.toBeNull();
    // Must be ~0 (flat vs flat). Would be ~+0.5 if the entry bar leaked in.
    expect(Math.abs(rs!)).toBeLessThan(1e-9);
  });

  it('REGRESSION: identical pre-entry history gives identical RS regardless of entry-day move', () => {
    const spy = candles(Array.from({ length: 30 }, () => 400));
    const base = Array.from({ length: 30 }, () => 100);
    const upDay = candles(base);
    const downDay = candles(base);
    upDay[25] = { ...upDay[25], close: 130, high: 130 };
    downDay[25] = { ...downDay[25], close: 70, low: 70 };
    const entryTime = upDay[25].time;

    expect(relativeStrength20(upDay, spy, entryTime)).toBe(
      relativeStrength20(downDay, spy, entryTime)
    );
  });
});

describe('walkForwardExpectancyScores', () => {
  it('only counts same-setup trades that closed before the entry (no lookahead)', () => {
    const early = [
      trade({ entryDay: 0, r: 2 }),
      trade({ entryDay: 1, r: 2 }),
      trade({ entryDay: 2, r: 2 }),
    ];
    // Closes day 45 — after `late` enters, so it must not count.
    const overlapping = trade({ entryDay: 40, r: -5 });
    const late = trade({ entryDay: 42, r: 0 });
    const otherSetup = trade({ entryDay: 3, r: -10, setupId: 'setup-2' });

    const scores = walkForwardExpectancyScores(
      [...early, overlapping, late, otherSetup],
      3
    );
    // late sees only the three early closed trades (avg +2R), not the -5R still open
    // and not the other setup's -10R.
    expect(scores.get(late)).toBeCloseTo(2, 10);
  });

  it('returns 0 when there are fewer than minSamples prior closed trades', () => {
    const a = trade({ entryDay: 0, r: 3 });
    const b = trade({ entryDay: 20, r: 1 });
    const scores = walkForwardExpectancyScores([a, b], 3);
    expect(scores.get(a)).toBe(0);
    expect(scores.get(b)).toBe(0);
  });
});

describe('interpretPickerLab', () => {
  const basePickers = (
    overrides: Partial<Record<'priority' | 'rs20' | 'expectancy' | 'random', number>> & {
      randomMax?: number;
      randomMin?: number;
    } = {}
  ) => [
    {
      id: 'priority' as const,
      label: 'Planned R:R + pass rate (Production)',
      description: '',
      trades: 10,
      skipped: 5,
      winRate: 0.5,
      totalR: overrides.priority ?? 1,
    },
    {
      id: 'rs20' as const,
      label: 'Relative strength',
      description: '',
      trades: 10,
      skipped: 5,
      winRate: 0.5,
      totalR: overrides.rs20 ?? 5,
    },
    {
      id: 'expectancy' as const,
      label: 'Setup expectancy',
      description: '',
      trades: 10,
      skipped: 5,
      winRate: 0.5,
      totalR: overrides.expectancy ?? 3,
    },
    {
      id: 'random' as const,
      label: 'Random',
      description: '',
      trades: 10,
      skipped: 5,
      winRate: 0.5,
      totalR: overrides.random ?? 2,
      randomSpread: {
        minR: overrides.randomMin ?? -5,
        maxR: overrides.randomMax ?? 8,
        seeds: 25,
      },
    },
  ];

  it('flags a negative All-signals universe as losing (ignore capped wins)', () => {
    const v = interpretPickerLab({
      pickers: basePickers({ rs20: 22 }),
      allSignalsTotalR: -5.1,
      allSignalsTrades: 500,
    });
    expect(v.tone).toBe('losing');
    expect(v.headline.toLowerCase()).toMatch(/losing/);
  });

  it('calls Best-inside-random-range noise even when All signals is positive', () => {
    const v = interpretPickerLab({
      pickers: basePickers({ rs20: 12, randomMax: 21 }),
      allSignalsTotalR: 16,
      allSignalsTrades: 500,
    });
    expect(v.tone).toBe('noise');
    expect(v.headline.toLowerCase()).toMatch(/noise/);
  });

  it('calls beating every random seed a possible edge (with confirmation caveat)', () => {
    const v = interpretPickerLab({
      pickers: basePickers({ rs20: 25, randomMax: 20 }),
      allSignalsTotalR: 16,
      allSignalsTrades: 500,
    });
    expect(v.tone).toBe('edge');
    expect(v.bullets.some((b) => /in-sample/i.test(b))).toBe(true);
  });
});

describe('applyPickerRule', () => {
  it('preserves setupId on taken trades (needed for setup attribution)', () => {
    const trades = [
      trade({ entryDay: 1, r: 1, setupId: 'setup-flush', priorityScore: 2 }),
      trade({ entryDay: 1, r: -1, setupId: 'setup-other', symbol: 'BBB', priorityScore: 1 }),
    ];
    const sim = applyPickerRule(trades, 'priority', 1);
    expect(sim.taken).toHaveLength(1);
    expect((sim.taken[0] as PickerTrade).setupId).toBe('setup-flush');
  });

  it('matches comparePickerRules totals for each ranking rule', () => {
    const winner = trade({ entryDay: 0, r: 3, symbol: 'WIN', priorityScore: 0.5, rs20: 0.2 });
    const loser = trade({ entryDay: 0, r: -1, symbol: 'LOSE', priorityScore: 5, rs20: -0.2 });
    const trades = [winner, loser];
    const compared = comparePickerRules(trades, 1, 3);
    for (const id of ['priority', 'rs20', 'expectancy'] as const) {
      const applied = applyPickerRule(trades, id, 1);
      const row = compared.find((r) => r.id === id)!;
      expect(applied.totalR).toBe(row.totalR);
      expect(applied.trades).toBe(row.trades);
      expect(applied.taken.length + applied.skippedTrades.length).toBe(2);
    }
  });

  it('random Active uses seed 1 and is deterministic', () => {
    const winner = trade({ entryDay: 0, r: 3, symbol: 'WIN', priorityScore: 0.5, rs20: 0.2 });
    const loser = trade({ entryDay: 0, r: -1, symbol: 'LOSE', priorityScore: 5, rs20: -0.2 });
    const trades = [winner, loser];
    const applied = applyPickerRule(trades, 'random', 1);
    expect(applied.taken.length + applied.skippedTrades.length).toBe(2);
    expect(applied.trades).toBe(1);
    expect(applyPickerRule(trades, 'random', 1).totalR).toBe(applied.totalR);
  });

  it('bestSelectablePicker ignores random even when random leads', () => {
    const pickers = [
      { id: 'priority' as const, label: 'p', description: '', trades: 1, skipped: 0, winRate: 0.5, totalR: 1 },
      { id: 'rs20' as const, label: 'r', description: '', trades: 1, skipped: 0, winRate: 0.5, totalR: 5 },
      { id: 'expectancy' as const, label: 'e', description: '', trades: 1, skipped: 0, winRate: 0.5, totalR: 2 },
      {
        id: 'random' as const,
        label: 'rnd',
        description: '',
        trades: 1,
        skipped: 0,
        winRate: 0.5,
        totalR: 99,
        randomSpread: { minR: 0, maxR: 99, seeds: 3 },
      },
    ];
    expect(bestSelectablePicker(pickers)).toBe('rs20');
  });
});

describe('comparePickerRules', () => {
  it('returns all four rules over the same trade universe', () => {
    const trades = [
      trade({ entryDay: 0, r: 1, symbol: 'AAA' }),
      trade({ entryDay: 0, r: -1, symbol: 'BBB' }),
      trade({ entryDay: 0, r: 2, symbol: 'CCC' }),
    ];
    const results = comparePickerRules(trades, 2, 5);
    expect(results.map((r) => r.id)).toEqual(['priority', 'rs20', 'expectancy', 'random']);
    for (const r of results) {
      expect(r.trades + r.skipped).toBe(trades.length);
    }
    const random = results.find((r) => r.id === 'random')!;
    expect(random.randomSpread).toEqual(
      expect.objectContaining({ seeds: 5 })
    );
  });

  it('a rule that ranks the winner higher captures it under a 1-slot cap', () => {
    // Same day, 1 slot: winner has high RS, loser has high current priority.
    const winner = trade({ entryDay: 0, r: 3, symbol: 'WIN', priorityScore: 0.5, rs20: 0.2 });
    const loser = trade({ entryDay: 0, r: -1, symbol: 'LOSE', priorityScore: 5, rs20: -0.2 });
    const results = comparePickerRules([winner, loser], 1, 3);

    const priority = results.find((r) => r.id === 'priority')!;
    const rs = results.find((r) => r.id === 'rs20')!;
    expect(priority.totalR).toBe(-1);
    expect(rs.totalR).toBe(3);
  });

  it('random baseline is deterministic across calls', () => {
    const trades = Array.from({ length: 12 }, (_, i) =>
      trade({
        entryDay: Math.floor(i / 3) * 2,
        r: i % 2 === 0 ? 1.5 : -1,
        symbol: `S${i}`,
      })
    );
    const a = comparePickerRules(trades, 2, 10).find((r) => r.id === 'random')!;
    const b = comparePickerRules(trades, 2, 10).find((r) => r.id === 'random')!;
    expect(a.totalR).toBe(b.totalR);
    expect(a.randomSpread).toEqual(b.randomSpread);
  });

  it('handles an empty trade list without NaN', () => {
    const results = comparePickerRules([], 3, 3);
    for (const r of results) {
      expect(r.trades).toBe(0);
      expect(r.totalR).toBe(0);
      expect(r.winRate).toBeNull();
    }
  });
});
