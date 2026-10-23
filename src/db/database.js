import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const DEFAULT_CATEGORIES = Object.freeze([
  'Food',
  'Transport',
  'Housing',
  'Utilities',
  'Health',
  'Entertainment',
  'Shopping',
  'Education',
  'Other',
]);

// Every statement uses IF NOT EXISTS, so running the schema again is harmless.
// Money is stored as integer cents to avoid floating-point rounding errors.
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS categories (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
  );

  -- Safety net against duplicates that differ only in upper/lower case (ASCII); the service also
  -- checks non-ASCII names such as Cyrillic.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_name_nocase ON categories(name COLLATE NOCASE);

  CREATE TABLE IF NOT EXISTS expenses (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    category_id  INTEGER NOT NULL REFERENCES categories(id),
    expense_date TEXT    NOT NULL
                 CHECK (expense_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    description  TEXT    NOT NULL CHECK (length(description) BETWEEN 1 AND 200),
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_expenses_date     ON expenses(expense_date);
  CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category_id);

  CREATE TABLE IF NOT EXISTS budgets (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id         INTEGER NOT NULL UNIQUE REFERENCES categories(id),
    monthly_limit_cents INTEGER NOT NULL CHECK (monthly_limit_cents > 0),
    updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`;

/**
 * Opens (or creates) the SQLite database at filePath and makes sure the schema
 * and default categories exist. Safe to call repeatedly on the same file.
 */
export function openDatabase(filePath) {
  if (filePath !== ':memory:') {
    mkdirSync(dirname(filePath), { recursive: true });
  }

  const db = new Database(filePath);
  try {
    // SQLite does not enforce foreign keys unless enabled on every connection.
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    initializeSchema(db);
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}

function initializeSchema(db) {
  const initialize = db.transaction(() => {
    db.exec(SCHEMA);

    // The default categories are added only once (tracked with SQLite's user_version),
    // so categories the user deletes later are not recreated on the next start.
    if (db.pragma('user_version', { simple: true }) === 0) {
      const insertCategory = db.prepare('INSERT OR IGNORE INTO categories (name) VALUES (?)');
      for (const name of DEFAULT_CATEGORIES) {
        insertCategory.run(name);
      }
      db.pragma('user_version = 1');
    }
  });
  initialize();
}
