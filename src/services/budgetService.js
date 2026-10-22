import { NotFoundError, ValidationError } from '../errors.js';
import { fromCents, isPlainObject, parseId, toCents } from '../validation.js';

function toBudget(row) {
  return {
    categoryId: row.category_id,
    categoryName: row.category_name,
    monthlyLimit: fromCents(row.monthly_limit_cents),
    updatedAt: row.updated_at,
  };
}

export function createBudgetService(db, categoryService) {
  const SELECT_BUDGET = `
    SELECT b.category_id, c.name AS category_name, b.monthly_limit_cents, b.updated_at
    FROM budgets b
    JOIN categories c ON c.id = b.category_id`;

  const statements = {
    list: db.prepare(`${SELECT_BUDGET} ORDER BY c.id`),
    byCategory: db.prepare(`${SELECT_BUDGET} WHERE b.category_id = ?`),
    // One statement creates the budget or replaces the existing one (category_id is UNIQUE).
    upsert: db.prepare(`
      INSERT INTO budgets (category_id, monthly_limit_cents)
      VALUES (@categoryId, @limitCents)
      ON CONFLICT (category_id) DO UPDATE
      SET monthly_limit_cents = excluded.monthly_limit_cents, updated_at = datetime('now')`),
    remove: db.prepare('DELETE FROM budgets WHERE category_id = ?'),
  };

  /** The category comes from the URL, so a well-formed but unknown ID is a 404. */
  function requireCategory(value) {
    const categoryId = parseId(value);
    if (categoryId === null) {
      throw new ValidationError([{ field: 'categoryId', message: 'Category ID must be a positive integer' }]);
    }
    if (!categoryService.exists(categoryId)) {
      throw new NotFoundError(`Category ${categoryId} not found`);
    }
    return categoryId;
  }

  function list() {
    return statements.list.all().map(toBudget);
  }

  function set(categoryIdValue, body) {
    const categoryId = requireCategory(categoryIdValue);

    if (!isPlainObject(body)) {
      throw new ValidationError([{ field: 'body', message: 'Request body must be a JSON object' }]);
    }
    const limitCents = toCents(body.monthlyLimit);
    if (limitCents === null) {
      throw new ValidationError(
        [{ field: 'monthlyLimit', message: 'Monthly limit must be a positive number with at most 2 decimals, up to 1,000,000' }],
        'Invalid budget data',
      );
    }

    statements.upsert.run({ categoryId, limitCents });
    return toBudget(statements.byCategory.get(categoryId));
  }

  function remove(categoryIdValue) {
    const categoryId = requireCategory(categoryIdValue);
    const { changes } = statements.remove.run(categoryId);
    if (changes === 0) {
      throw new NotFoundError(`No budget is set for category ${categoryId}`);
    }
  }

  return { list, set, remove };
}
