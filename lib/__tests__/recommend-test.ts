import { defaultSetups, demoCandles, demoQuotes, getDemoFundamentals, getDemoNews } from '@/constants/seed';
import { buildRecommendation, clampLevelsRisk, computeTradeLevels } from '@/lib/recommend';
import { matchPlaybookSetups } from '@/lib/setupMatch';

describe('computeTradeLevels', () => {
  it('returns ordered entry/stop/target from fixture AAPL history', () => {
    const levels = computeTradeLevels(demoCandles.AAPL);
    expect(levels.entryLow).toBeLessThanOrEqual(levels.entryHigh);
    expect(levels.stop).toBeLessThan(levels.entryLow);
    expect(levels.target).toBeGreaterThan(levels.entryHigh);
  });
});

describe('clampLevelsRisk', () => {
  it('REGRESSION: MSFT gap-up — stale 12-bar swing low no longer produces a 22% stop / $742 target', () => {
    // Real numbers from the bug: price ~$487 after a 3-day +25% gap; swing low $377.
    const clamped = clampLevelsRisk(
      { entryLow: 486.73, entryHigh: 511.32, stop: 377.39, target: 742.3 },
      18 // plausible post-gap ATR14
    );
    const entryMid = (clamped.entryLow + clamped.entryHigh) / 2;
    const risk = entryMid - clamped.stop;
    // Risk capped at min(2.5×ATR = $45, 8% of entry ≈ $40)
    expect(risk).toBeLessThanOrEqual(entryMid * 0.081);
    expect(clamped.stop).toBeGreaterThan(440);
    // Target rebuilt from capped risk (~2R), nowhere near $742
    expect(clamped.target).toBeLessThan(600);
    expect(clamped.target).toBeGreaterThan(clamped.entryHigh);
    expect(clamped.stop).toBeLessThan(clamped.entryLow);
  });

  it('leaves already-sane levels essentially untouched', () => {
    // Raw risk $5.5 is inside the cap: min(2.5×ATR $7.5, 8% ≈ $8)
    const raw = { entryLow: 99, entryHigh: 102, stop: 95, target: 112 };
    const clamped = clampLevelsRisk(raw, 3);
    expect(clamped.entryLow).toBeCloseTo(99, 2);
    expect(clamped.entryHigh).toBeCloseTo(102, 2);
    expect(clamped.stop).toBeCloseTo(95, 2);
    expect(clamped.target).toBeCloseTo(112, 2);
  });

  it('keeps ordering valid when the raw stop is above the entry zone', () => {
    const clamped = clampLevelsRisk(
      { entryLow: 100, entryHigh: 104, stop: 103, target: 101 },
      1.5
    );
    expect(clamped.stop).toBeLessThan(clamped.entryLow);
    expect(clamped.target).toBeGreaterThan(clamped.entryHigh);
  });

  it('caps by percent when ATR is unavailable', () => {
    const clamped = clampLevelsRisk(
      { entryLow: 100, entryHigh: 100, stop: 60, target: 180 },
      null
    );
    expect(100 - clamped.stop).toBeLessThanOrEqual(8.01);
    expect(clamped.target).toBeLessThanOrEqual(100 + 2.5 * (100 - clamped.stop) + 0.01);
  });
});

describe('buildRecommendation', () => {
  const fixture = {
    quote: { symbol: 'AAPL', ...demoQuotes.AAPL, source: 'yahoo' as const },
    candles: demoCandles.AAPL,
    spyCandles: demoCandles.SPY,
    qqqCandles: demoCandles.QQQ,
    news: getDemoNews('AAPL'),
    fundamentals: getDemoFundamentals('AAPL'),
    candleSource: 'yahoo' as const,
  };

  it('returns No data when candleSource is demo or missing history', () => {
    const rec = buildRecommendation({
      symbol: 'AAPL',
      quote: fixture.quote,
      candles: fixture.candles,
      spyCandles: fixture.spyCandles,
      candleSource: 'demo',
      setups: defaultSetups,
    });
    expect(rec.label).toBe('No data');
    expect(rec.tradeable).toBe(false);
    expect(rec.candleSource).toBe('none');
  });

  it('can issue a buy only with Playbook confirmation on fixture AAPL', () => {
    const rec = buildRecommendation({
      symbol: 'AAPL',
      ...fixture,
      setups: defaultSetups,
    });

    expect(rec.levels.entryLow).toBeLessThanOrEqual(rec.levels.entryHigh);
    expect(rec.matchedSetups.length).toBeLessThanOrEqual(5);
    expect(rec.setupOptions.length).toBe(rec.matchedSetups.length);
    expect(rec.setupOptions.length).toBeLessThanOrEqual(5);
    expect(rec.technicalScore).toBeGreaterThan(50);
    expect(rec.reasons.length).toBeGreaterThan(0);
    if (rec.matchedSetups.length) {
      expect(['strong_buy', 'soft_buy', 'wait']).toContain(rec.stance);
      expect(rec.bestSetupName).toBeTruthy();
      expect(rec.setupOptions[0]?.setupName).toBe(rec.bestSetupName);
      for (const option of rec.setupOptions) {
        expect(option.levels.entryLow).toBeLessThanOrEqual(option.levels.entryHigh);
        expect(option.levels.stop).toBeLessThan(option.levels.entryLow);
        expect(option.levels.target).toBeGreaterThan(option.levels.entryHigh);
        expect(option.exitRules.length).toBeGreaterThan(0);
        expect(option.rank).toBeGreaterThan(0);
      }
    } else {
      expect(rec.stance).toBe('wait');
      expect(rec.setupOptions).toHaveLength(0);
      expect(rec.warnings.some((w) => /no playbook setup matched/i.test(w))).toBe(true);
    }
  });

  it('returns at most five setup options when many setups match', () => {
    const rec = buildRecommendation({
      symbol: 'AAPL',
      ...fixture,
      setups: defaultSetups,
    });
    expect(rec.setupOptions.length).toBeLessThanOrEqual(5);
    const ranks = rec.setupOptions.map((o) => o.rank);
    expect(ranks).toEqual(ranks.slice().sort((a, b) => a - b));
  });

  it('blocks Soft/Strong buy when no setups are provided', () => {
    const rec = buildRecommendation({
      symbol: 'AAPL',
      ...fixture,
      setups: [],
    });
    expect(['wait', 'avoid']).toContain(rec.stance);
    expect(rec.matchedSetups).toHaveLength(0);
  });

  it('returns avoid when severe negative catalyst headlines appear', () => {
    const rec = buildRecommendation({
      symbol: 'AAPL',
      ...fixture,
      news: [
        {
          id: 'bad',
          headline: 'Company faces SEC charges after fraud probe',
          datetime: Date.now() / 1000,
          source: 'Test',
        },
      ],
      setups: defaultSetups,
    });

    expect(rec.stance).toBe('avoid');
    expect(rec.newsScore).toBeLessThan(30);
    expect(rec.factors.find((f) => f.name === 'Catalyst screen')?.detail).toMatch(/Red flag:/i);
  });

  it('does not force Avoid on a lone soft caution headline', () => {
    const rec = buildRecommendation({
      symbol: 'AAPL',
      ...fixture,
      news: [
        {
          id: 'soft',
          headline: 'Analyst downgrade hits chip sector',
          datetime: Date.now() / 1000,
          source: 'Test',
        },
      ],
      setups: defaultSetups,
      earningsDates: [],
      earningsCalendarStatus: 'ok',
    });
    expect(rec.stance).not.toBe('avoid');
    expect(rec.newsScore).toBeGreaterThan(30);
    expect(rec.factors.find((f) => f.name === 'Catalyst screen')?.detail).toMatch(/Caution/i);
  });

  it('ignores false-positive catalyst phrases (misses the point / record low)', () => {
    const rec = buildRecommendation({
      symbol: 'AAPL',
      ...fixture,
      news: [
        {
          id: 'noise',
          headline: 'CEO misses the point as shares hit record low',
          datetime: Date.now() / 1000,
          source: 'Test',
        },
      ],
      setups: defaultSetups,
      earningsDates: [],
      earningsCalendarStatus: 'ok',
    });
    expect(rec.stance).not.toBe('avoid');
    expect(rec.factors.find((f) => f.name === 'Catalyst screen')?.verdict).toBe('pass');
  });

  it('labels levelsSource playbook when a setup option supplies primary levels', () => {
    const rec = buildRecommendation({
      symbol: 'AAPL',
      ...fixture,
      setups: defaultSetups,
      historicalMode: true,
      earningsDates: [],
      earningsCalendarStatus: 'ok',
    });
    if (rec.setupOptions.length) {
      expect(rec.levelsSource).toBe('playbook');
    }
  });

  it('waits when earnings are inside the blackout window', () => {
    const rec = buildRecommendation({
      symbol: 'AAPL',
      ...fixture,
      setups: defaultSetups,
      earnings: {
        date: '2026-08-03',
        daysUntil: 0,
        blocked: true,
        detail: 'Earnings 2026-08-03 is inside the ±1 day blackout',
      },
    });
    expect(rec.stance).toBe('wait');
    expect(rec.summary).toMatch(/earnings/i);
  });

  it('REGRESSION: verified-empty earnings window does not veto Playbook matches', () => {
    const base = {
      symbol: 'AAPL',
      setups: defaultSetups,
      quote: fixture.quote,
      candles: fixture.candles,
      spyCandles: fixture.spyCandles,
      qqqCandles: fixture.qqqCandles,
      historicalMode: true as const,
    };
    const blocked = matchPlaybookSetups({ ...base, earningsDates: [] });
    const clear = matchPlaybookSetups({
      ...base,
      earningsDates: [],
      earningsCalendarStatus: 'ok',
    });
    const softUnknown = matchPlaybookSetups(base);

    // Bare [] fail-closes earnings on every setup.
    expect(blocked.every((m) => m.failedChecks.some((c) => /earnings/i.test(c)))).toBe(true);
    expect(blocked.filter((m) => m.pass)).toHaveLength(0);

    // Verified-empty matches soft-unknown (live Desk must not invent a veto).
    expect(clear.filter((m) => m.pass).length).toBe(softUnknown.filter((m) => m.pass).length);
    expect(clear.every((m) => !m.failedChecks.some((c) => /earnings/i.test(c)))).toBe(true);

    // End-to-end stance path: fail-closed [] cannot Soft/Strong; ok+[] can if setups match.
    const blockedRec = buildRecommendation({
      symbol: 'AAPL',
      ...fixture,
      setups: defaultSetups,
      historicalMode: true,
      earningsDates: [],
    });
    expect(blockedRec.matchedSetups).toHaveLength(0);
    expect(['wait', 'avoid']).toContain(blockedRec.stance);
  });

  it('missing fundamentals score is pass-neutral for Strong gate (≥ 55)', () => {
    const rec = buildRecommendation({
      symbol: 'AAPL',
      ...fixture,
      fundamentals: null,
      setups: defaultSetups,
      earningsDates: [],
      earningsCalendarStatus: 'ok',
    });
    expect(rec.fundamentalScore).toBeGreaterThanOrEqual(55);
    expect(rec.factors.some((f) => f.name === 'Company data' && f.verdict === 'unknown')).toBe(
      true
    );
  });
});
