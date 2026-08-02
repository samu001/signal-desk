import AsyncStorage from '@react-native-async-storage/async-storage';

import { defaultSettings, defaultSetups, defaultWatchlist } from '@/constants/seed';
import { AppSettings, AppState, Setup, Trade, WatchlistItem } from '@/types/trading';

const STORAGE_KEY = 'personal_trading_guide_v1';

function migrateSetups(raw: Setup[] | undefined): Setup[] {
  if (!raw?.length) return defaultSetups;
  const defaultsById = Object.fromEntries(defaultSetups.map((s) => [s.id, s]));
  const merged = raw.map((setup) => {
    const fallback = defaultsById[setup.id];
    return {
      ...setup,
      entryChecks: setup.entryChecks?.length
        ? setup.entryChecks
        : fallback?.entryChecks ?? ['near_or_in_buy_zone', 'session_tradable'],
    };
  });
  const existingIds = new Set(merged.map((s) => s.id));
  for (const setup of defaultSetups) {
    if (!existingIds.has(setup.id)) merged.push(setup);
  }
  return merged;
}

export async function loadAppState(): Promise<AppState> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {
        settings: defaultSettings,
        setups: defaultSetups,
        watchlist: defaultWatchlist,
        trades: [],
      };
    }

    const parsed = JSON.parse(raw) as Partial<AppState>;
    return {
      settings: { ...defaultSettings, ...(parsed.settings ?? {}) },
      setups: migrateSetups(parsed.setups),
      watchlist: parsed.watchlist ?? defaultWatchlist,
      trades: parsed.trades ?? [],
    };
  } catch {
    return {
      settings: defaultSettings,
      setups: defaultSetups,
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
