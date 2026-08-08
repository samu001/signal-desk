import { NewsItem } from '@/types/trading';

/**
 * Headline catalyst screen shared by Desk scoreNews and Playbook
 * no_negative_catalyst. Patterns are intentionally narrow to avoid
 * false hard-fails on phrases like "misses the point" or "record low".
 */

/** Severe red flags — one hit is enough to hard-fail Desk Avoid. */
const HARD_NEGATIVE =
  /\b(?:lawsuit|fraud|recall|bankrupt(?:cy)?|sec charges|cuts? guidance)\b/i;

/**
 * Softer caution headlines. Desk hard-fails only when ≥2 soft hits appear;
 * Playbook still treats any soft hit as a failed catalyst check.
 */
const SOFT_NEGATIVE =
  /\b(?:downgrade|plunge|crash|probe|investigation|(?:earnings?|revenue|sales|eps)\s+miss(?:es|ed)?|miss(?:es|ed)?\s+(?:estimates?|expectations?|eps|revenue|sales))\b/i;

/** Constructive catalysts — no bare "win" / "record" / "beat". */
const POSITIVE =
  /\b(?:upgrade|beats?\s+(?:estimates?|expectations?|eps|revenue|sales)|raises?\s+guidance|record\s+(?:high|revenue|profit|earnings|sales)|surge|partnership|approval|strong demand)\b/i;

export type CatalystMatch = {
  headline: string;
  severity: 'hard' | 'soft';
};

export function matchNegativeCatalysts(news: NewsItem[]): CatalystMatch[] {
  const out: CatalystMatch[] = [];
  for (const n of news) {
    const h = n.headline ?? '';
    if (HARD_NEGATIVE.test(h)) out.push({ headline: h, severity: 'hard' });
    else if (SOFT_NEGATIVE.test(h)) out.push({ headline: h, severity: 'soft' });
  }
  return out;
}

export function matchPositiveCatalysts(news: NewsItem[]): string[] {
  return news.filter((n) => POSITIVE.test(n.headline ?? '')).map((n) => n.headline);
}

/** Playbook gate: any hard or soft negative headline fails. */
export function hasNegativeCatalyst(news: NewsItem[]): boolean {
  return matchNegativeCatalysts(news).length > 0;
}

/**
 * Desk stance hard-fail: ≥1 hard hit, or ≥2 soft hits.
 * A lone soft headline lowers the news score but does not force Avoid.
 */
export function deskNewsHardFail(negatives: CatalystMatch[]): boolean {
  if (negatives.some((n) => n.severity === 'hard')) return true;
  return negatives.filter((n) => n.severity === 'soft').length >= 2;
}
