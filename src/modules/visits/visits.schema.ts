import { z } from 'zod';
import { VisitStatus } from '@prisma/client';

export const scheduleVisitSchema = z.object({
  body: z.object({
    leadId: z.string().uuid('Valid lead ID is required'),
    visitDate: z.string().datetime(),
    visitTime: z.string().optional(),
    latitude: z.number().optional().nullable(),
    longitude: z.number().optional().nullable(),
    address: z.string().min(3, 'Address is required'),
    remarks: z.string().optional(),
  }),
});

export const startVisitSchema = z.object({
  body: z.object({
    latitude: z.number({ required_error: 'Current latitude is required to check-in' }),
    longitude: z.number({ required_error: 'Current longitude is required to check-in' }),
    accuracy: z.number().optional(),
  }),
});

export const completeVisitSchema = z.object({
  body: z.object({
    latitude: z.number({ required_error: 'Current latitude is required to check-out' }),
    longitude: z.number({ required_error: 'Current longitude is required to check-out' }),
    remarks: z.string().min(3, 'Completion remarks are required'),
  }),
});

export const scheduleRevisitSchema = z.object({
  body: z.object({
    visitId: z.string().uuid().optional(),
    leadId: z.string().uuid('Valid lead ID is required'),
    revisitDate: z.string().datetime(),
    revisitTime: z.string().optional(),
    location: z.string().optional(),
    reason: z.string().min(3, 'Reason for revisit is required'),
    remarks: z.string().optional(),
  }),
});
