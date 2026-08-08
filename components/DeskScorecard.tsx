import { StyleSheet, Text, View } from 'react-native';

import { formatMoney, Pill } from '@/components/ui';
import { palette, spacing } from '@/constants/theme';
import { Recommendation, RecommendFactor, Stance } from '@/lib/recommend';

export function stanceTone(stance: Stance): 'good' | 'warn' | 'bad' | 'neutral' {
  if (stance === 'strong_buy') return 'good';
  if (stance === 'soft_buy') return 'warn';
  if (stance === 'avoid') return 'bad';
  return 'neutral';
}

function scoreTone(score: number): 'good' | 'warn' | 'bad' | 'neutral' {
  if (score >= 72) return 'good';
  if (score >= 55) return 'warn';
  if (score < 35) return 'bad';
  return 'neutral';
}

function toneColor(tone: 'good' | 'warn' | 'bad' | 'neutral'): string {
  if (tone === 'good') return palette.moss;
  if (tone === 'warn') return palette.warn;
  if (tone === 'bad') return palette.danger;
  return palette.muted;
}

function verdictTone(verdict: RecommendFactor['verdict']): 'good' | 'warn' | 'bad' | 'neutral' {
  if (verdict === 'pass') return 'good';
  if (verdict === 'fail') return 'bad';
  return 'neutral';
}

type GateRow = { label: string; met: boolean; detail: string };

function softGates(rec: Recommendation): GateRow[] {
  const playbook = rec.matchedSetups.length > 0;
  const zone = rec.inEntry || rec.nearEntry;
  return [
    {
      label: 'Playbook match',
      met: playbook,
      detail: playbook ? rec.bestSetupName ?? 'Matched' : 'None passing',
    },
    {
      label: 'Overall ≥ 55',
      met: rec.overallScore >= 55,
      detail: `${rec.overallScore}`,
    },
    {
      label: 'Technical ≥ 45',
      met: rec.technicalScore >= 45,
      detail: `${rec.technicalScore}`,
    },
    {
      label: 'Near / in zone',
      met: zone,
      detail: rec.inEntry ? 'In zone' : rec.nearEntry ? 'Near zone' : 'Outside zone',
    },
  ];
}

function strongGates(rec: Recommendation): GateRow[] {
  const playbook = rec.matchedSetups.length > 0;
  const zone = rec.inEntry || rec.nearEntry;
  const edge = rec.matchedSetups[0]?.expectancyScore ?? null;
  return [
    {
      label: 'Playbook match',
      met: playbook,
      detail: playbook ? rec.bestSetupName ?? 'Matched' : 'None passing',
    },
    {
      label: 'Overall ≥ 72',
      met: rec.overallScore >= 72,
      detail: `${rec.overallScore}`,
    },
    {
      label: 'Technical ≥ 65',
      met: rec.technicalScore >= 65,
      detail: `${rec.technicalScore}`,
    },
    {
      label: 'News ≥ 60',
      met: rec.newsScore >= 60,
      detail: `${rec.newsScore}`,
    },
    {
      label: 'Company ≥ 55',
      met: rec.fundamentalScore >= 55,
      detail: rec.fundamentals
        ? `${rec.fundamentalScore}`
        : `${rec.fundamentalScore} (no data — neutral)`,
    },
    {
      label: 'Near / in zone',
      met: zone,
      detail: rec.inEntry ? 'In zone' : rec.nearEntry ? 'Near zone' : 'Outside zone',
    },
    {
      label: 'Edge ≥ −0.05',
      met: edge == null ? false : edge >= -0.05,
      detail: edge == null ? 'n/a' : edge.toFixed(2),
    },
  ];
}

export function ScoreBar({
  label,
  score,
  threshold,
}: {
  label: string;
  score: number;
  /** Soft-buy style threshold mark (0–100). */
  threshold?: number;
}) {
  const clamped = Math.max(0, Math.min(100, score));
  const fillWidth = `${clamped}%` as `${number}%`;
  const tone = scoreTone(score);
  return (
    <View style={styles.barRow}>
      <View style={styles.barLabelCol}>
        <Text style={styles.barLabel}>{label}</Text>
        <Text style={[styles.barScore, { color: toneColor(tone) }]}>{Math.round(score)}</Text>
      </View>
      <View style={styles.barTrack}>
        <View
          style={[
            styles.barFill,
            { width: fillWidth, backgroundColor: toneColor(tone) },
          ]}
        />
        {threshold != null ? (
          <View
            style={[
              styles.barThreshold,
              { left: `${Math.max(0, Math.min(100, threshold))}%` as `${number}%` },
            ]}
          />
        ) : null}
      </View>
    </View>
  );
}

export function ScoreDial({ score, label }: { score: number; label: string }) {
  const tone = scoreTone(score);
  const color = toneColor(tone);
  return (
    <View style={styles.dialWrap}>
      <View style={[styles.dialOuter, { borderColor: color }]}>
        <Text style={[styles.dialScore, { color }]}>{Math.round(score)}</Text>
        <Text style={styles.dialSub}>/ 100</Text>
      </View>
      <Text style={styles.dialLabel}>{label}</Text>
    </View>
  );
}

/** Compact scorecard for Dashboard Desk expand. */
export function CompactDeskScorecard({ recommendation: rec }: { recommendation: Recommendation }) {
  if (rec.candleSource === 'none' || rec.label === 'No data') return null;

  const soft = softGates(rec);
  const softMet = soft.filter((g) => g.met).length;

  return (
    <View style={styles.compactCard}>
      <Text style={styles.eyebrow}>Why this stance</Text>
      <View style={styles.compactTop}>
        <ScoreDial score={rec.overallScore} label="Overall" />
        <View style={styles.compactBars}>
          <ScoreBar label="Technical" score={rec.technicalScore} threshold={45} />
          <ScoreBar label="Company" score={rec.fundamentalScore} threshold={55} />
          <ScoreBar label="News" score={rec.newsScore} threshold={60} />
        </View>
      </View>

      <View style={styles.compactMeta}>
        <Pill
          label={
            rec.inEntry ? 'In entry zone' : rec.nearEntry ? 'Near entry zone' : 'Outside entry zone'
          }
          tone={rec.inEntry ? 'good' : rec.nearEntry ? 'warn' : 'neutral'}
        />
        <Pill
          label={`Soft gates ${softMet}/${soft.length}`}
          tone={softMet === soft.length ? 'good' : softMet >= 2 ? 'warn' : 'neutral'}
        />
        <Pill label={`Confidence ${rec.confidence}%`} tone="neutral" />
      </View>

      <View style={styles.factorPeek}>
        {rec.factors.slice(0, 4).map((f) => (
          <FactorChip key={f.name} factor={f} />
        ))}
      </View>
    </View>
  );
}

function FactorChip({ factor }: { factor: RecommendFactor }) {
  const tone = verdictTone(factor.verdict);
  const mark = factor.verdict === 'pass' ? '✓' : factor.verdict === 'fail' ? '✕' : '·';
  return <Pill label={`${mark} ${factor.name}`} tone={tone} />;
}

export function FactorList({ factors }: { factors: RecommendFactor[] }) {
  return (
    <View style={styles.factorList}>
      {factors.map((f) => {
        const tone = verdictTone(f.verdict);
        return (
          <View
            key={f.name}
            style={[styles.factorRow, { borderLeftColor: toneColor(tone) }]}>
            <View style={styles.factorHead}>
              <Text style={styles.factorName}>{f.name}</Text>
              <Pill
                label={f.verdict === 'pass' ? 'Pass' : f.verdict === 'fail' ? 'Fail' : 'Unknown'}
                tone={tone}
              />
            </View>
            <Text style={styles.factorDetail}>{f.detail}</Text>
            <Text style={styles.factorPillar}>{f.pillar}</Text>
          </View>
        );
      })}
    </View>
  );
}

export function GatePanel({ recommendation: rec }: { recommendation: Recommendation }) {
  const soft = softGates(rec);
  const strong = strongGates(rec);
  return (
    <View style={styles.gateGrid}>
      <GateColumn title="Soft buy gates" rows={soft} accent={palette.warn} />
      <GateColumn title="Strong buy gates" rows={strong} accent={palette.moss} />
    </View>
  );
}

function GateColumn({
  title,
  rows,
  accent,
}: {
  title: string;
  rows: GateRow[];
  accent: string;
}) {
  const met = rows.filter((r) => r.met).length;
  return (
    <View style={styles.gateCol}>
      <View style={styles.gateHead}>
        <Text style={styles.gateTitle}>{title}</Text>
        <Text style={[styles.gateCount, { color: accent }]}>
          {met}/{rows.length}
        </Text>
      </View>
      <View style={styles.gateProgressTrack}>
        <View
          style={[
            styles.gateProgressFill,
            {
              width: `${rows.length ? (met / rows.length) * 100 : 0}%` as `${number}%`,
              backgroundColor: accent,
            },
          ]}
        />
      </View>
      {rows.map((row) => (
        <View key={row.label} style={styles.gateRow}>
          <View
            style={[
              styles.gateDot,
              row.met ? { backgroundColor: accent } : styles.gateDotEmpty,
            ]}
          />
          <View style={styles.gateTextCol}>
            <Text style={[styles.gateLabel, !row.met && styles.gateLabelMiss]}>{row.label}</Text>
            <Text style={styles.gateDetail}>{row.detail}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

/** Price vs buy zone / stop / target strip. */
export function ZoneStrip({ recommendation: rec }: { recommendation: Recommendation }) {
  const { entryLow, entryHigh, stop, target } = rec.levels;
  const price = rec.price;
  const lo = Math.min(stop, entryLow, price) * 0.98;
  const hi = Math.max(target, entryHigh, price) * 1.02;
  const span = hi - lo || 1;
  const pct = (v: number): `${number}%` =>
    `${Math.max(2, Math.min(98, ((v - lo) / span) * 100))}%`;
  const bandWidth = `${Math.max(4, ((entryHigh - entryLow) / span) * 100)}%` as `${number}%`;

  return (
    <View style={styles.zoneCard}>
      <Text style={styles.eyebrow}>Price vs levels</Text>
      <View style={styles.zoneTrack}>
        <View
          style={[
            styles.zoneBand,
            { left: pct(entryLow), width: bandWidth },
          ]}
        />
        <View style={[styles.zoneMark, styles.zoneStop, { left: pct(stop) }]} />
        <View style={[styles.zoneMark, styles.zoneTarget, { left: pct(target) }]} />
        <View style={[styles.zonePrice, { left: pct(price) }]} />
      </View>
      <View style={styles.zoneLegend}>
        <Text style={styles.zoneLegItem}>
          Stop {formatMoney(stop)}
        </Text>
        <Text style={styles.zoneLegItem}>
          Buy {formatMoney(entryLow)}–{formatMoney(entryHigh)}
        </Text>
        <Text style={styles.zoneLegItem}>Px {formatMoney(price)}</Text>
        <Text style={styles.zoneLegItem}>
          Target {formatMoney(target)}
        </Text>
      </View>
      <Text style={styles.zoneStatus}>
        {rec.inEntry
          ? 'Price is inside the buy zone'
          : rec.nearEntry
            ? 'Price is near the buy zone'
            : price > entryHigh
              ? 'Price is above the buy zone'
              : 'Price is waiting below the buy zone'}
      </Text>
    </View>
  );
}

export function RsMeter({ value }: { value: number | null }) {
  if (value == null) {
    return (
      <View style={styles.meterCard}>
        <Text style={styles.eyebrow}>20d relative strength vs SPY</Text>
        <Text style={styles.meterEmpty}>n/a</Text>
      </View>
    );
  }
  // Map roughly −15%…+15% into the bar; 50% = flat vs SPY.
  const clamped = Math.max(-15, Math.min(15, value));
  const left = `${((clamped + 15) / 30) * 100}%` as `${number}%`;
  const tone = value >= 2 ? 'good' : value <= -2 ? 'bad' : 'neutral';
  return (
    <View style={styles.meterCard}>
      <Text style={styles.eyebrow}>20d relative strength vs SPY</Text>
      <Text style={[styles.meterValue, { color: toneColor(tone) }]}>
        {value >= 0 ? '+' : ''}
        {value.toFixed(1)}%
      </Text>
      <View style={styles.meterTrack}>
        <View style={styles.meterMid} />
        <View style={[styles.meterThumb, { left, backgroundColor: toneColor(tone) }]} />
      </View>
      <View style={styles.meterEnds}>
        <Text style={styles.meterEnd}>Weaker</Text>
        <Text style={styles.meterEnd}>Stronger</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    color: palette.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  compactCard: {
    backgroundColor: palette.white,
    borderRadius: 10,
    padding: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: palette.line,
  },
  compactTop: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  compactBars: { flex: 1, gap: 8 },
  compactMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  factorPeek: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  dialWrap: { alignItems: 'center', gap: 6, minWidth: 88 },
  dialOuter: {
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.paper,
  },
  dialScore: {
    fontFamily: 'SpaceMono',
    fontSize: 26,
    fontWeight: '700',
    lineHeight: 30,
  },
  dialSub: { fontSize: 10, color: palette.muted, marginTop: -2 },
  dialLabel: { fontSize: 12, fontWeight: '600', color: palette.muted },
  barRow: { gap: 4 },
  barLabelCol: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  barLabel: { fontSize: 12, color: palette.muted, fontWeight: '600' },
  barScore: { fontFamily: 'SpaceMono', fontSize: 12, fontWeight: '700' },
  barTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: palette.mist,
    overflow: 'hidden',
    position: 'relative',
  },
  barFill: { height: '100%', borderRadius: 4 },
  barThreshold: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    marginLeft: -1,
    backgroundColor: palette.ink,
    opacity: 0.35,
  },
  factorList: { gap: 8 },
  factorRow: {
    backgroundColor: palette.white,
    borderRadius: 10,
    padding: 12,
    borderLeftWidth: 4,
    borderWidth: 1,
    borderColor: palette.line,
    gap: 4,
  },
  factorHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  factorName: { fontWeight: '700', color: palette.ink, flex: 1 },
  factorDetail: { color: palette.ink, lineHeight: 19, fontSize: 13 },
  factorPillar: {
    fontSize: 11,
    color: palette.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  gateGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  gateCol: {
    flexGrow: 1,
    flexBasis: '46%',
    minWidth: 150,
    backgroundColor: palette.white,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: palette.line,
    gap: 8,
  },
  gateHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  gateTitle: { fontWeight: '700', color: palette.ink, fontSize: 13 },
  gateCount: { fontFamily: 'SpaceMono', fontWeight: '700', fontSize: 13 },
  gateProgressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: palette.mist,
    overflow: 'hidden',
  },
  gateProgressFill: { height: '100%', borderRadius: 3 },
  gateRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  gateDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 4,
  },
  gateDotEmpty: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: palette.line,
  },
  gateTextCol: { flex: 1, gap: 1 },
  gateLabel: { fontSize: 13, color: palette.ink, fontWeight: '600' },
  gateLabelMiss: { color: palette.muted, fontWeight: '500' },
  gateDetail: { fontSize: 12, color: palette.muted, fontFamily: 'SpaceMono' },
  zoneCard: {
    backgroundColor: palette.white,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: palette.line,
    gap: 10,
  },
  zoneTrack: {
    height: 28,
    borderRadius: 8,
    backgroundColor: palette.mist,
    position: 'relative',
    overflow: 'hidden',
  },
  zoneBand: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    backgroundColor: palette.mossSoft,
    borderRadius: 4,
  },
  zoneMark: {
    position: 'absolute',
    top: 2,
    bottom: 2,
    width: 3,
    marginLeft: -1.5,
    borderRadius: 2,
  },
  zoneStop: { backgroundColor: palette.danger },
  zoneTarget: { backgroundColor: palette.leaf },
  zonePrice: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 4,
    marginLeft: -2,
    backgroundColor: palette.ink,
    borderRadius: 2,
  },
  zoneLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
  },
  zoneLegItem: {
    fontFamily: 'SpaceMono',
    fontSize: 11,
    color: palette.muted,
  },
  zoneStatus: { fontSize: 13, color: palette.ink, fontWeight: '600' },
  meterCard: {
    backgroundColor: palette.white,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: palette.line,
    gap: 8,
  },
  meterEmpty: { color: palette.muted },
  meterValue: {
    fontFamily: 'SpaceMono',
    fontSize: 22,
    fontWeight: '700',
  },
  meterTrack: {
    height: 10,
    borderRadius: 5,
    backgroundColor: palette.mist,
    position: 'relative',
  },
  meterMid: {
    position: 'absolute',
    left: '50%',
    top: 0,
    bottom: 0,
    width: 2,
    marginLeft: -1,
    backgroundColor: palette.line,
  },
  meterThumb: {
    position: 'absolute',
    top: -3,
    width: 16,
    height: 16,
    marginLeft: -8,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: palette.white,
  },
  meterEnds: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  meterEnd: { fontSize: 11, color: palette.muted },
});
