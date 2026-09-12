import { z } from 'zod';
import { PaymentStatus } from '@prisma/client';

export const recordPaymentSchema = z.object({
  body: z.object({
    invoiceId: z.string().uuid().optional(),
    bookingId: z.string().uuid('Valid booking ID is required'),
    amount: z.number().positive('Payment amount must be greater than 0'),
    method: z.string().default('BANK_TRANSFER'),
    referenceNumber: z.string().optional(),
  }),
});

export const recordExpenseSchema = z.object({
  body: z.object({
    title: z.string().min(2, 'Expense title is required'),
    category: z.string().default('MARKETING'),
    amount: z.number().positive('Expense amount must be greater than 0'),
    date: z.string().datetime().optional(),
    remarks: z.string().optional(),
  }),
});
