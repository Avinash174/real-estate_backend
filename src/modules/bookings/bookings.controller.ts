import { Response, NextFunction } from 'express';
import { BookingsService } from './bookings.service.js';
import { sendSuccess } from '../../utils/response.js';
import { AuthenticatedRequest } from '../../middleware/authenticate.js';

export class BookingsController {
  static async createBooking(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await BookingsService.createBooking(req.body, req.user!.userId);
      return sendSuccess(res, result, 'Booking recorded successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  static async listBookings(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const bookings = await BookingsService.listBookings({
        id: req.user!.userId,
        role: req.user!.role,
      });
      return sendSuccess(res, bookings, 'Bookings retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  static async getBooking(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const booking = await BookingsService.getBookingById(req.params.id);
      return sendSuccess(res, booking, 'Booking retrieved successfully');
    } catch (error) {
      next(error);
    }
  }
}
