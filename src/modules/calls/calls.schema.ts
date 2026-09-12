import { z } from 'zod';
import { CallOutcome, CallStatus } from '@prisma/client';

export const logCallSchema = z.object({
  body: z.object({
    leadId: z.string().uuid('Valid lead ID is required'),
    phoneNumber: z.string().min(5, 'Phone number is required'),
    duration: z.number().int().min(0).default(0),
    callStatus: z.nativeEnum(CallStatus).default(CallStatus.COMPLETED),
    outcome: z.nativeEnum(CallOutcome).default(CallOutcome.POSITIVE),
    recordingUrl: z.string().url().optional().nullable(),
    remarks: z.string().optional().nullable(),
    providerCallId: z.string().optional().nullable(),
  }),
});

export const telephonyWebhookSchema = z.object({
  body: z.object({
    providerCallId: z.string().min(1),
    recordingUrl: z.string().url(),
    duration: z.number().int().min(0),
    secret: z.string().min(1),
  }),
});
