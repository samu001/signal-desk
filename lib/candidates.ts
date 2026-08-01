import { expectancyMap, SetupExpectancy } from '@/lib/expectancy';
import { lastCompletedCandle } from '@/lib/indicators';
import { evaluateSetupRules, RuleResult, scoreRuleResults } from '@/lib/rules';
import { getUsEquitySession, SessionInfo } from '@/lib/session';
import {
  Candle,
  NewsItem,
  Quote,
  Setup,
  Trade,
  WatchlistItem,
} from '@/types/trading';

export type CandidateStatus =
  | 'ready'
  | 'in_zone'
  | 'near_zone'
  | 'watching'
  | 'stop_threatened'
  | 'invalidated';

export type Candidate = {
  item: WatchlistItem;
  setup: Setup | null;
  quote: Quote | null;
  status: CandidateStatus;
  distanceToZonePct: number | null;
  label: string;
  rules: RuleResult[];
  passRate: number;
  readiness: number;
  expectancy: SetupExpectancy | null;
  closeInvalidated: boolean;
  stopThreatened: boolean;
};

function zoneStatus(
  item: WatchlistItem,
  price: number | null,
  completedClose: number | null
): {
  status: CandidateStatus;
  distanceToZonePct: number | null;
  label: string;
  closeInvalidated: boolean;
  stopThreatened: boolean;
} {
  if (price == null) {
    return {
      status: 'watching',
      distanceToZonePct: null,
      label: 'No quote yet',
      closeInvalidated: false,
      stopThreatened: false,
    };
  }

  const closeInvalidated = completedClose != null && completedClose <= item.stop;
  const stopThreatened = price <= item.stop && !closeInvalidated;

  if (closeInvalidated) {
    return {
      status: 'invalidated',
      distanceToZonePct: null,
      label: 'Close below stop — thesis invalidated',
      closeInvalidated,
      stopThreatened,
    };
  }

  if (stopThreatened) {
    return {
      status: 'stop_threatened',
      distanceToZonePct: null,
      label: 'Stop threatened (intraday) — wait for close',
      closeInvalidated,
      stopThreatened,
    };
  }

  if (price >= item.entryLow && price <= item.entryHigh) {
    return {
      status: 'in_zone',
      distanceToZonePct: 0,
      label: 'In buy zone',
      closeInvalidated,
      stopThreatened,
    };
  }

  const mid = (item.entryLow + item.entryHigh) / 2;
  const distance = ((price - mid) / mid) * 100;

  if (price > item.entryHigh && price <= item.entryHigh * 1.03) {
    return {
      status: 'near_zone',
      distanceToZonePct: distance,
      label: 'Just above zone',
      closeInvalidated,
      stopThreatened,
    };
  }

  if (price < item.entryLow && price >= item.entryLow * 0.97) {
    return {
      status: 'near_zone',
      distanceToZonePct: distance,
      label: 'Approaching zone',
      closeInvalidated,
      stopThreatened,
    };
  }

  return {
    status: 'watching',
    distanceToZonePct: distance,
    label: price > item.entryHigh ? 'Extended above zone' : 'Waiting for zone',
    closeInvalidated,
    stopThreatened,
  };
}

export function buildCandidates(
  watchlist: WatchlistItem[],
  setups: Setup[],
  quotes: Record<string, Quote>,
  options?: {
    candles?: Record<string, Candle[]>;
    news?: Record<string, NewsItem[]>;
    trades?: Trade[];
    session?: SessionInfo;
  }
): Candidate[] {
  const setupMap = Object.fromEntries(setups.map((s) => [s.id, s]));
  const candles = options?.candles ?? {};
  const news = options?.news ?? {};
  const trades = options?.trades ?? [];
  const session = options?.session ?? getUsEquitySession();
  const expectancies = expectancyMap(setups, trades);
  const spyCandles = candles.SPY ?? [];

  const useLatestClose =
    session.phase === 'afterhours' || session.phase === 'closed' || session.phase === 'weekend';

  return watchlist
    .map((item) => {
      const quote = quotes[item.symbol.toUpperCase()] ?? null;
      const symbolCandles = candles[item.symbol.toUpperCase()] ?? [];
      const completed = useLatestClose
        ? symbolCandles[symbolCandles.length - 1] ?? null
        : lastCompletedCandle(symbolCandles);
      const referenceClose = completed?.close ?? quote?.previousClose ?? null;
      const zone = zoneStatus(item, quote?.price ?? null, referenceClose);
      const setup = item.setupId ? setupMap[item.setupId] ?? null : null;
      const rules = evaluateSetupRules(setup, {
        item,
        quote,
        candles: symbolCandles,
        spyCandles,
        news: news[item.symbol.toUpperCase()] ?? [],
        session,
      });
      const scored = scoreRuleResults(rules);
      const expectancy = setup ? expectancies[setup.id] ?? null : null;

      // Promote to ready when in/near zone and rules mostly pass.
      let status = zone.status;
      let label = zone.label;
      if (
        (status === 'in_zone' || status === 'near_zone') &&
        scored.passRate >= 0.7 &&
        scored.failed === 0
      ) {
        status = 'ready';
        label = 'Ready — rules passing';
      } else if (status === 'in_zone' && scored.failed > 0) {
        label = `In zone · ${scored.failed} rule${scored.failed === 1 ? '' : 's'} failing`;
      }

      const zoneBoost =
        status === 'ready' ? 1 : status === 'in_zone' ? 0.85 : status === 'near_zone' ? 0.55 : status === 'watching' ? 0.2 : 0;
      const readiness =
        zoneBoost * 0.55 + scored.passRate * 0.35 + Math.max(0, expectancy?.score ?? 0) * 0.1;

      return {
        item,
        setup,
        quote,
        status,
        distanceToZonePct: zone.distanceToZonePct,
        label,
        rules,
        passRate: scored.passRate,
        readiness,
        expectancy,
        closeInvalidated: zone.closeInvalidated,
        stopThreatened: zone.stopThreatened,
      };
    })
    .sort((a, b) => {
      const rank: Record<CandidateStatus, number> = {
        ready: 0,
        in_zone: 1,
        near_zone: 2,
        watching: 3,
        stop_threatened: 4,
        invalidated: 5,
      };
      const byStatus = rank[a.status] - rank[b.status];
      if (byStatus !== 0) return byStatus;
      return b.readiness - a.readiness;
    });
}

export function actionableCandidates(candidates: Candidate[]): Candidate[] {
  return candidates.filter((c) => c.status === 'ready' || c.status === 'in_zone' || c.status === 'near_zone');
}
