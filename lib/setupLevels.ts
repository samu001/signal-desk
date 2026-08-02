import { closes, sma } from '@/lib/indicators';
import { Candle, Setup, WatchlistItem } from '@/types/trading';

/** Structure-based entry/stop/target for a playbook setup. */
export function levelsForSetup(
  setup: Setup,
  history: Candle[]
): Pick<WatchlistItem, 'entryLow' | 'entryHigh' | 'stop' | 'target'> {
  const price = history[history.length - 1].close;
  const window = history.slice(-12);
  const swingLow = Math.min(...window.map((c) => c.low));
  const swingHigh = Math.max(...window.map((c) => c.high));
  const sma20 = sma(closes(history), 20) ?? price;

  if (setup.id.includes('breakout') || setup.id.includes('momentum-gap')) {
    const level = setup.id.includes('momentum-gap')
      ? Math.max(price * 0.995, swingHigh * 0.98)
      : swingHigh;
    const stop = Math.min(swingLow, level * 0.97);
    const entry = Math.max(price, level * 0.99);
    const risk = Math.max(entry - stop, entry * 0.01);
    return {
      entryLow: level * 0.99,
      entryHigh: level * 1.04,
      stop,
      target: entry + 2 * risk,
    };
  }

  if (setup.id.includes('mean-reversion') || setup.id.includes('rsi-oversold')) {
    const stop = swingLow * 0.99;
    const risk = Math.max(price - stop, price * 0.01);
    return {
      entryLow: sma20 * 0.96,
      entryHigh: Math.max(sma20 * 1.01, price * 1.005),
      stop,
      target: Math.max(sma20, price + risk),
    };
  }

  if (setup.id.includes('ma-cross') || setup.id.includes('simple-trend')) {
    const stop = Math.min(swingLow, sma20 * 0.97);
    const risk = Math.max(price - stop, price * 0.012);
    return {
      entryLow: price * 0.99,
      entryHigh: price * 1.02,
      stop,
      target: price + 2 * risk,
    };
  }

  const stop = Math.min(swingLow, sma20 * 0.97);
  const risk = Math.max(price - stop, price * 0.01);
  return {
    entryLow: sma20 * 0.985,
    entryHigh: sma20 * 1.015,
    stop,
    target: price + 2 * risk,
  };
}
