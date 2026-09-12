import { z } from 'zod';
import { LeadSource, LeadStatus, Priority } from '@prisma/client';

export const checkDuplicateSchema = z.object({
  query: z.object({
    mobile: z.string().min(5, 'Mobile number required for duplicate check'),
    email: z.string().email().optional(),
  }),
});

export const createLeadSchema = z.object({
  body: z.object({
    name: z.string().min(2, 'Customer name is required'),
    mobile: z.string().min(10, 'Valid mobile number is required'),
    email: z.string().email().optional().nullable(),
    alternateMobile: z.string().optional().nullable(),
    city: z.string().optional().nullable(),
    address: z.string().optional().nullable(),
    source: z.nativeEnum(LeadSource).default(LeadSource.META),
    priority: z.nativeEnum(Priority).default(Priority.MEDIUM),
    remarks: z.string().optional().nullable(),
    assignedManagerId: z.string().uuid().optional().nullable(),
    assignedExecutiveId: z.string().uuid().optional().nullable(),
  }),
});

export const updateLeadSchema = z.object({
  body: z.object({
    priority: z.nativeEnum(Priority).optional(),
    remarks: z.string().optional().nullable(),
    nextFollowUpAt: z.string().datetime().optional().nullable(),
  }),
});

export const updateStatusSchema = z.object({
  body: z.object({
    status: z.nativeEnum(LeadStatus),
    remarks: z.string().optional(),
    lossReason: z.string().optional(),
    estimatedLossAmount: z.number().optional(),
  }),
});

export const addNoteSchema = z.object({
  body: z.object({
    note: z.string().min(1, 'Note content cannot be empty'),
  }),
});
