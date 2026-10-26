import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidDate,
  isValidMonth,
  monthRange,
  normalizeCategoryName,
  normalizeDescription,
  parseId,
  shiftMonth,
  toCents,
} from '../src/validation.js';

describe('toCents', () => {
  it('converts valid numbers and numeric strings to integer cents', () => {
    assert.equal(toCents(12), 1200);
    assert.equal(toCents(12.5), 1250);
    assert.equal(toCents('12.50'), 1250);
    assert.equal(toCents(' 0.01 '), 1);
    assert.equal(toCents(19.99), 1999);
    assert.equal(toCents('1000000'), 100_000_000);
  });

  it('rejects zero, negative, too large and non-numeric values', () => {
    for (const value of [0, '0.00', -5, '-5', 1_000_000.01, 'abc', '', '12,50', '1e5', null, undefined, true, {}]) {
      assert.equal(toCents(value), null, `expected ${JSON.stringify(value)} to be rejected`);
    }
  });

  it('rejects more than two decimals and non-finite numbers', () => {
    assert.equal(toCents('12.345'), null);
    assert.equal(toCents(0.1 + 0.2), null);
    assert.equal(toCents(Number.NaN), null);
    assert.equal(toCents(Number.POSITIVE_INFINITY), null);
  });
});

describe('isValidDate', () => {
  it('accepts real calendar dates including leap days', () => {
    assert.equal(isValidDate('2026-10-22'), true);
    assert.equal(isValidDate('2024-02-29'), true);
    assert.equal(isValidDate('2026-12-31'), true);
  });

  it('rejects impossible dates, wrong formats and non-strings', () => {
    for (const value of ['2026-02-30', '2025-02-29', '2026-13-01', '2026-00-10', '2026-1-5', '22/10/2026',
      '2026-10-22T10:00', '1999-12-31', '', 20261022, null]) {
      assert.equal(isValidDate(value), false, `expected ${JSON.stringify(value)} to be rejected`);
    }
  });
});

describe('isValidMonth and monthRange', () => {
  it('validates YYYY-MM months', () => {
    assert.equal(isValidMonth('2026-10'), true);
    assert.equal(isValidMonth('2026-13'), false);
    assert.equal(isValidMonth('2026-1'), false);
    assert.equal(isValidMonth('2026-10-01'), false);
    assert.equal(isValidMonth(undefined), false);
  });

  it('returns a half-open range, rolling over at year end', () => {
    assert.deepEqual(monthRange('2026-10'), { start: '2026-10-01', end: '2026-11-01' });
    assert.deepEqual(monthRange('2026-12'), { start: '2026-12-01', end: '2027-01-01' });
  });

  it('shifts months forwards and backwards across year boundaries', () => {
    assert.equal(shiftMonth('2026-10', 0), '2026-10');
    assert.equal(shiftMonth('2026-10', -5), '2026-05');
    assert.equal(shiftMonth('2026-01', -1), '2025-12');
    assert.equal(shiftMonth('2026-12', 1), '2027-01');
    assert.equal(shiftMonth('2026-03', -27), '2023-12');
  });
});

describe('parseId', () => {
  it('accepts positive integers as numbers or digit strings', () => {
    assert.equal(parseId(7), 7);
    assert.equal(parseId('42'), 42);
  });

  it('rejects everything else', () => {
    for (const value of [0, -1, 1.5, '0', '01', '1.5', 'abc', '', '99999999999999999', null, undefined]) {
      assert.equal(parseId(value), null, `expected ${JSON.stringify(value)} to be rejected`);
    }
  });
});

describe('normalizeCategoryName', () => {
  it('trims and collapses inner whitespace', () => {
    assert.equal(normalizeCategoryName('  Pet \t  care  '), 'Pet care');
    assert.equal(normalizeCategoryName('x'.repeat(40)), 'x'.repeat(40));
  });

  it('rejects empty, too long and non-string values', () => {
    for (const value of ['', '  ', 'x'.repeat(41), 7, null]) {
      assert.equal(normalizeCategoryName(value), null, `expected ${JSON.stringify(value)} to be rejected`);
    }
  });
});

describe('normalizeDescription', () => {
  it('trims valid descriptions', () => {
    assert.equal(normalizeDescription('  Groceries  '), 'Groceries');
    assert.equal(normalizeDescription('x'.repeat(200)), 'x'.repeat(200));
  });

  it('rejects empty, whitespace-only, too long and non-string values', () => {
    assert.equal(normalizeDescription(''), null);
    assert.equal(normalizeDescription('   '), null);
    assert.equal(normalizeDescription('x'.repeat(201)), null);
    assert.equal(normalizeDescription(42), null);
  });
});
