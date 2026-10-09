import logger from "../utils/logger.js";

const requestLogger = (req, res, next) => {

  const start = Date.now();

  res.on("finish", () => {

    const duration = Date.now() - start;

    logger.info("HTTP Request", {
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      ip: req.ip,
      duration: `${duration}ms`,
    });

  });

  next();
};

export default requestLogger;