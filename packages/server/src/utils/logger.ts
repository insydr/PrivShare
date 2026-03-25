/**
 * Logger Utility
 * ==============
 * 
 * Centralized logging with Winston for structured logging.
 * Includes security event logging for audit trails.
 */

import winston from 'winston';
import path from 'path';

// Log format
const logFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
);

// Console format for development
const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
        const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
        return `${timestamp} [${level}]: ${message} ${metaStr}`;
    })
);

// Create logger instance
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: logFormat,
    defaultMeta: { service: 'privshare-server' },
    transports: [
        // Write all logs to console
        new winston.transports.Console({
            format: process.env.NODE_ENV === 'production' ? logFormat : consoleFormat,
        }),
    ],
});

// Add file transport in production
if (process.env.NODE_ENV === 'production') {
    logger.add(
        new winston.transports.File({
            filename: path.join('logs', 'error.log'),
            level: 'error',
        })
    );
    logger.add(
        new winston.transports.File({
            filename: path.join('logs', 'combined.log'),
        })
    );
}

// ============================================
// SECURITY EVENT LOGGER
// ============================================

/**
 * Log security-related events
 */
export const logSecurityEvent = (
    event: string,
    details: Record<string, unknown>,
    severity: 'low' | 'medium' | 'high' | 'critical' = 'medium'
) => {
    const logData = {
        event,
        severity,
        timestamp: new Date().toISOString(),
        ...details,
    };

    switch (severity) {
        case 'critical':
            logger.error(`[SECURITY-CRITICAL] ${event}`, logData);
            break;
        case 'high':
            logger.error(`[SECURITY-HIGH] ${event}`, logData);
            break;
        case 'medium':
            logger.warn(`[SECURITY-MEDIUM] ${event}`, logData);
            break;
        case 'low':
            logger.info(`[SECURITY-LOW] ${event}`, logData);
            break;
    }
};

/**
 * Log file upload attempts (security violation)
 */
export const logFileUploadAttempt = (
    ip: string,
    userAgent: string,
    contentType: string,
    contentLength: number
) => {
    logSecurityEvent('FILE_UPLOAD_ATTEMPT', {
        message: '⚠️  FILE UPLOAD REJECTED - Zero-Trust Violation',
        ip,
        userAgent,
        contentType,
        contentLength,
        action: 'REQUEST_BLOCKED',
        reason: 'PrivShare enforces Zero-Trust: Files must never leave the client device',
    }, 'high');
};

/**
 * Log authentication events
 */
export const logAuthEvent = (
    event: 'LOGIN_SUCCESS' | 'LOGIN_FAILURE' | 'TOKEN_INVALID' | 'TOKEN_EXPIRED',
    userId?: string,
    ip?: string
) => {
    const severity = event === 'LOGIN_SUCCESS' ? 'low' : 'medium';
    logSecurityEvent(event, { userId, ip }, severity);
};

export default logger;
