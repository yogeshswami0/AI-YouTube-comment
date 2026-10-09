import { env } from "../config/env.js";
import logger from '../utils/logger.js';

function globalErrorHandler(error, req, res, next) {
    const status = error.status || error.statusCode || 500;

  logger.error(`${req.method} ${req.path} → ${status}`, {
    message: error.message,
    stack:   env.NODE_ENV === 'development' ? error.stack : undefined,
  });

  if (error?.response?.data?.error?.code === 403) {
    return res.status(403).json({
      error: 'YouTube API quota exceeded or permission denied',
      details: error.response.data.error.message,
    });
  }

  res.status(status).json({
    error:   error.message || 'Internal server error',
    ...(env.NODE_ENV === 'development' && { stack: error.stack }),
  });
}
export default globalErrorHandler;
