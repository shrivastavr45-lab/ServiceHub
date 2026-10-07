import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { config, isTest } from './config.js';
import { uploadDir } from './lib/storage.js';
import { authenticate } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { query } from './db.js';

import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import catalogRoutes, { servicesRouter } from './routes/catalog.js';
import providersRoutes from './routes/providers.js';
import bookingsRoutes, { requestsRouter, quotationsRouter, negotiationsRouter } from './routes/bookings.js';
import invoicesRoutes, { paymentsRouter } from './routes/invoices.js';
import reviewsRoutes from './routes/reviews.js';
import notificationsRoutes from './routes/notifications.js';
import disputesRoutes, { reportsRouter } from './routes/disputes.js';
import adminRoutes from './routes/admin.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1); // behind Nginx/ALB in production
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: config.CORS_ORIGIN.split(','), credentials: true }));
  if (!isTest) app.use(morgan('tiny'));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  if (!isTest) {
    app.use('/api', rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false }));
    app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false }));
    app.use('/api/auth/register', rateLimit({ windowMs: 60 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false }));
  }

  app.use('/uploads', express.static(uploadDir, { setHeaders: (r) => r.setHeader('X-Content-Type-Options', 'nosniff') }));

  app.get('/health', async (_req, res) => {
    await query('SELECT 1');
    res.json({ status: 'ok' });
  });

  app.use('/api/auth', authRoutes);
  // Public catalog + provider discovery (GET handlers inside are public; writes require auth/role).
  app.use('/api/categories', catalogRoutes);
  app.use('/api/services', servicesRouter);
  app.use('/api/providers', providersRoutes);
  // Everything below requires a logged-in user.
  app.use('/api/users', authenticate, usersRoutes);
  app.use('/api/requests', authenticate, requestsRouter);
  app.use('/api/quotations', authenticate, quotationsRouter);
  app.use('/api/negotiations', authenticate, negotiationsRouter);
  app.use('/api/bookings', authenticate, bookingsRoutes);
  app.use('/api/invoices', authenticate, invoicesRoutes);
  app.use('/api/payments', authenticate, paymentsRouter);
  app.use('/api/reviews', reviewsRoutes);
  app.use('/api/notifications', authenticate, notificationsRoutes);
  app.use('/api/disputes', authenticate, disputesRoutes);
  app.use('/api/reports', authenticate, reportsRouter);
  app.use('/api/admin', authenticate, adminRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
