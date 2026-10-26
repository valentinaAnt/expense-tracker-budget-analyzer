import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { csvField, expensesToCsv } from '../src/csv.js';

describe('csvField', () => {
  it('leaves plain text unchanged', () => {
    assert.equal(csvField('Weekly groceries'), 'Weekly groceries');
    assert.equal(csvField('12.50'), '12.50');
  });

  it('quotes text with commas, quotes or line breaks and doubles inner quotes', () => {
    assert.equal(csvField('Bread, milk'), '"Bread, milk"');
    assert.equal(csvField('The "best" pizza'), '"The ""best"" pizza"');
    assert.equal(csvField('Line 1\nLine 2'), '"Line 1\nLine 2"');
  });

  it('neutralises text that a spreadsheet would run as a formula', () => {
    assert.equal(csvField('=HYPERLINK("http://x")'), '"\'=HYPERLINK(""http://x"")"');
    assert.equal(csvField('+1'), "'+1");
    assert.equal(csvField('-5'), "'-5");
    assert.equal(csvField('@SUM(A1)'), "'@SUM(A1)");
  });
});

describe('expensesToCsv', () => {
  const expense = (date, description, categoryName, amount) => ({ date, description, categoryName, amount });

  it('writes a BOM, a header row and one CRLF-terminated row per expense', () => {
    const csv = expensesToCsv([
      expense('2026-10-12', 'Supermarket', 'Food', 54.15),
      expense('2026-10-04', 'Bread, milk', 'Food', 7),
    ]);
    assert.equal(csv,
      '﻿Date,Description,Category,Amount (EUR)\r\n'
      + '2026-10-12,Supermarket,Food,54.15\r\n'
      + '2026-10-04,"Bread, milk",Food,7.00\r\n');
  });

  it('writes only the header for an empty list', () => {
    assert.equal(expensesToCsv([]), '﻿Date,Description,Category,Amount (EUR)\r\n');
  });
});
