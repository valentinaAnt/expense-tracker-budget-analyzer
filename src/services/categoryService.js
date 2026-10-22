export function createCategoryService(db) {
  const listStatement = db.prepare('SELECT id, name FROM categories ORDER BY id');
  const existsStatement = db.prepare('SELECT 1 FROM categories WHERE id = ?');

  return {
    list() {
      return listStatement.all();
    },

    exists(id) {
      return existsStatement.get(id) !== undefined;
    },
  };
}
