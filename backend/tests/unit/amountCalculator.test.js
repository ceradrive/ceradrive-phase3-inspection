/**
 * CERADRIVE ERP — Amount Calculator Unit Tests
 *
 * Tests ALR-01, ALR-02, ALR-03 calculation rules.
 * These are pure functions — no DB, no imports beyond the module under test.
 */

import { describe, it, expect } from 'vitest';
import {
  round4,
  calculateLineAmount,
  calculateTaxAmount,
  calculateLineTotal,
  calculateAllAmounts,
} from '../../src/utils/amountCalculator.js';

// ─── round4 ──────────────────────────────────────────────────────────────────

describe('round4', () => {
  it('rounds to 4 decimal places', () => {
    expect(round4(1.23456789)).toBe(1.2346);
  });

  it('handles exactly 4 decimal places unchanged', () => {
    expect(round4(1.2345)).toBe(1.2345);
  });

  it('handles integers', () => {
    expect(round4(100)).toBe(100);
  });

  it('handles zero', () => {
    expect(round4(0)).toBe(0);
  });

  it('handles NaN gracefully', () => {
    expect(round4(NaN)).toBe(0);
  });

  it('handles non-number gracefully', () => {
    expect(round4('abc')).toBe(0);
  });

  it('uses half-up rounding at 5th decimal', () => {
    expect(round4(1.00005)).toBe(1.0001);
    expect(round4(1.00004)).toBe(1.0000);
  });
});

// ─── calculateLineAmount (ALR-01) ─────────────────────────────────────────────

describe('calculateLineAmount — ALR-01', () => {
  it('calculates qty × unit_rate rounded to 4dp', () => {
    expect(calculateLineAmount(10, 250)).toBe(2500);
  });

  it('handles decimal qty and rate', () => {
    expect(calculateLineAmount(3.5, 100.75)).toBe(352.625);
  });

  it('rounds correctly at 4dp', () => {
    expect(calculateLineAmount(3, 33.3333)).toBe(99.9999);
  });

  it('returns 0 for zero rate (free-of-charge allowed)', () => {
    expect(calculateLineAmount(10, 0)).toBe(0);
  });

  it('handles non-number inputs gracefully', () => {
    expect(calculateLineAmount('x', 100)).toBe(0);
    expect(calculateLineAmount(10, null)).toBe(0);
  });
});

// ─── calculateTaxAmount (ALR-02) ──────────────────────────────────────────────

describe('calculateTaxAmount — ALR-02', () => {
  it('calculates tax at 18%', () => {
    expect(calculateTaxAmount(1000, 18)).toBe(180);
  });

  it('calculates tax at 5%', () => {
    expect(calculateTaxAmount(1000, 5)).toBe(50);
  });

  it('rounds to 4dp', () => {
    // 352.625 × 18 / 100 = 63.4725
    expect(calculateTaxAmount(352.625, 18)).toBe(63.4725);
  });

  it('returns 0 when taxPercent is null', () => {
    expect(calculateTaxAmount(1000, null)).toBe(0);
  });

  it('returns 0 when taxPercent is 0', () => {
    expect(calculateTaxAmount(1000, 0)).toBe(0);
  });

  it('returns 0 when taxPercent is undefined', () => {
    expect(calculateTaxAmount(1000, undefined)).toBe(0);
  });

  it('handles non-number lineAmount gracefully', () => {
    expect(calculateTaxAmount(null, 18)).toBe(0);
  });
});

// ─── calculateLineTotal (ALR-03) ──────────────────────────────────────────────

describe('calculateLineTotal — ALR-03', () => {
  it('sums lineAmount and taxAmount', () => {
    expect(calculateLineTotal(1000, 180)).toBe(1180);
  });

  it('handles zero tax (no-tax scenario)', () => {
    expect(calculateLineTotal(1000, 0)).toBe(1000);
  });

  it('handles decimal values', () => {
    expect(calculateLineTotal(352.625, 63.4725)).toBe(416.0975);
  });

  it('handles non-number inputs gracefully', () => {
    expect(calculateLineTotal(null, 100)).toBe(100);
    expect(calculateLineTotal(100, null)).toBe(100);
  });
});

// ─── calculateAllAmounts ──────────────────────────────────────────────────────

describe('calculateAllAmounts', () => {
  it('returns all three values in one call (18% tax)', () => {
    const result = calculateAllAmounts({ qty: 10, unitRate: 250, taxPercent: 18 });
    expect(result.lineAmount).toBe(2500);
    expect(result.taxAmount).toBe(450);
    expect(result.lineTotal).toBe(2950);
  });

  it('returns correct values with no tax', () => {
    const result = calculateAllAmounts({ qty: 5, unitRate: 100, taxPercent: null });
    expect(result.lineAmount).toBe(500);
    expect(result.taxAmount).toBe(0);
    expect(result.lineTotal).toBe(500);
  });

  it('consistency: lineTotal = lineAmount + taxAmount', () => {
    const result = calculateAllAmounts({ qty: 7, unitRate: 333.33, taxPercent: 5 });
    expect(result.lineTotal).toBe(result.lineAmount + result.taxAmount);
  });
});
