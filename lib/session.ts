export type SessionPhase = 'premarket' | 'rth' | 'afterhours' | 'closed' | 'weekend';

export type SessionInfo = {
  phase: SessionPhase;
  label: string;
  tradable: boolean;
  detail: string;
};

/** Approximate US equity session in America/New_York without extra deps. */
export function getUsEquitySession(now = new Date()): SessionInfo {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  const mins = hour * 60 + minute;

  if (weekday === 'Sat' || weekday === 'Sun') {
    return {
      phase: 'weekend',
      label: 'Weekend',
      tradable: false,
      detail: 'Cash session closed — use for planning only.',
    };
  }

  // Premarket 04:00–09:30, RTH 09:30–16:00, AH 16:00–20:00 ET
  if (mins >= 4 * 60 && mins < 9 * 60 + 30) {
    return {
      phase: 'premarket',
      label: 'Premarket',
      tradable: false,
      detail: 'Prefer waiting for the regular open unless your playbook allows it.',
    };
  }
  if (mins >= 9 * 60 + 30 && mins < 16 * 60) {
    const early = mins < 9 * 60 + 45;
    const late = mins >= 15 * 60 + 45;
    return {
      phase: 'rth',
      label: early ? 'RTH · opening window' : late ? 'RTH · closing window' : 'RTH open',
      tradable: !early && !late,
      detail: early
        ? 'First 15 minutes — higher noise; wait for structure unless planned.'
        : late
          ? 'Last 15 minutes — avoid fresh entries unless managing risk.'
          : 'Regular trading hours — default window for new entries.',
    };
  }
  if (mins >= 16 * 60 && mins < 20 * 60) {
    return {
      phase: 'afterhours',
      label: 'After hours',
      tradable: false,
      detail: 'Liquidity is thin — journal and plan, don’t chase.',
    };
  }

  return {
    phase: 'closed',
    label: 'Market closed',
    tradable: false,
    detail: 'Overnight — update bias and levels for the next session.',
  };
}
