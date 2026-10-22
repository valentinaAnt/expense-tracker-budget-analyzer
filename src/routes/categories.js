import { Router } from 'express';

export function createCategoriesRouter(categoryService) {
  const router = Router();

  router.get('/', (req, res) => {
    res.json(categoryService.list());
  });

  return router;
}
