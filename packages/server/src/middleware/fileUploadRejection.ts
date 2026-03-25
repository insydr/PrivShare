/**
 * File Upload Rejection Middleware
 * =================================
 * 
 * CRITICAL SECURITY MIDDLEWARE
 * 
 * This middleware enforces the Zero-Trust architecture requirement:
 * "The backend will NOT accept file uploads"
 * 
 * Any attempt to upload files is:
 * 1. Blocked immediately
 * 2. Logged as a security event
 * 3. Returns a 415 Unsupported Media Type error
 */

import { Request, Response, NextFunction } from 'express';
import logger, { logSecurityEvent, logFileUploadAttempt } from '../utils/logger';

// ============================================
// TYPES
// ============================================

interface SecurityLogDetails {
    ip: string;
    userAgent: string;
    method: string;
    path: string;
    contentType: string;
    contentLength: number;
    reason: string;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Extract client IP from request
 */
const getClientIp = (req: Request): string => {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
        return forwarded.split(',')[0].trim();
    }
    return req.socket.remoteAddress || 'unknown';
};

/**
 * Log security warning for file upload attempts
 */
const logFileUploadSecurityWarning = (req: Request, reason: string) => {
    const ip = getClientIp(req);
    const userAgent = req.headers['user-agent'] || 'unknown';
    const contentType = req.headers['content-type'] || 'unknown';
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);

    // Detailed console warning (visible in logs)
    console.warn('');
    console.warn('╔══════════════════════════════════════════════════════════════════╗');
    console.warn('│           ⚠️  SECURITY WARNING: FILE UPLOAD ATTEMPT              │');
    console.warn('╠══════════════════════════════════════════════════════════════════╣');
    console.warn(`│  Reason:     ${reason.padEnd(49)}│`);
    console.warn(`│  IP:         ${ip.padEnd(49)}│`);
    console.warn(`│  Method:     ${req.method.padEnd(49)}│`);
    console.warn(`│  Path:       ${req.path.padEnd(49)}│`);
    console.warn(`│  Content-Type: ${contentType.padEnd(46)}│`);
    console.warn(`│  User-Agent: ${(userAgent.substring(0, 49) || 'unknown').padEnd(49)}│`);
    console.warn('╠══════════════════════════════════════════════════════════════════╣');
    console.warn('│  ACTION: Request BLOCKED - Zero-Trust Violation                   │');
    console.warn('│  Files must NEVER leave the client device                         │');
    console.warn('╚══════════════════════════════════════════════════════════════════╝');
    console.warn('');

    // Log to security event system
    logFileUploadAttempt(ip, userAgent, contentType, contentLength);

    // Additional structured logging
    const details: SecurityLogDetails = {
        ip,
        userAgent,
        method: req.method,
        path: req.path,
        contentType,
        contentLength,
        reason,
    };

    logger.warn(`[SECURITY] File upload attempt blocked: ${reason}`, details);
};

// ============================================
// MIDDLEWARE FUNCTIONS
// ============================================

/**
 * Reject multipart/form-data (file uploads)
 */
export const rejectMultipartUploads = (req: Request, res: Response, next: NextFunction): void => {
    const contentType = req.headers['content-type'] || '';

    if (contentType.includes('multipart/form-data')) {
        logFileUploadSecurityWarning(req, 'multipart/form-data detected (file upload attempt)');

        res.status(415).json({
            error: 'UNSUPPORTED_MEDIA_TYPE',
            message: 'File uploads are not permitted.',
            details: 'PrivShare enforces a Zero-Trust architecture where files never leave your device.',
            code: 'ZERO_TRUST_VIOLATION',
            hint: 'All document processing happens locally in your browser.',
        });
        return;
    }

    next();
};

/**
 * Reject application/octet-stream (binary file data)
 */
export const rejectBinaryUploads = (req: Request, res: Response, next: NextFunction): void => {
    const contentType = req.headers['content-type'] || '';

    if (contentType.includes('application/octet-stream')) {
        logFileUploadSecurityWarning(req, 'application/octet-stream detected (binary upload attempt)');

        res.status(415).json({
            error: 'UNSUPPORTED_MEDIA_TYPE',
            message: 'Binary data uploads are not permitted.',
            details: 'PrivShare enforces a Zero-Trust architecture.',
            code: 'ZERO_TRUST_VIOLATION',
        });
        return;
    }

    next();
};

/**
 * Reject base64-encoded file data in JSON payloads
 */
export const rejectBase64FileData = (req: Request, res: Response, next: NextFunction): void => {
    if (!req.body) {
        next();
        return;
    }

    const bodyString = JSON.stringify(req.body);

    // Detect base64 data URIs (e.g., data:image/png;base64,...)
    const base64DataPattern = /data:[a-zA-Z0-9]+\/[a-zA-Z0-9.+_-]+;base64,[A-Za-z0-9+/=]{100,}/;

    if (base64DataPattern.test(bodyString)) {
        logFileUploadSecurityWarning(req, 'Base64-encoded file data detected in JSON payload');

        res.status(400).json({
            error: 'INVALID_PAYLOAD',
            message: 'Base64-encoded file data is not permitted in requests.',
            details: 'PrivShare only accepts JSON metadata, not file content.',
            code: 'ZERO_TRUST_VIOLATION',
        });
        return;
    }

    // Detect large array buffers (potential binary data)
    const hasLargeArray = (obj: unknown, depth = 0): boolean => {
        if (depth > 5) return false; // Prevent infinite recursion
        if (Array.isArray(obj)) {
            // Large numeric arrays are likely binary data
            if (obj.length > 1000 && obj.every(item => typeof item === 'number')) {
                return true;
            }
            return obj.some(item => hasLargeArray(item, depth + 1));
        }
        if (typeof obj === 'object' && obj !== null) {
            return Object.values(obj).some(val => hasLargeArray(val, depth + 1));
        }
        return false;
    };

    if (hasLargeArray(req.body)) {
        logFileUploadSecurityWarning(req, 'Large binary array detected in JSON payload');

        res.status(400).json({
            error: 'INVALID_PAYLOAD',
            message: 'Array-like binary data is not permitted.',
            details: 'PrivShare only accepts JSON metadata, not file content.',
            code: 'ZERO_TRUST_VIOLATION',
        });
        return;
    }

    next();
};

/**
 * Combined middleware to reject all file uploads
 */
export const rejectAllFileUploads = [
    rejectMultipartUploads,
    rejectBinaryUploads,
];

/**
 * Validate JSON payload size and content
 */
export const validateJsonPayload = (maxSize: string = '10kb') => {
    return (req: Request, res: Response, next: NextFunction): void => {
        const contentLength = parseInt(req.headers['content-length'] || '0', 10);
        const maxBytes = parseSizeToBytes(maxSize);

        if (contentLength > maxBytes) {
            logFileUploadSecurityWarning(
                req, 
                `Payload too large: ${contentLength} bytes (max: ${maxSize})`
            );

            res.status(413).json({
                error: 'PAYLOAD_TOO_LARGE',
                message: `Request body too large. Maximum size is ${maxSize}.`,
                code: 'ZERO_TRUST_VIOLATION',
            });
            return;
        }

        next();
    };
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Parse size string to bytes
 */
const parseSizeToBytes = (size: string): number => {
    const units: Record<string, number> = {
        b: 1,
        kb: 1024,
        mb: 1024 * 1024,
        gb: 1024 * 1024 * 1024,
    };

    const match = size.toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/);

    if (!match) {
        return 10240; // Default 10kb
    }

    const value = parseFloat(match[1]);
    const unit = match[2] || 'b';

    return Math.round(value * (units[unit] || 1));
};

// ============================================
// EXPORTS
// ============================================

export default {
    rejectAllFileUploads,
    rejectMultipartUploads,
    rejectBinaryUploads,
    rejectBase64FileData,
    validateJsonPayload,
};
