import { ValidationError } from '../errors.js';
import { fromCents, isValidMonth, monthRange, parseId, shiftMonth } from '../validation.js';

export const WARNING_THRESHOLD_PERCENT = 80;
const TOP_CATEGORY_COUNT = 3;
export const DEFAULT_TREND_MONTHS = 6;
export const MAX_TREND_MONTHS = 24;

/** Percentage rounded to one decimal, computed from integer cents. */
function percent(part, whole) {
  return Math.round((part * 1000) / whole) / 10;
}

function budgetStatus(spentCents, limitCents) {
  if (limitCents === null) return 'no-budget';
  if (spentCents > limitCents) return 'over';
  if (spentCents * 100 >= limitCents * WARNING_THRESHOLD_PERCENT) return 'warning';
  return 'ok';
}

/** Formats a local date as YYYY-MM. */
function toMonth(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * @param {object} [options]
 * @param {() => Date} [options.now] clock used for the default month; replaceable in tests.
 */
export function createAnalyticsService(db, { now = () => new Date() } = {}) {
  // Spending per category for one month (half-open date range), joined with each category's budget.
  const categoryTotals = db.prepare(`
    SELECT c.id AS category_id,
           c.name,
           COALESCE(s.spent_cents, 0)   AS spent_cents,
           COALESCE(s.expense_count, 0) AS expense_count,
           b.monthly_limit_cents
    FROM categories c
    LEFT JOIN (
      SELECT category_id, SUM(amount_cents) AS spent_cents, COUNT(*) AS expense_count
      FROM expenses
      WHERE expense_date >= ? AND expense_date < ?
      GROUP BY category_id
    ) s ON s.category_id = c.id
    LEFT JOIN budgets b ON b.category_id = c.id
    ORDER BY c.id`);

  // Spending per month over a date range; months without expenses are filled in with zero afterwards.
  const monthTotals = db.prepare(`
    SELECT substr(expense_date, 1, 7) AS month, SUM(amount_cents) AS spent_cents, COUNT(*) AS expense_count
    FROM expenses
    WHERE expense_date >= ? AND expense_date < ?
    GROUP BY month`);

  const budgetTotal = db.prepare('SELECT SUM(monthly_limit_cents) AS cents FROM budgets');

  function requireMonth(month) {
    if (!isValidMonth(month)) {
      throw new ValidationError([{ field: 'month', message: 'Month must be in YYYY-MM format' }]);
    }
  }

  /** Summary for a YYYY-MM month; defaults to the current month. */
  function getMonthlySummary(month = toMonth(now())) {
    requireMonth(month);

    const { start, end } = monthRange(month);
    const rows = categoryTotals.all(start, end);

    const totalSpentCents = rows.reduce((sum, row) => sum + row.spent_cents, 0);
    const totalBudgetCents = rows.reduce((sum, row) => sum + (row.monthly_limit_cents ?? 0), 0);
    const expenseCount = rows.reduce((sum, row) => sum + row.expense_count, 0);

    // Only categories with spending or a budget are relevant for the dashboard.
    const categories = rows
      .filter((row) => row.spent_cents > 0 || row.monthly_limit_cents !== null)
      .map((row) => {
        const limit = row.monthly_limit_cents;
        return {
          categoryId: row.category_id,
          name: row.name,
          spent: fromCents(row.spent_cents),
          expenseCount: row.expense_count,
          budget: limit === null ? null : fromCents(limit),
          remaining: limit === null ? null : fromCents(limit - row.spent_cents),
          percentUsed: limit === null ? null : percent(row.spent_cents, limit),
          status: budgetStatus(row.spent_cents, limit),
          spentCents: row.spent_cents,
        };
      })
      .sort((a, b) => b.spentCents - a.spentCents || a.name.localeCompare(b.name));

    const topCategories = categories
      .filter((category) => category.spentCents > 0)
      .slice(0, TOP_CATEGORY_COUNT)
      .map((category) => ({
        categoryId: category.categoryId,
        name: category.name,
        spent: category.spent,
        sharePercent: percent(category.spentCents, totalSpentCents),
      }));

    return {
      month,
      totalSpent: fromCents(totalSpentCents),
      totalBudget: fromCents(totalBudgetCents),
      expenseCount,
      categories: categories.map(({ spentCents, ...category }) => category),
      topCategories,
    };
  }

  /**
   * Total spending for each of the `months` months up to and including `month` (oldest first),
   * using the same month rule as the summary. `monthlyBudget` is the sum of all current monthly budgets
   * (budgets apply to every month), or null when no budget is set.
   */
  function getTrend(month = toMonth(now()), months = DEFAULT_TREND_MONTHS) {
    requireMonth(month);
    const count = parseId(months);
    if (count === null || count > MAX_TREND_MONTHS) {
      throw new ValidationError([{ field: 'months', message: `Months must be a whole number from 1 to ${MAX_TREND_MONTHS}` }]);
    }

    const first = shiftMonth(month, -(count - 1));
    const totals = new Map(monthTotals.all(monthRange(first).start, monthRange(month).end).map((row) => [row.month, row]));
    const budgetCents = budgetTotal.get().cents;

    return {
      monthlyBudget: budgetCents === null ? null : fromCents(budgetCents),
      months: Array.from({ length: count }, (_, index) => {
        const key = shiftMonth(first, index);
        const row = totals.get(key);
        return { month: key, totalSpent: fromCents(row?.spent_cents ?? 0), expenseCount: row?.expense_count ?? 0 };
      }),
    };
  }

  return { getMonthlySummary, getTrend };
}
