import { Router, Response, NextFunction } from 'express';
import { prisma } from '../../utils/prisma.js';
import { sendSuccess } from '../../utils/response.js';
import { authenticate, AuthenticatedRequest } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { Role } from '@prisma/client';

const router = Router();

router.use(authenticate);

// List settings (Public to authenticated staff to check working hours / geofence)
router.get('/', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const settings = await prisma.systemSetting.findMany({
      orderBy: { key: 'asc' },
    });
    return sendSuccess(res, settings, 'System settings retrieved');
  } catch (error) {
    next(error);
  }
});

// Update setting (Admin only)
router.put('/:key', authorize([Role.ADMIN]), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { key } = req.params;
    const { value, description } = req.body;

    const setting = await prisma.systemSetting.upsert({
      where: { key },
      update: { value, ...(description && { description }) },
      create: { key, value, description },
    });

    return sendSuccess(res, setting, 'System setting updated');
  } catch (error) {
    next(error);
  }
});

export default router;
