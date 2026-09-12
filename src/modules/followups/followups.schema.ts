import { z } from 'zod';
import { FollowUpStatus } from '@prisma/client';

export const createFollowUpSchema = z.object({
  body: z.object({
    leadId: z.string().uuid('Valid lead ID is required'),
    followUpDate: z.string().datetime(),
    followUpTime: z.string().optional(),
    type: z.string().default('GENERAL'),
    remarks: z.string().optional(),
  }),
});

export const updateFollowUpSchema = z.object({
  body: z.object({
    status: z.nativeEnum(FollowUpStatus),
    remarks: z.string().optional(),
  }),
});
