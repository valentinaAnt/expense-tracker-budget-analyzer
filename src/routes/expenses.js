import { Router } from 'express';
import { expensesToCsv } from '../csv.js';

// Routes only translate HTTP to service calls; validation and SQL live in the service.
// Errors thrown by the service are passed to the central error handler by Express.
export function createExpensesRouter(expenseService) {
  const router = Router();

  router.get('/', (req, res) => {
    const { month, categoryId } = req.query;
    res.json(expenseService.list({ month, categoryId }));
  });

  // Registered before "/:id" so that "export" is not read as an expense ID.
  router.get('/export', (req, res) => {
    const { month, categoryId } = req.query;
    const expenses = expenseService.list({ month, categoryId }); // validates month and categoryId first
    res
      .attachment(month ? `expenses-${month}.csv` : 'expenses.csv')
      .type('text/csv; charset=utf-8')
      .send(expensesToCsv(expenses));
  });

  router.get('/:id', (req, res) => {
    res.json(expenseService.getById(req.params.id));
  });

  router.post('/', (req, res) => {
    res.status(201).json(expenseService.create(req.body));
  });

  router.put('/:id', (req, res) => {
    res.json(expenseService.update(req.params.id, req.body));
  });

  router.delete('/:id', (req, res) => {
    expenseService.remove(req.params.id);
    res.status(204).end();
  });

  return router;
}
