import { Router } from 'express';

export function createBudgetsRouter(budgetService) {
  const router = Router();

  router.get('/', (req, res) => {
    res.json(budgetService.list());
  });

  router.put('/:categoryId', (req, res) => {
    res.json(budgetService.set(req.params.categoryId, req.body));
  });

  router.delete('/:categoryId', (req, res) => {
    budgetService.remove(req.params.categoryId);
    res.status(204).end();
  });

  return router;
}
