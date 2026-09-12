import { z } from 'zod';
import { Role, AccountStatus } from '@prisma/client';

export const createUserSchema = z.object({
  body: z.object({
    employeeId: z.string().min(2, 'Employee ID is required'),
    name: z.string().min(2, 'Name is required'),
    email: z.string().email('Invalid email address'),
    phone: z.string().min(10, 'Valid phone number is required'),
    password: z.string().min(6, 'Password must be at least 6 characters'),
    role: z.nativeEnum(Role),
    designation: z.string().optional(),
    managerId: z.string().uuid().optional().nullable(),
  }),
});

export const updateUserSchema = z.object({
  body: z.object({
    name: z.string().min(2).optional(),
    phone: z.string().min(10).optional(),
    role: z.nativeEnum(Role).optional(),
    status: z.nativeEnum(AccountStatus).optional(),
    designation: z.string().optional(),
    managerId: z.string().uuid().optional().nullable(),
  }),
});

export const updateUserStatusSchema = z.object({
  body: z.object({
    status: z.nativeEnum(AccountStatus),
  }),
});
