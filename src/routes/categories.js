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

  router.delete('/:id', (req, res) => {
    categoryService.remove(req.params.id);
    res.status(204).end();
  });

  return router;
}
