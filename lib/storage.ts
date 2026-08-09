import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  defaultSettings,
  defaultSetups,
  defaultWatchlist,
  playbookCatalog,
  retiredSetupIds,
} from '@/constants/seed';
import { normalizeLiveBehavior } from '@/lib/liveBehavior';
import { AppSettings, AppState, Setup, Trade, WatchlistItem } from '@/types/trading';

const STORAGE_KEY = 'personal_trading_guide_v1';

/** Setups Desk / candidates / combined labs actually evaluate. */
export function enabledSetupsOf(setups: Setup[]): Setup[] {
  return setups.filter((s) => s.enabled !== false);
}

function migrateSetups(raw: Setup[] | undefined): Setup[] {
  const catalogById = Object.fromEntries(playbookCatalog.map((s) => [s.id, s]));
  const rawById = Object.fromEntries((raw ?? []).map((s) => [s.id, s]));

  const merged = playbookCatalog.map((catalogSetup) => {
    const existing = rawById[catalogSetup.id];
    if (!existing) return { ...catalogSetup };
    const enabled =
      typeof existing.enabled === 'boolean'
        ? existing.enabled
        : // Legacy rows: former actives stay on; formerly stripped retired default off.
          !retiredSetupIds.has(catalogSetup.id);
    return {
      ...catalogSetup,
      name: existing.name?.trim() ? existing.name : catalogSetup.name,
      summary: existing.summary ?? catalogSetup.summary,
      entryRules: existing.entryRules?.length ? existing.entryRules : catalogSetup.entryRules,
      exitRules: existing.exitRules?.length ? existing.exitRules : catalogSetup.exitRules,
      checklist: existing.checklist?.length ? existing.checklist : catalogSetup.checklist,
      entryChecks: existing.entryChecks?.length
        ? existing.entryChecks
        : catalogSetup.entryChecks,
      enabled,
    };
  });

  const catalogIds = new Set(playbookCatalog.map((s) => s.id));
  for (const setup of raw ?? []) {
    if (catalogIds.has(setup.id)) continue;
    merged.push({
      ...setup,
      entryChecks: setup.entryChecks?.length
        ? setup.entryChecks
        : ['near_or_in_buy_zone', 'session_tradable'],
      enabled: setup.enabled !== false,
    });
  }

  return merged.length ? merged : defaultSetups;
}

export async function loadAppState(): Promise<AppState> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {
        settings: defaultSettings,
        setups: playbookCatalog,
        watchlist: defaultWatchlist,
        trades: [],
      };
    }

    const parsed = JSON.parse(raw) as Partial<AppState>;
    return {
      settings: {
        ...defaultSettings,
        ...(parsed.settings ?? {}),
        // Legacy states lack liveBehavior (or carry partial shapes) — repair.
        liveBehavior: normalizeLiveBehavior(parsed.settings?.liveBehavior),
      },
      setups: migrateSetups(parsed.setups),
      watchlist: parsed.watchlist ?? defaultWatchlist,
      trades: parsed.trades ?? [],
    };
  } catch {
    return {
      settings: defaultSettings,
      setups: playbookCatalog,
      watchlist: defaultWatchlist,
      trades: [],
    };
  }
}

export async function saveAppState(state: AppState): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export type { AppSettings, Setup, Trade, WatchlistItem };
