import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import { MAX_CATEGORY_NAME_LENGTH, isPlainObject, normalizeCategoryName, parseId } from '../validation.js';

export function createCategoryService(db) {
  const WITH_EXPENSE_COUNT = `
    SELECT c.id, c.name, (SELECT COUNT(*) FROM expenses e WHERE e.category_id = c.id) AS expenseCount
    FROM categories c`;

  const statements = {
    list: db.prepare(`${WITH_EXPENSE_COUNT} ORDER BY c.id`),
    byId: db.prepare(`${WITH_EXPENSE_COUNT} WHERE c.id = ?`),
    exists: db.prepare('SELECT 1 FROM categories WHERE id = ?'),
    names: db.prepare('SELECT id, name FROM categories'),
    insert: db.prepare('INSERT INTO categories (name) VALUES (?)'),
    rename: db.prepare('UPDATE categories SET name = ? WHERE id = ?'),
    removeBudget: db.prepare('DELETE FROM budgets WHERE category_id = ?'),
    remove: db.prepare('DELETE FROM categories WHERE id = ?'),
  };

  // The category and its budget are deleted together or not at all.
  const removeWithBudget = db.transaction((id) => {
    statements.removeBudget.run(id);
    statements.remove.run(id);
  });

  function requireCategory(idValue) {
    const id = parseId(idValue);
    if (id === null) {
      throw new ValidationError([{ field: 'id', message: 'ID must be a positive integer' }]);
    }
    const category = statements.byId.get(id);
    if (!category) {
      throw new NotFoundError(`Category ${id} not found`);
    }
    return category;
  }

  function readName(body) {
    if (!isPlainObject(body)) {
      throw new ValidationError([{ field: 'body', message: 'Request body must be a JSON object' }]);
    }
    const name = normalizeCategoryName(body.name);
    if (name === null) {
      throw new ValidationError(
        [{ field: 'name', message: `Name is required and must be at most ${MAX_CATEGORY_NAME_LENGTH} characters` }],
        'Invalid category data',
      );
    }
    return name;
  }

  /** Names are compared ignoring upper/lower case in JavaScript, which also covers non-ASCII letters. */
  function assertUniqueName(name, exceptId = null) {
    const key = name.toLowerCase();
    const clash = statements.names.all().find((c) => c.id !== exceptId && c.name.toLowerCase() === key);
    if (clash) {
      throw new ConflictError(`A category named "${clash.name}" already exists`);
    }
  }

  return {
    /** All categories in creation order, each with the number of expenses that use it. */
    list() {
      return statements.list.all();
    },

    exists(id) {
      return statements.exists.get(id) !== undefined;
    },

    create(body) {
      const name = readName(body);
      assertUniqueName(name);
      const { lastInsertRowid } = statements.insert.run(name);
      return statements.byId.get(Number(lastInsertRowid));
    },

    rename(idValue, body) {
      const category = requireCategory(idValue);
      const name = readName(body);
      assertUniqueName(name, category.id);
      statements.rename.run(name, category.id);
      return statements.byId.get(category.id);
    },

    /** Deletes an unused category together with its budget; refuses while expenses still use it. */
    remove(idValue) {
      const category = requireCategory(idValue);
      const count = category.expenseCount;
      if (count > 0) {
        const noun = count === 1 ? 'expense' : 'expenses';
        throw new ConflictError(
          `Category "${category.name}" still has ${count} ${noun}. Move or delete ${count === 1 ? 'it' : 'them'} first.`,
        );
      }
      removeWithBudget(category.id);
    },
  };
}
