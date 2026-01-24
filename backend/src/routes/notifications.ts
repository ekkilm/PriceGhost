import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { notificationHistoryQueries } from '../models';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// Get recent notifications (for bell dropdown)
router.get('/recent', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 20);

    const notifications = await notificationHistoryQueries.getRecent(userId, limit);
    const recentCount = await notificationHistoryQueries.countRecent(userId, 24);

    res.json({
      notifications,
      recentCount,
    });
  } catch (error) {
    console.error('Error fetching recent notifications:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// Get notification history with pagination
router.get('/history', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = (page - 1) * limit;

    const [notifications, totalCount] = await Promise.all([
      notificationHistoryQueries.getByUserId(userId, limit, offset),
      notificationHistoryQueries.getTotalCount(userId),
    ]);

    res.json({
      notifications,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching notification history:', error);
    res.status(500).json({ error: 'Failed to fetch notification history' });
  }
});

// Get count of recent notifications (for badge)
router.get('/count', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const hours = parseInt(req.query.hours as string) || 24;

    const count = await notificationHistoryQueries.countRecent(userId, hours);

    res.json({ count });
  } catch (error) {
    console.error('Error counting notifications:', error);
    res.status(500).json({ error: 'Failed to count notifications' });
  }
});

export default router;
