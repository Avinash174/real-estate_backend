import { z } from 'zod';
import { PaymentStatus } from '@prisma/client';

export const createBookingSchema = z.object({
  body: z.object({
    leadId: z.string().uuid('Valid lead ID is required'),
    amount: z.number().positive('Booking amount must be greater than 0'),
    remarks: z.string().optional(),
    tokenAmount: z.number().nonnegative().optional(),
    paymentMethod: z.string().optional(),
  }),
});

export const updateBookingStatusSchema = z.object({
  body: z.object({
    paymentStatus: z.nativeEnum(PaymentStatus),
  }),
});
