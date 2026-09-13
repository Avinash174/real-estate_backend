import { prisma } from '../../utils/prisma.js';
import { PaymentStatus, LeadStatus, Role } from '@prisma/client';
import { logAudit } from '../../utils/audit.js';
import { notificationEmitter } from '../notifications/notification.events.js';

export class BillingService {
  static async listInvoices() {
    return prisma.invoice.findMany({
      include: {
        customer: { select: { name: true, phone: true, email: true } },
        lead: { select: { leadNumber: true } },
        booking: { select: { bookingNumber: true } },
        payments: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  static async listPayments() {
    return prisma.payment.findMany({
      include: {
        booking: {
          select: {
            bookingNumber: true,
            lead: { select: { leadNumber: true, customer: { select: { name: true } } } },
          },
        },
        invoice: { select: { invoiceNumber: true } },
      },
      orderBy: { paymentDate: 'desc' },
    });
  }

  static async recordPayment(data: any, recordedById: string) {
    const payment = await prisma.$transaction(async (tx) => {
      const paymentRecord = await tx.payment.create({
        data: {
          invoiceId: data.invoiceId || null,
          bookingId: data.bookingId,
          amount: data.amount,
          method: data.method,
          status: PaymentStatus.PAID,
          referenceNumber: data.referenceNumber || null,
        },
      });

      // Calculate total paid for booking
      const allPayments = await tx.payment.findMany({
        where: { bookingId: data.bookingId, status: PaymentStatus.PAID },
      });
      const totalPaid = allPayments.reduce((sum, p) => sum + p.amount, 0);

      const booking = await tx.booking.findUnique({
        where: { id: data.bookingId },
      });

      if (booking) {
        const isFullyPaid = totalPaid >= booking.amount;
        const newStatus = isFullyPaid ? PaymentStatus.PAID : PaymentStatus.PARTIAL;

        await tx.booking.update({
          where: { id: data.bookingId },
          data: { paymentStatus: newStatus },
        });

        if (data.invoiceId) {
          await tx.invoice.update({
            where: { id: data.invoiceId },
            data: { paymentStatus: newStatus },
          });
        }

        if (isFullyPaid) {
          await tx.lead.update({
            where: { id: booking.leadId },
            data: { status: LeadStatus.CLOSED },
          });
        }

        await tx.leadActivity.create({
          data: {
            leadId: booking.leadId,
            activityType: 'PAYMENT_RECEIVED',
            description: `Payment of ₹${data.amount.toLocaleString()} received via ${data.method}. Total paid: ₹${totalPaid.toLocaleString()}`,
            performedById: recordedById,
            metadata: { paymentId: paymentRecord.id, amount: data.amount, totalPaid },
          },
        });
      }

      await logAudit({
        userId: recordedById,
        action: 'PAYMENT_RECORDED',
        entity: 'Payment',
        entityId: paymentRecord.id,
        newValue: { amount: data.amount, bookingId: data.bookingId },
      });

      return { paymentRecord, leadId: booking?.leadId };
    });

    notificationEmitter.emit('payment.received', {
      paymentId: payment.paymentRecord.id,
      bookingId: data.bookingId,
      leadId: payment.leadId,
      amount: data.amount,
      paymentMethod: data.method,
      recordedById,
    });

    return payment.paymentRecord;
  }

  static async listExpenses(from?: string, to?: string) {
    const where: any = {};
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from);
      if (to) where.date.lte = new Date(to);
    }

    return prisma.expense.findMany({
      where,
      include: {
        recordedBy: { select: { id: true, name: true, employeeId: true } },
      },
      orderBy: { date: 'desc' },
    });
  }

  static async recordExpense(data: any, recordedById: string) {
    const expense = await prisma.expense.create({
      data: {
        title: data.title,
        category: data.category || 'GENERAL',
        amount: data.amount,
        date: data.date ? new Date(data.date) : new Date(),
        recordedById,
        remarks: data.remarks || null,
      },
    });

    await logAudit({
      userId: recordedById,
      action: 'EXPENSE_RECORDED',
      entity: 'Expense',
      entityId: expense.id,
      newValue: { title: expense.title, amount: expense.amount },
    });

    return expense;
  }

  /**
   * Section 21: Profit & Loss Calculations
   * Revenue = payments received from bookings
   * Expenses = operational and marketing expenses
   * Profit = Revenue - Expenses
   * Loss = lost leads & missed deals summary
   */
  static async getProfitLoss(from?: string, to?: string) {
    const dateFilter: any = {};
    if (from) dateFilter.gte = new Date(from);
    if (to) dateFilter.lte = new Date(to);

    const paymentWhere: any = { status: PaymentStatus.PAID };
    if (from || to) paymentWhere.paymentDate = dateFilter;

    const expenseWhere: any = {};
    if (from || to) expenseWhere.date = dateFilter;

    const lossWhere: any = {};
    if (from || to) lossWhere.createdAt = dateFilter;

    const [payments, expenses, losses, bookingCount, closedCount] = await Promise.all([
      prisma.payment.findMany({ where: paymentWhere, select: { amount: true } }),
      prisma.expense.findMany({ where: expenseWhere, select: { amount: true, category: true } }),
      prisma.lossRecord.findMany({
        where: lossWhere,
        include: {
          lead: { select: { leadNumber: true, source: true } },
          manager: { select: { name: true } },
          executive: { select: { name: true } },
        },
      }),
      prisma.booking.count(),
      prisma.lead.count({ where: { status: LeadStatus.CLOSED } }),
    ]);

    const totalRevenue = payments.reduce((sum, p) => sum + p.amount, 0);
    const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
    const netProfit = totalRevenue - totalExpenses;

    // Expenses categorized
    const expenseByCategory: Record<string, number> = {};
    for (const exp of expenses) {
      expenseByCategory[exp.category] = (expenseByCategory[exp.category] || 0) + exp.amount;
    }

    // Losses by reason
    const lossByReason: Record<string, { count: number; estimatedAmount: number }> = {};
    for (const loss of losses) {
      if (!lossByReason[loss.reason]) {
        lossByReason[loss.reason] = { count: 0, estimatedAmount: 0 };
      }
      lossByReason[loss.reason].count += 1;
      lossByReason[loss.reason].estimatedAmount += loss.estimatedLossAmount || 0;
    }

    const totalEstimatedLoss = losses.reduce((sum, l) => sum + (l.estimatedLossAmount || 0), 0);

    return {
      financials: {
        totalRevenue,
        totalExpenses,
        netProfit,
        profitMarginPercent: totalRevenue > 0 ? ((netProfit / totalRevenue) * 100).toFixed(2) : 0,
        bookingCount,
        closedCount,
      },
      expenseBreakdown: expenseByCategory,
      lossBreakdown: {
        totalLostLeads: losses.length,
        totalEstimatedLoss,
        byReason: lossByReason,
        recentLosses: losses.slice(0, 10),
      },
    };
  }
}
