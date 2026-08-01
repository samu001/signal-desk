import { Setup, Trade } from '@/types/trading';

export type SetupExpectancy = {
  setupId: string;
  sampleSize: number;
  winRate: number | null;
  avgR: number | null;
  expectancyR: number | null;
  planFollowRate: number | null;
  score: number;
};

function tradeR(trade: Trade): number | null {
  if (trade.exitPrice == null) return null;
  const risk = Math.abs(trade.entry - trade.stop);
  if (risk <= 0) return null;
  return (trade.exitPrice - trade.entry) / risk;
}

export function computeSetupExpectancy(setups: Setup[], trades: Trade[]): SetupExpectancy[] {
  return setups.map((setup) => {
    const closed = trades.filter((t) => t.setupId === setup.id && t.status === 'closed');
    const rs = closed.map(tradeR).filter((r): r is number => r != null);
    const wins = rs.filter((r) => r > 0);
    const followed = closed.filter((t) => t.followedPlan != null);
    const avgR = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null;
    const winRate = rs.length ? wins.length / rs.length : null;
    const expectancyR = avgR;
    const planFollowRate = followed.length
      ? followed.filter((t) => t.followedPlan).length / followed.length
      : null;

    // Soft prior until enough samples: neutral 0 with small weight.
    const sampleSize = rs.length;
    const prior = 0;
    const blend = sampleSize === 0 ? prior : (avgR as number);
    const confidence = Math.min(1, sampleSize / 10);
    const score = blend * (0.4 + 0.6 * confidence) + (planFollowRate ?? 0.5) * 0.1;

    return {
      setupId: setup.id,
      sampleSize,
      winRate,
      avgR,
      expectancyR,
      planFollowRate,
      score,
    };
  });
}

export function expectancyMap(setups: Setup[], trades: Trade[]): Record<string, SetupExpectancy> {
  return Object.fromEntries(computeSetupExpectancy(setups, trades).map((e) => [e.setupId, e]));
}
