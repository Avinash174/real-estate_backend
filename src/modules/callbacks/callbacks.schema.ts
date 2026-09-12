import { z } from 'zod';
import { CallbackStatus } from '@prisma/client';

export const createCallbackSchema = z.object({
  body: z.object({
    leadId: z.string().uuid('Valid lead ID is required'),
    callbackDate: z.string().datetime(),
    callbackTime: z.string().min(3, 'Time is required (e.g. 14:30)'),
    reason: z.string().optional(),
    remarks: z.string().optional(),
  }),
});

export const updateCallbackSchema = z.object({
  body: z.object({
    status: z.nativeEnum(CallbackStatus),
    remarks: z.string().optional(),
    newDate: z.string().datetime().optional(),
    newTime: z.string().optional(),
  }),
});
