import { z } from 'zod';

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(6, 'Password must be at least 6 characters'),
  }),
});

export const mobileLoginSchema = z.object({
  body: z.object({
    identifier: z.string().min(3, 'Email or Phone is required').optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    password: z.string().min(6, 'Password must be at least 6 characters'),
  }),
});

export const refreshTokenSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(1, 'Refresh token is required'),
  }),
});

export const forgotPasswordSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email address'),
  }),
});

export const resetPasswordSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email address'),
    code: z.string().min(4, 'Reset code is required'),
    newPassword: z.string().min(6, 'Password must be at least 6 characters'),
  }),
});
