import { Router } from 'express';

export function createAnalyticsRouter(analyticsService) {
  const router = Router();

  router.get('/summary', (req, res) => {
    res.json(analyticsService.getMonthlySummary(req.query.month));
  });

  router.get('/trend', (req, res) => {
    res.json(analyticsService.getTrend(req.query.month, req.query.months));
  });

  return router;
}
