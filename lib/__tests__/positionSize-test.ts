import { calculatePositionSize, rewardToRisk } from '@/lib/positionSize';

describe('calculatePositionSize', () => {
  it('sizes shares from account risk and stop distance', () => {
    const result = calculatePositionSize({
      accountSize: 25000,
      riskPercent: 1,
      entry: 100,
      stop: 95,
    });

    expect(result.valid).toBe(true);
    expect(result.riskAmount).toBe(250);
    expect(result.riskPerShare).toBe(5);
    expect(result.shares).toBe(50);
    expect(result.positionValue).toBe(5000);
  });

  it('rejects equal entry and stop', () => {
    const result = calculatePositionSize({
      accountSize: 10000,
      riskPercent: 1,
      entry: 50,
      stop: 50,
    });
    expect(result.valid).toBe(false);
  });
});

describe('rewardToRisk', () => {
  it('computes R multiple', () => {
    expect(rewardToRisk(100, 95, 110)).toBe(2);
  });
});
