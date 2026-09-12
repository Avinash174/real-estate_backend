import { Router } from 'express';
import { BillingController } from './billing.controller.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { recordPaymentSchema, recordExpenseSchema } from './billing.schema.js';
import { Role } from '@prisma/client';

const router = Router();

router.use(authenticate);

router.get('/invoices', authorize([Role.ADMIN, Role.MANAGER]), BillingController.listInvoices);
router.get('/payments', authorize([Role.ADMIN, Role.MANAGER]), BillingController.listPayments);
router.post('/payments', authorize([Role.ADMIN, Role.MANAGER]), validate(recordPaymentSchema), BillingController.recordPayment);

router.get('/expenses', authorize([Role.ADMIN, Role.MANAGER]), BillingController.listExpenses);
router.post('/expenses', authorize([Role.ADMIN, Role.MANAGER]), validate(recordExpenseSchema), BillingController.recordExpense);

router.get('/profit-loss', authorize([Role.ADMIN]), BillingController.getProfitLoss);

export default router;
