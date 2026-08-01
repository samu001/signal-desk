export type PositionSizeInput = {
  accountSize: number;
  riskPercent: number;
  entry: number;
  stop: number;
};

export type PositionSizeResult = {
  riskAmount: number;
  riskPerShare: number;
  shares: number;
  positionValue: number;
  valid: boolean;
  reason?: string;
};

export function calculatePositionSize(input: PositionSizeInput): PositionSizeResult {
  const { accountSize, riskPercent, entry, stop } = input;

  if (accountSize <= 0 || riskPercent <= 0) {
    return {
      riskAmount: 0,
      riskPerShare: 0,
      shares: 0,
      positionValue: 0,
      valid: false,
      reason: 'Set account size and risk % in Settings.',
    };
  }

  if (entry <= 0 || stop <= 0) {
    return {
      riskAmount: 0,
      riskPerShare: 0,
      shares: 0,
      positionValue: 0,
      valid: false,
      reason: 'Entry and stop must be positive.',
    };
  }

  const riskPerShare = Math.abs(entry - stop);
  if (riskPerShare <= 0) {
    return {
      riskAmount: 0,
      riskPerShare: 0,
      shares: 0,
      positionValue: 0,
      valid: false,
      reason: 'Stop must differ from entry.',
    };
  }

  const riskAmount = (accountSize * riskPercent) / 100;
  const shares = Math.floor(riskAmount / riskPerShare);
  const positionValue = shares * entry;

  if (shares <= 0) {
    return {
      riskAmount,
      riskPerShare,
      shares: 0,
      positionValue: 0,
      valid: false,
      reason: 'Risk per share is too wide for this account size.',
    };
  }

  return {
    riskAmount,
    riskPerShare,
    shares,
    positionValue,
    valid: true,
  };
}

export function rewardToRisk(entry: number, stop: number, target: number): number | null {
  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  if (risk <= 0) return null;
  return reward / risk;
}
