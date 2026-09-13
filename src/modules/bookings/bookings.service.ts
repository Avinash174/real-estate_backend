import { prisma } from '../../utils/prisma.js';
import { LeadStatus, PaymentStatus, Role } from '@prisma/client';
import { logAudit } from '../../utils/audit.js';

export class BookingsService {
  static async createBooking(data: any, executiveId: string) {
    const lead = await prisma.lead.findUnique({
      where: { id: data.leadId },
      include: { customer: true },
    });

    if (!lead) {
      throw { statusCode: 404, message: 'Lead not found', errorCode: 'LEAD_NOT_FOUND' };
    }

    const count = await prisma.booking.count();
    const currentYear = new Date().getFullYear();
    const bookingNumber = `BK-${currentYear}-${String(count + 1).padStart(4, '0')}`;

    const paymentStatus =
      data.tokenAmount && data.tokenAmount >= data.amount
        ? PaymentStatus.PAID
        : data.tokenAmount && data.tokenAmount > 0
        ? PaymentStatus.PARTIAL
        : PaymentStatus.PENDING;

    // Use transaction to create Booking, Lead status update, and initial payment/invoice
    const result = await prisma.$transaction(async (tx) => {
      const booking = await tx.booking.create({
        data: {
          leadId: data.leadId,
          executiveId,
          bookingNumber,
          amount: data.amount,
          paymentStatus,
          remarks: data.remarks || null,
        },
      });

      // Update lead to BOOKING status
      await tx.lead.update({
        where: { id: data.leadId },
        data: {
          status: paymentStatus === PaymentStatus.PAID ? LeadStatus.CLOSED : LeadStatus.BOOKING,
        },
      });

      // Create invoice automatically
      const invoiceCount = await tx.invoice.count();
      const invoiceNumber = `INV-${currentYear}-${String(invoiceCount + 1).padStart(4, '0')}`;
      const invoice = await tx.invoice.create({
        data: {
          invoiceNumber,
          leadId: data.leadId,
          bookingId: booking.id,
          customerId: lead.customerId,
          amount: data.amount,
          tax: Math.round(data.amount * 0.05), // 5% GST
          totalAmount: Math.round(data.amount * 1.05),
          paymentStatus,
          dueDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
        },
      });

      // If token amount was paid, create payment record
      if (data.tokenAmount && data.tokenAmount > 0) {
        await tx.payment.create({
          data: {
            invoiceId: invoice.id,
            bookingId: booking.id,
            amount: data.tokenAmount,
            method: data.paymentMethod || 'BANK_TRANSFER',
            status: PaymentStatus.PAID,
            referenceNumber: `TOKEN-${Date.now()}`,
          },
        });
      }

      // Record activity timeline
      await tx.leadActivity.create({
        data: {
          leadId: data.leadId,
          activityType: 'BOOKING_CREATED',
          description: `Booking #${bookingNumber} created for amount ₹${data.amount.toLocaleString()}. Status: ${paymentStatus}`,
          performedById: executiveId,
          metadata: { bookingId: booking.id, amount: data.amount, bookingNumber },
        },
      });

      return { booking, invoice };
    });

    await logAudit({
      userId: executiveId,
      action: 'BOOKING_CREATED',
      entity: 'Booking',
      entityId: result.booking.id,
      newValue: { amount: data.amount, bookingNumber },
    });

    return result;
  }

  static async listBookings(user: { id: string; role: Role }) {
    const where: any = {};
    if (user.role === Role.EXECUTIVE) {
      where.executiveId = user.id;
    }

    return prisma.booking.findMany({
      where,
      include: {
        lead: {
          select: {
            id: true,
            leadNumber: true,
            customer: { select: { name: true, phone: true } },
          },
        },
        executive: { select: { id: true, name: true, employeeId: true } },
        invoices: true,
        payments: true,
      },
      orderBy: { bookingDate: 'desc' },
    });
  }

  static async getBookingById(id: string) {
    const booking = await prisma.booking.findUnique({
      where: { id },
      include: {
        lead: {
          include: {
            customer: true,
          },
        },
        executive: { select: { id: true, name: true, employeeId: true, phone: true } },
        invoices: true,
        payments: true,
      },
    });

    if (!booking) {
      throw { statusCode: 404, message: 'Booking not found', errorCode: 'BOOKING_NOT_FOUND' };
    }

    return booking;
  }
}
