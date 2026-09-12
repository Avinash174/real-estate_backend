import { z } from 'zod';

export const assignLeadSchema = z.object({
  body: z.object({
    leadId: z.string().uuid('Valid lead ID is required'),
    newExecutiveId: z.string().uuid('Valid executive ID is required'),
    reason: z.string().min(3, 'Assignment reason is mandatory and must be at least 3 characters'),
  }),
});
