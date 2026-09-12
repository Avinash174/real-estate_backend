import http from 'http';
import { createApp } from './app.js';
import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import { initSocket } from './socket.js';
import { prisma } from './utils/prisma.js';

const startServer = async () => {
  try {
    const app = createApp();
    const server = http.createServer(app);

    // Initialize Socket.IO
    initSocket(server, config.CORS_ORIGIN);

    // Verify Database Connection
    await prisma.$connect();
    logger.info('Connected to PostgreSQL database successfully.');

    server.listen(config.PORT, () => {
      logger.info(`🚀 Real Estate CRM API Server running on port ${config.PORT} [${config.NODE_ENV}]`);
      logger.info(`API Base URL: http://localhost:${config.PORT}/api/v1`);
      logger.info(`Health Check: http://localhost:${config.PORT}/api/health`);
    });

    const shutdown = async () => {
      logger.info('Shutting down server gracefully...');
      await prisma.$disconnect();
      server.close(() => {
        logger.info('Server closed.');
        process.exit(0);
      });
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
