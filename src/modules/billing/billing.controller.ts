import { Response, NextFunction } from 'express';
import { BillingService } from './billing.service.js';
import { sendSuccess } from '../../utils/response.js';
import { AuthenticatedRequest } from '../../middleware/authenticate.js';

export class BillingController {
  static async listInvoices(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const invoices = await BillingService.listInvoices();
      return sendSuccess(res, invoices, 'Invoices retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  static async listPayments(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const payments = await BillingService.listPayments();
      return sendSuccess(res, payments, 'Payments retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  static async recordPayment(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const payment = await BillingService.recordPayment(req.body, req.user!.userId);
      return sendSuccess(res, payment, 'Payment recorded successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  static async listExpenses(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const from = req.query.from as string;
      const to = req.query.to as string;
      const expenses = await BillingService.listExpenses(from, to);
      return sendSuccess(res, expenses, 'Expenses retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  static async recordExpense(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const expense = await BillingService.recordExpense(req.body, req.user!.userId);
      return sendSuccess(res, expense, 'Expense recorded successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  static async getProfitLoss(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const from = req.query.from as string;
      const to = req.query.to as string;
      const report = await BillingService.getProfitLoss(from, to);
      return sendSuccess(res, report, 'Profit and Loss analysis computed successfully');
    } catch (error) {
      next(error);
    }
  }
}
