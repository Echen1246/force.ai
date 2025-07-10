const winston = require('winston');
const path = require('path');

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define colors for each level
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

// Tell winston that you want to link the colors 
winston.addColors(colors);

// Choose the aspect of your log customizing the log format
const format = winston.format.combine(
  // Add the message timestamp with the preferred format
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  // Tell Winston that the logs must be colored
  winston.format.colorize({ all: true }),
  // Define the format of the message showing the timestamp, the level and the message
  winston.format.printf(
    (info) => `${info.timestamp} ${info.level}: ${info.message}`,
  ),
);

// Define which transports the logger must use to print out messages
const transports = [
  // Allow the use the console to print the messages
  new winston.transports.Console({
    format: format,
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  }),
];

// Add file transports for production
if (process.env.NODE_ENV === 'production') {
  // Create logs directory if it doesn't exist
  const fs = require('fs');
  const logsDir = path.join(process.cwd(), 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  // Add file transports
  transports.push(
    // Error log file
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    
    // Combined log file
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    })
  );
}

// Create the logger instance
const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  levels,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports,
  // Handle uncaught exceptions and unhandled rejections
  exceptionHandlers: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ],
  rejectionHandlers: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ],
});

// Create a stream object with a 'write' function that will be used by Morgan
logger.stream = {
  write: function(message) {
    // Use the 'http' log level so the output will be picked up by both transports
    logger.http(message.trim());
  },
};

// Add custom logging methods for common use cases
logger.database = function(message, meta = {}) {
  logger.debug(`[DATABASE] ${message}`, meta);
};

logger.websocket = function(message, meta = {}) {
  logger.debug(`[WEBSOCKET] ${message}`, meta);
};

logger.auth = function(message, meta = {}) {
  logger.info(`[AUTH] ${message}`, meta);
};

logger.worker = function(message, meta = {}) {
  logger.info(`[WORKER] ${message}`, meta);
};

logger.task = function(message, meta = {}) {
  logger.info(`[TASK] ${message}`, meta);
};

logger.billing = function(message, meta = {}) {
  logger.info(`[BILLING] ${message}`, meta);
};

logger.security = function(message, meta = {}) {
  logger.warn(`[SECURITY] ${message}`, meta);
};

// Performance logging helper
logger.performance = function(operation, duration, meta = {}) {
  const level = duration > 1000 ? 'warn' : duration > 500 ? 'info' : 'debug';
  logger[level](`[PERFORMANCE] ${operation} took ${duration}ms`, meta);
};

// Structured error logging
logger.errorWithContext = function(error, context = {}) {
  logger.error('Error occurred', {
    message: error.message,
    stack: error.stack,
    name: error.name,
    ...context
  });
};

// API request logging helper
logger.apiRequest = function(method, path, statusCode, duration, userId = null) {
  const level = statusCode >= 400 ? 'warn' : 'info';
  logger[level](`[API] ${method} ${path}`, {
    statusCode,
    duration: `${duration}ms`,
    userId
  });
};

// Development helper
if (process.env.NODE_ENV !== 'production') {
  logger.debug('Logger initialized in development mode');
} else {
  logger.info('Logger initialized in production mode');
}

module.exports = logger; 