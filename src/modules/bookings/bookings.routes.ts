import { Router } from 'express';
import { BookingsController } from './bookings.controller.js';
import { authenticate } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import { createBookingSchema } from './bookings.schema.js';

const router = Router();

router.use(authenticate);

router.post('/', validate(createBookingSchema), BookingsController.createBooking);
router.get('/', BookingsController.listBookings);

export default router;
