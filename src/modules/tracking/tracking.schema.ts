import { z } from 'zod';
import { TrackingStatus } from '@prisma/client';

export const locationUpdateSchema = z.object({
  body: z.object({
    latitude: z.number({ required_error: 'Latitude is required' }).min(-90).max(90),
    longitude: z.number({ required_error: 'Longitude is required' }).min(-180).max(180),
    accuracy: z.number().optional().nullable(),
    speed: z.number().optional().nullable(),
    heading: z.number().optional().nullable(),
    batteryLevel: z.number().int().min(0).max(100).optional().nullable(),
    status: z.nativeEnum(TrackingStatus).default(TrackingStatus.TRACKING),
    timestamp: z.string().datetime().optional(),
  }),
});
