// CSV export of expenses (RFC 4180: comma-separated, CRLF line endings, quotes doubled inside quoted fields).

// Spreadsheet programs run text that starts with these characters as a formula ("CSV injection"),
// so such values get a leading apostrophe and are shown as plain text.
const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

// A byte-order mark makes Excel read the file as UTF-8, so "€" and non-Latin letters display correctly.
const BOM = '﻿';

export function csvField(value) {
  let text = String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Turns expenses as returned by the expense service into CSV text with a header row. */
export function expensesToCsv(expenses) {
  const rows = [
    ['Date', 'Description', 'Category', 'Amount (EUR)'],
    ...expenses.map((expense) => [expense.date, expense.description, expense.categoryName, expense.amount.toFixed(2)]),
  ];
  return `${BOM}${rows.map((row) => row.map(csvField).join(',')).join('\r\n')}\r\n`;
}
