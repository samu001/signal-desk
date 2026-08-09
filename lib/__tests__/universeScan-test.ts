import { defaultSetups, demoCandles } from '@/constants/seed';
import {
  historyDaysForPlaybookScan,
  liveEarningsWindow,
  minBarsForPlaybookScan,
  playbookNeeds52WeekHistory,
  SCAN_HISTORY_DAYS_52W,
  SCAN_HISTORY_DAYS_SHORT,
  scanUniverseAgainstPlaybook,
} from '@/lib/universeScan';
import { Setup } from '@/types/trading';

describe('universeScan helpers', () => {
  it('requests short history when 52w setup is off', () => {
    const setups = defaultSetups.filter((s) => !s.entryChecks.includes('near_52w_high'));
    expect(playbookNeeds52WeekHistory(setups)).toBe(false);
    expect(historyDaysForPlaybookScan(setups)).toBe(SCAN_HISTORY_DAYS_SHORT);
    expect(minBarsForPlaybookScan(setups)).toBe(60);
  });

  it('requests longer history when 52w pullback is enabled', () => {
    expect(playbookNeeds52WeekHistory(defaultSetups)).toBe(true);
    expect(historyDaysForPlaybookScan(defaultSetups)).toBe(SCAN_HISTORY_DAYS_52W);
    expect(minBarsForPlaybookScan(defaultSetups)).toBe(120);
  });

  it('builds a narrow live earnings window', () => {
    const { fromDate, toDate } = liveEarningsWindow(new Date('2026-08-09T12:00:00Z'));
    expect(fromDate).toBe('2026-07-26');
    expect(toDate).toBe('2026-08-23');
  });
});

describe('scanUniverseAgainstPlaybook', () => {
  it('returns playbook-only rows (no Desk Soft/Strong fields)', () => {
    const result = scanUniverseAgainstPlaybook({
      setups: defaultSetups,
      tickers: [
        {
          symbol: 'AAPL',
          candles: demoCandles.AAPL,
          earningsDates: [],
          earningsCalendarStatus: 'ok',
        },
      ],
      spyCandles: demoCandles.SPY,
      qqqCandles: demoCandles.QQQ,
      earningsBlackout: true,
      scannedAt: 1,
    });

    expect(result.setupsUsed.length).toBe(defaultSetups.length);
    expect(result.historyDays).toBe(SCAN_HISTORY_DAYS_52W);
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].symbol).toBe('AAPL');
    expect(result.rows[0].matches.length).toBe(defaultSetups.length);
    expect(result.matchedCount + result.unmatchedCount).toBe(1);
    expect(result.rows[0]).toEqual(
      expect.objectContaining({
        symbol: 'AAPL',
        matches: expect.any(Array),
        passed: expect.any(Array),
        topSetupId: result.rows[0].passed[0]?.setupId ?? null,
        topSetupName: result.rows[0].passed[0]?.setupName ?? null,
      })
    );
    expect(result.rows[0]).not.toHaveProperty('stance');
    expect(result.rows[0]).not.toHaveProperty('researchLabel');
  });

  it('can skip earnings gate to avoid needing calendars', () => {
    const flushOnly: Setup[] = defaultSetups.filter((s) => s.id === 'setup-flush-reversal');
    const withGate = scanUniverseAgainstPlaybook({
      setups: flushOnly,
      tickers: [{ symbol: 'AAPL', candles: demoCandles.AAPL }],
      spyCandles: demoCandles.SPY,
      qqqCandles: demoCandles.QQQ,
      earningsBlackout: true,
    });
    const withoutGate = scanUniverseAgainstPlaybook({
      setups: flushOnly,
      tickers: [{ symbol: 'AAPL', candles: demoCandles.AAPL }],
      spyCandles: demoCandles.SPY,
      qqqCandles: demoCandles.QQQ,
      earningsBlackout: false,
    });
    expect(withGate.earningsBlackout).toBe(true);
    expect(withoutGate.earningsBlackout).toBe(false);
    expect(withoutGate.rows[0].matches.length).toBe(1);
  });

  it('lists matched symbols before quiet ones', () => {
    const result = scanUniverseAgainstPlaybook({
      setups: defaultSetups,
      tickers: [
        { symbol: 'MSFT', candles: demoCandles.MSFT, earningsDates: [], earningsCalendarStatus: 'ok' },
        { symbol: 'AAPL', candles: demoCandles.AAPL, earningsDates: [], earningsCalendarStatus: 'ok' },
      ],
      spyCandles: demoCandles.SPY,
      qqqCandles: demoCandles.QQQ,
    });
    const symbolsInOrder = result.rows.map((r) => r.symbol);
    expect(symbolsInOrder.sort()).toEqual(['AAPL', 'MSFT']);
    const firstQuiet = result.rows.findIndex((r) => r.passed.length === 0);
    const lastMatch = result.rows.reduce(
      (acc, r, i) => (r.passed.length > 0 ? i : acc),
      -1
    );
    if (result.matchedCount > 0 && result.unmatchedCount > 0) {
      expect(lastMatch).toBeLessThan(firstQuiet);
    }
  });
});
