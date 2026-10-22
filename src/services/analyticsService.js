import { ValidationError } from '../errors.js';
import { fromCents, isValidMonth, monthRange } from '../validation.js';

export const WARNING_THRESHOLD_PERCENT = 80;
const TOP_CATEGORY_COUNT = 3;

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

  /** Summary for a YYYY-MM month; defaults to the current month. */
  function getMonthlySummary(month = toMonth(now())) {
    if (!isValidMonth(month)) {
      throw new ValidationError([{ field: 'month', message: 'Month must be in YYYY-MM format' }]);
    }

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

  return { getMonthlySummary };
}
