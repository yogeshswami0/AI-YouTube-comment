import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";

const { combine, timestamp, errors, json, printf, colorize } = winston.format;

const isProduction = process.env.NODE_ENV === "production";

/*
Console format (for development)
*/
const consoleFormat = printf(({ level, message, timestamp, stack }) => {
  return `${timestamp} ${level}: ${stack || message}`;
});

/*
File transport with rotation
*/
const fileRotateTransport = new DailyRotateFile({
  dirname: "logs",
  filename: "worker-%DATE%.log",
  datePattern: "YYYY-MM-DD",
  maxSize: "20m",
  maxFiles: "14d",
});

/*
Error log rotation
*/
const errorRotateTransport = new DailyRotateFile({
  dirname: "logs",
  filename: "worker-error-%DATE%.log",
  level: "error",
  datePattern: "YYYY-MM-DD",
  maxSize: "20m",
  maxFiles: "30d",
});

const logger = winston.createLogger({
  level: isProduction ? "info" : "debug",

  format: combine(
    timestamp(),
    errors({ stack: true }),
    json()
  ),

  defaultMeta: { service: "replypilot-worker" },

  transports: [
    fileRotateTransport,
    errorRotateTransport
  ],

  exceptionHandlers: [
    new winston.transports.File({ filename: "logs/worker-exceptions.log" })
  ],

  rejectionHandlers: [
    new winston.transports.File({ filename: "logs/worker-rejections.log" })
  ],
});

/*
Console logging (always enabled for Railway/Docker to capture logs)
*/
logger.add(
  new winston.transports.Console({
    format: combine(
      colorize(),
      timestamp(),
      consoleFormat
    ),
  })
);

export default logger;
