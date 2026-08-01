import { demoQuotes } from '@/constants/seed';
import { Quote } from '@/types/trading';

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

function fromDemo(symbol: string): Quote {
  const upper = symbol.toUpperCase();
  const demo = demoQuotes[upper] ?? {
    price: 100,
    change: 0,
    percentChange: 0,
    high: 101,
    low: 99,
    open: 100,
    previousClose: 100,
  };

  return {
    symbol: upper,
    ...demo,
    source: 'demo',
  };
}

export async function fetchQuote(symbol: string, apiKey?: string): Promise<Quote> {
  const upper = symbol.toUpperCase().trim();
  if (!apiKey) {
    return fromDemo(upper);
  }

  try {
    const url = `${FINNHUB_BASE}/quote?symbol=${encodeURIComponent(upper)}&token=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    if (!res.ok) {
      return fromDemo(upper);
    }

    const data = (await res.json()) as {
      c?: number;
      d?: number;
      dp?: number;
      h?: number;
      l?: number;
      o?: number;
      pc?: number;
    };

    if (!data.c || data.c <= 0) {
      return fromDemo(upper);
    }

    return {
      symbol: upper,
      price: data.c,
      change: data.d ?? 0,
      percentChange: data.dp ?? 0,
      high: data.h ?? data.c,
      low: data.l ?? data.c,
      open: data.o ?? data.c,
      previousClose: data.pc ?? data.c,
      source: 'finnhub',
    };
  } catch {
    return fromDemo(upper);
  }
}

export async function fetchQuotes(symbols: string[], apiKey?: string): Promise<Record<string, Quote>> {
  const unique = [...new Set(symbols.map((s) => s.toUpperCase().trim()).filter(Boolean))];
  const entries = await Promise.all(unique.map(async (symbol) => [symbol, await fetchQuote(symbol, apiKey)] as const));
  return Object.fromEntries(entries);
}
