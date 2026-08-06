/**
 * Probe Finnhub / FMP / Alpha Vantage earnings endpoints (raw HTTP).
 *
 *   $env:FINNHUB_API_KEY="..."
 *   $env:FMP_API_KEY="..."
 *   $env:ALPHA_VANTAGE_API_KEY="..."
 *   npx tsx scripts/probe-earnings.ts PATH
 *   npx tsx scripts/probe-earnings.ts AAPL 2024-01-01 2026-08-05
 *
 * Never prints API keys.
 */
const symbol = (process.argv[2] || 'PATH').toUpperCase();
const from = process.argv[3] || new Date(Date.now() - 800 * 86400000).toISOString().slice(0, 10);
const to = process.argv[4] || new Date().toISOString().slice(0, 10);

const finnhub = process.env.FINNHUB_API_KEY?.trim();
const fmp = process.env.FMP_API_KEY?.trim();
const av = process.env.ALPHA_VANTAGE_API_KEY?.trim();

function mask(k?: string) {
  if (!k) return 'missing';
  return `set (…${k.slice(-4)}, len=${k.length})`;
}

function summarize(text: string, max = 320): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max)}…` : one;
}

async function probe(
  name: string,
  key: string | undefined,
  url: string
): Promise<void> {
  if (!key) {
    console.log(`${name}: SKIP (no key in env)`);
    return;
  }
  try {
    const res = await fetch(url);
    const text = await res.text();
    let hint = '';
    if (res.status === 429 || /rate.?limit|Limit Reach|Thank you for using Alpha|API call frequency/i.test(text)) {
      hint = ' → RATE LIMIT';
    } else if (res.status === 401 || res.status === 403) {
      hint = ' → AUTH / PLAN';
    } else if (res.status === 402) {
      hint = ' → PAYMENT / PREMIUM';
    } else if (/Error Message|error/i.test(text) && !/"earningsCalendar"|quarterlyEarnings|"date"/i.test(text)) {
      hint = ' → ERROR PAYLOAD';
    } else if (res.ok) {
      // crude success signals used by the app
      if (
        /"earningsCalendar"\s*:\s*\[/.test(text) ||
        /"quarterlyEarnings"\s*:\s*\[/.test(text) ||
        /^\s*\[/.test(text) ||
        /reportDate/i.test(text)
      ) {
        hint = ' → LOOKS USABLE';
      } else if (/\[\s*\]/.test(text) || /"earningsCalendar"\s*:\s*\[\s*\]/.test(text)) {
        hint = ' → EMPTY';
      } else {
        hint = ' → OK HTTP (inspect body)';
      }
    }
    console.log(`${name}: HTTP ${res.status}${hint}`);
    console.log(`  ${summarize(text)}`);
  } catch (e) {
    console.log(`${name}: FETCH FAILED — ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function main() {
  console.log(`Probe earnings for ${symbol}  window ${from} … ${to}`);
  console.log(`Keys: Finnhub=${mask(finnhub)}  FMP=${mask(fmp)}  AV=${mask(av)}\n`);

  if (!finnhub && !fmp && !av) {
    console.error(
      'No keys in env. In PowerShell:\n' +
        '  $env:FINNHUB_API_KEY="your-finnhub"\n' +
        '  $env:FMP_API_KEY="your-fmp"\n' +
        '  $env:ALPHA_VANTAGE_API_KEY="your-av"\n' +
        '  npx tsx scripts/probe-earnings.ts PATH'
    );
    process.exit(1);
  }

  await probe(
    'Finnhub',
    finnhub,
    `https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(finnhub!)}`
  );
  await probe(
    'FMP',
    fmp,
    `https://financialmodelingprep.com/stable/earnings?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(fmp!)}`
  );
  await probe(
    'Alpha Vantage',
    av,
    `https://www.alphavantage.co/query?function=EARNINGS&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(av!)}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
