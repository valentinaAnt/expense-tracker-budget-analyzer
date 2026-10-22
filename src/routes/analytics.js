import { Router } from 'express';

export function createAnalyticsRouter(analyticsService) {
  const router = Router();

  router.get('/summary', (req, res) => {
    res.json(analyticsService.getMonthlySummary(req.query.month));
  });

  return router;
}
