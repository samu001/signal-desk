import { defaultSetups } from '@/constants/seed';
import { computeSetupExpectancy } from '@/lib/expectancy';
import { Trade } from '@/types/trading';

function closedTrade(partial: Partial<Trade> & Pick<Trade, 'setupId' | 'entry' | 'stop' | 'exitPrice'>): Trade {
  return {
    id: partial.id ?? 't1',
    symbol: 'AAPL',
    setupId: partial.setupId,
    side: 'long',
    entry: partial.entry,
    stop: partial.stop,
    target: partial.target ?? partial.entry + 10,
    shares: 10,
    riskAmount: 100,
    checklist: [],
    notes: '',
    status: 'closed',
    followedPlan: partial.followedPlan ?? true,
    openedAt: new Date().toISOString(),
    closedAt: new Date().toISOString(),
    exitPrice: partial.exitPrice,
  };
}

describe('computeSetupExpectancy', () => {
  it('computes average R and win rate per setup', () => {
    const trades = [
      closedTrade({
        id: 'a',
        setupId: 'setup-trend-pullback',
        entry: 100,
        stop: 95,
        exitPrice: 110, // +2R
      }),
      closedTrade({
        id: 'b',
        setupId: 'setup-trend-pullback',
        entry: 100,
        stop: 95,
        exitPrice: 95, // -1R
      }),
    ];

    const [edge] = computeSetupExpectancy(defaultSetups, trades).filter(
      (e) => e.setupId === 'setup-trend-pullback'
    );
    expect(edge.sampleSize).toBe(2);
    expect(edge.winRate).toBe(0.5);
    expect(edge.avgR).toBeCloseTo(0.5, 5);
  });
});
