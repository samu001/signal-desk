import { defaultSetups, demoCandles } from '@/constants/seed';
import { formatLabReport, runParameterLab } from '@/lib/parameterLab';
import { Candle } from '@/types/trading';

const DAY = 24 * 60 * 60;

/** Deterministic PRNG so the study is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Regime = 'trend' | 'chop' | 'down' | 'volatile' | 'recovery';

function buildRegimeSeries(seed: number, regime: Regime, start: number, bars = 260): Candle[] {
  const rnd = mulberry32(seed);
  const now = 1_800_000_000;
  const out: Candle[] = [];
  let close = start;
  for (let i = 0; i < bars; i++) {
    let drift = 0;
    let vol = 0.012;
    if (regime === 'trend') drift = 0.0035;
    if (regime === 'down') drift = -0.0025;
    if (regime === 'volatile') {
      drift = 0.001;
      vol = 0.03;
    }
    if (regime === 'recovery') drift = i < 60 ? -0.004 : 0.005;
    if (regime === 'chop') drift = Math.sin(i / 9) * 0.002;
    const shock = (rnd() - 0.5) * 2 * vol;
    const open = close;
    close = Math.max(start * 0.2, close * (1 + drift + shock));
    out.push({
      time: now - (bars - i) * DAY,
      open,
      high: Math.max(open, close) * (1 + rnd() * vol),
      low: Math.min(open, close) * (1 - rnd() * vol),
      close,
      volume: 5_000_000 + Math.floor(rnd() * 20_000_000),
    });
  }
  return out;
}

it('STUDY: parameter lab across regimes', () => {
  const regimes: Regime[] = [
    'trend', 'trend', 'trend',
    'chop', 'chop',
    'down', 'down',
    'volatile', 'volatile',
    'recovery',
  ];
  const names = ['TRD1', 'TRD2', 'TRD3', 'CHP1', 'CHP2', 'DWN1', 'DWN2', 'VOL1', 'VOL2', 'REC1'];
  const tickers = regimes.map((regime, i) => ({
    symbol: names[i],
    candles: buildRegimeSeries(1000 + i * 77, regime, 40 + i * 13),
  }));

  const result = runParameterLab({
    setups: defaultSetups,
    tickers,
    spyCandles: demoCandles.SPY,
    qqqCandles: demoCandles.QQQ,
  });

  // eslint-disable-next-line no-console
  console.log('\n' + formatLabReport(result));
  expect(result.knobs.length).toBe(3);
});
