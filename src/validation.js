// Shared input checks. Each function returns a normalized value, or null/false when the input is invalid,
// so callers can collect all field errors before responding.

export const MAX_AMOUNT_CENTS = 100_000_000; // 1,000,000.00
export const MAX_DESCRIPTION_LENGTH = 200;
export const MAX_CATEGORY_NAME_LENGTH = 40;
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

const AMOUNT_PATTERN = /^(\d{1,9})(?:\.(\d{1,2}))?$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const ID_PATTERN = /^[1-9]\d{0,15}$/;

/**
 * Converts a decimal amount such as 12.5 or "12.50" to integer cents (1250).
 * The text is parsed digit by digit, so no floating-point rounding is involved.
 * Returns null for non-positive, too large, non-numeric or more than 2-decimal values.
 */
export function toCents(value) {
  let text;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    text = String(value);
  } else if (typeof value === 'string') {
    text = value.trim();
  } else {
    return null;
  }

  const match = AMOUNT_PATTERN.exec(text);
  if (!match) return null;

  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return cents > 0 && cents <= MAX_AMOUNT_CENTS ? cents : null;
}

export function fromCents(cents) {
  return cents / 100;
}

/** True for a real calendar date in YYYY-MM-DD format, e.g. rejects 2026-02-30. */
export function isValidDate(value) {
  if (typeof value !== 'string') return false;
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;

  const [year, month, day] = match.slice(1).map(Number);
  if (year < MIN_YEAR || year > MAX_YEAR) return false;

  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** True for a month in YYYY-MM format, e.g. "2026-10". */
export function isValidMonth(value) {
  if (typeof value !== 'string') return false;
  const match = MONTH_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  return year >= MIN_YEAR && year <= MAX_YEAR;
}

/**
 * Returns the half-open date range [start, end) covering a YYYY-MM month,
 * e.g. "2026-12" → { start: "2026-12-01", end: "2027-01-01" }.
 * This is the single rule used everywhere to decide which month an expense belongs to.
 */
export function monthRange(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  const next = monthNumber === 12
    ? `${year + 1}-01`
    : `${year}-${String(monthNumber + 1).padStart(2, '0')}`;
  return { start: `${month}-01`, end: `${next}-01` };
}

/** Accepts a positive integer as a number or a digit string (e.g. from a URL); otherwise returns null. */
export function parseId(value) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === 'string' && ID_PATTERN.test(value)) {
    const id = Number(value);
    return Number.isSafeInteger(id) ? id : null;
  }
  return null;
}

/** Trims the description; returns null if it is not a string, empty, or too long. */
export function normalizeDescription(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length >= 1 && text.length <= MAX_DESCRIPTION_LENGTH ? text : null;
}

/** Trims and collapses inner spaces; returns null if not a string, empty, or too long. */
export function normalizeCategoryName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ');
  return name.length >= 1 && name.length <= MAX_CATEGORY_NAME_LENGTH ? name : null;
}

export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
