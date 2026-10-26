import { Router } from 'express';

export function createCategoriesRouter(categoryService) {
  const router = Router();

  router.get('/', (req, res) => {
    res.json(categoryService.list());
  });

  router.post('/', (req, res) => {
    res.status(201).json(categoryService.create(req.body));
  });

  router.put('/:id', (req, res) => {
    res.json(categoryService.rename(req.params.id, req.body));
  });

  // Optional ?moveTo=<categoryId> moves the category's expenses there before deleting it.
  router.delete('/:id', (req, res) => {
    categoryService.remove(req.params.id, { moveTo: req.query.moveTo });
    res.status(204).end();
  });

  return router;
}
