import { NotFoundError, ValidationError } from '../errors.js';
import {
  MAX_DESCRIPTION_LENGTH,
  fromCents,
  isPlainObject,
  isValidDate,
  isValidMonth,
  monthRange,
  normalizeDescription,
  parseId,
  toCents,
} from '../validation.js';

const SELECT_EXPENSE = `
  SELECT e.id, e.amount_cents, e.category_id, c.name AS category_name,
         e.expense_date, e.description, e.created_at, e.updated_at
  FROM expenses e
  JOIN categories c ON c.id = e.category_id`;

function toExpense(row) {
  return {
    id: row.id,
    amount: fromCents(row.amount_cents),
    categoryId: row.category_id,
    categoryName: row.category_name,
    date: row.expense_date,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function requireId(value) {
  const id = parseId(value);
  if (id === null) {
    throw new ValidationError([{ field: 'id', message: 'ID must be a positive integer' }]);
  }
  return id;
}

export function createExpenseService(db, categoryService) {
  const statements = {
    byId: db.prepare(`${SELECT_EXPENSE} WHERE e.id = ?`),
    insert: db.prepare(`
      INSERT INTO expenses (amount_cents, category_id, expense_date, description)
      VALUES (@amountCents, @categoryId, @date, @description)`),
    update: db.prepare(`
      UPDATE expenses
      SET amount_cents = @amountCents, category_id = @categoryId, expense_date = @date,
          description = @description, updated_at = datetime('now')
      WHERE id = @id`),
    remove: db.prepare('DELETE FROM expenses WHERE id = ?'),
  };

  /** Checks every field and reports all problems together. */
  function validateInput(body) {
    if (!isPlainObject(body)) {
      throw new ValidationError([{ field: 'body', message: 'Request body must be a JSON object' }]);
    }

    const errors = [];

    const amountCents = toCents(body.amount);
    if (amountCents === null) {
      errors.push({
        field: 'amount',
        message: 'Amount must be a positive number with at most 2 decimals, up to 1,000,000',
      });
    }

    const categoryId = parseId(body.categoryId);
    if (categoryId === null) {
      errors.push({ field: 'categoryId', message: 'Category ID must be a positive integer' });
    } else if (!categoryService.exists(categoryId)) {
      errors.push({ field: 'categoryId', message: 'Category does not exist' });
    }

    if (!isValidDate(body.date)) {
      errors.push({ field: 'date', message: 'Date must be a real calendar date in YYYY-MM-DD format' });
    }

    const description = normalizeDescription(body.description);
    if (description === null) {
      errors.push({
        field: 'description',
        message: `Description is required and must be at most ${MAX_DESCRIPTION_LENGTH} characters`,
      });
    }

    if (errors.length > 0) {
      throw new ValidationError(errors, 'Invalid expense data');
    }
    return { amountCents, categoryId, date: body.date, description };
  }

  function getById(idValue) {
    const id = requireId(idValue);
    const row = statements.byId.get(id);
    if (!row) {
      throw new NotFoundError(`Expense ${id} not found`);
    }
    return toExpense(row);
  }

  /** Lists expenses, newest first, optionally filtered by month (YYYY-MM) and category. */
  function list({ month, categoryId } = {}) {
    const conditions = [];
    const params = [];

    if (month !== undefined) {
      if (!isValidMonth(month)) {
        throw new ValidationError([{ field: 'month', message: 'Month must be in YYYY-MM format' }]);
      }
      const { start, end } = monthRange(month);
      conditions.push('e.expense_date >= ? AND e.expense_date < ?');
      params.push(start, end);
    }

    if (categoryId !== undefined) {
      const id = parseId(categoryId);
      if (id === null) {
        throw new ValidationError([{ field: 'categoryId', message: 'Category ID must be a positive integer' }]);
      }
      conditions.push('e.category_id = ?');
      params.push(id);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    return db
      .prepare(`${SELECT_EXPENSE} ${where} ORDER BY e.expense_date DESC, e.id DESC`)
      .all(...params)
      .map(toExpense);
  }

  function create(body) {
    const input = validateInput(body);
    const { lastInsertRowid } = statements.insert.run(input);
    return getById(Number(lastInsertRowid));
  }

  function update(idValue, body) {
    const id = requireId(idValue);
    const input = validateInput(body);
    const { changes } = statements.update.run({ ...input, id });
    if (changes === 0) {
      throw new NotFoundError(`Expense ${id} not found`);
    }
    return getById(id);
  }

  function remove(idValue) {
    const id = requireId(idValue);
    const { changes } = statements.remove.run(id);
    if (changes === 0) {
      throw new NotFoundError(`Expense ${id} not found`);
    }
  }

  return { list, getById, create, update, remove };
}
