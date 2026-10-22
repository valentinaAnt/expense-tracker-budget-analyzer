import express from 'express';
import { fileURLToPath } from 'node:url';
import { apiNotFound, errorHandler } from './errors.js';
import { createAnalyticsRouter } from './routes/analytics.js';
import { createBudgetsRouter } from './routes/budgets.js';
import { createCategoriesRouter } from './routes/categories.js';
import { createExpensesRouter } from './routes/expenses.js';
import { createAnalyticsService } from './services/analyticsService.js';
import { createBudgetService } from './services/budgetService.js';
import { createCategoryService } from './services/categoryService.js';
import { createExpenseService } from './services/expenseService.js';

const publicDir = fileURLToPath(new URL('../public', import.meta.url));

/**
 * Builds the Express application without starting a server.
 * The database is passed in, so tests can supply an isolated temporary database.
 */
export function createApp(db) {
  const categoryService = createCategoryService(db);
  const expenseService = createExpenseService(db, categoryService);
  const budgetService = createBudgetService(db, categoryService);
  const analyticsService = createAnalyticsService(db);

  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));

  app.get('/api/health', (req, res) => {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok', database: 'ok' });
  });

  app.use('/api/categories', createCategoriesRouter(categoryService));
  app.use('/api/expenses', createExpensesRouter(expenseService));
  app.use('/api/budgets', createBudgetsRouter(budgetService));
  app.use('/api/analytics', createAnalyticsRouter(analyticsService));
  app.use('/api', apiNotFound);

  app.use(express.static(publicDir));

  app.use(errorHandler);

  return app;
}
