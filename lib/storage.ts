import AsyncStorage from '@react-native-async-storage/async-storage';

import { defaultSettings, defaultSetups, defaultWatchlist } from '@/constants/seed';
import { AppSettings, AppState, Setup, Trade, WatchlistItem } from '@/types/trading';

const STORAGE_KEY = 'personal_trading_guide_v1';

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
      setups: parsed.setups?.length ? parsed.setups : defaultSetups,
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
