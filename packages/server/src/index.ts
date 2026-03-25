/**
 * PrivShare Signaling Server
 * ==========================
 * 
 * Zero-Trust Architecture Backend
 * 
 * CRITICAL REQUIREMENTS:
 * - NO FILE STORAGE: This server never stores or processes uploaded files
 * - SIGNALING ONLY: Only JSON metadata for WebSocket coordination
 * - REAL-TIME SYNC: Coordinates redaction boxes between collaborators
 * - P2P TRANSFER: Final files are sent peer-to-peer via WebRTC
 * 
 * Architecture:
 * ┌─────────────────────────────────────────────────────┐
 * │                    Client A                         │
 * │  ┌──────────────┐     ┌──────────────────────┐     │
 * │  │ WASM Worker  │     │ Document + Redactions │     │
 * │  └──────────────┘     └──────────────────────┘     │
 * └─────────────────────┬───────────────────────────────┘
 *                       │ WebSocket (JSON metadata only)
 *                       ▼
 * ┌─────────────────────────────────────────────────────┐
 * │              PrivShare Signaling Server             │
 * │  ┌──────────────┐  ┌──────────────┐                │
 * │  │ Room Manager │  │   WebSocket  │                │
 * │  └──────────────┘  └──────────────┘                │
 * │  - Coordinates user sessions                       │
 * │  - Relays redaction box coordinates                │
 * │  - Handles WebRTC signaling                        │
 * │  - NO FILE STORAGE                                 │
 * └─────────────────────┬───────────────────────────────┘
 *                       │ WebSocket (JSON metadata only)
 *                       ▼
 * ┌─────────────────────────────────────────────────────┐
 * │                    Client B                         │
 * │  ┌──────────────┐     ┌──────────────────────┐     │
 * │  │ WASM Worker  │     │ Document + Redactions │     │
 * │  └──────────────┘     └──────────────────────┘     │
 * └─────────────────────────────────────────────────────┘
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

// Routes
import authRoutes from './routes/auth';
import sessionRoutes from './routes/sessionRoutes';

// Middleware
import { 
    rejectAllFileUploads, 
    rejectBase64FileData, 
    validateJsonPayload 
} from './middleware/fileUploadRejection';

// WebSocket
import setupWebSocket from './utils/websocketHandler';

// Logger
import logger from './utils/logger';

// Load environment variables
dotenv.config();

// ============================================
// CONFIGURATION
// ============================================

const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';
const MAX_JSON_PAYLOAD = process.env.MAX_JSON_PAYLOAD || '10kb';

// ============================================
// EXPRESS APP SETUP
// ============================================

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// ============================================
// SECURITY MIDDLEWARE
// ============================================

// Helmet - Security headers
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:', 'blob:'],
            connectSrc: ["'self'", 'ws:', 'wss:', CLIENT_URL],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
        },
    },
    crossOriginEmbedderPolicy: true,
    crossOriginOpenerPolicy: true,
    crossOriginResourcePolicy: { policy: 'same-origin' },
}));

// CORS
app.use(cors({
    origin: NODE_ENV === 'production' 
        ? [CLIENT_URL, process.env.PRODUCTION_URL].filter(Boolean)
        : CLIENT_URL,
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per window
    message: {
        error: 'TOO_MANY_REQUESTS',
        message: 'Too many requests from this IP. Please try again later.',
    },
    standardHeaders: true,
    legacyHeaders: false,
});

app.use('/api/', limiter);

// ============================================
// ZERO-TRUST FILE UPLOAD PREVENTION
// ============================================

console.log('');
console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║        PrivShare Zero-Trust Architecture                    ║');
console.log('╠════════════════════════════════════════════════════════════╣');
console.log('║  FILE UPLOADS:  ❌ DISABLED (Rejected with 415)             ║');
console.log('║  FILE STORAGE:  ❌ DISABLED (No persistent storage)         ║');
console.log('║  ALLOWED DATA:  ✓ JSON metadata only                        ║');
console.log('║  MAX PAYLOAD:   ' + MAX_JSON_PAYLOAD.toString().padEnd(44) + '║');
console.log('╚════════════════════════════════════════════════════════════╝');
console.log('');

// Apply file upload rejection middleware
app.use(rejectAllFileUploads);

// JSON body parser with strict limits
app.use(express.json({
    limit: MAX_JSON_PAYLOAD,
    strict: true,
    type: ['application/json'],
}));

// Validate JSON payload content
app.use(validateJsonPayload(MAX_JSON_PAYLOAD));
app.use(rejectBase64FileData);

// ============================================
// REQUEST LOGGING
// ============================================

app.use((req, res, next) => {
    logger.info(`[HTTP] ${req.method} ${req.path}`, {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
    });
    next();
});

// ============================================
// API ROUTES
// ============================================

app.use('/api/auth', authRoutes);
app.use('/api', sessionRoutes);

// Root endpoint
app.get('/', (_req, res) => {
    res.json({
        name: 'PrivShare Signaling Server',
        version: '1.0.0',
        architecture: 'zero-trust',
        fileUploads: 'DISABLED',
        description: 'Real-time collaboration signaling server. No files are stored.',
        endpoints: {
            health: 'GET /api/health',
            auth: {
                register: 'POST /api/auth/register',
                login: 'POST /api/auth/login',
                verify: 'GET /api/auth/verify',
            },
            sessions: {
                create: 'POST /api/sessions',
                get: 'GET /api/sessions/:sessionId',
                list: 'GET /api/sessions',
                stats: 'GET /api/sessions/stats',
            },
            websocket: 'ws://HOST/ws?roomId=XXX&userId=XXX&token=XXX',
        },
    });
});

// ============================================
// ERROR HANDLING
// ============================================

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        error: 'NOT_FOUND',
        message: 'The requested endpoint does not exist.',
        path: req.path,
    });
});

// Global error handler
app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error('[HTTP] Unhandled error:', err);

    // Check if it's a payload too large error
    if (err.message.includes('too large')) {
        res.status(413).json({
            error: 'PAYLOAD_TOO_LARGE',
            message: `Request body too large. Maximum size is ${MAX_JSON_PAYLOAD}.`,
            code: 'ZERO_TRUST_VIOLATION',
        });
        return;
    }

    // Check if it's a JSON parsing error
    if (err.message.includes('JSON') || err.message.includes('parse')) {
        res.status(400).json({
            error: 'INVALID_JSON',
            message: 'Invalid JSON in request body.',
        });
        return;
    }

    res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: NODE_ENV === 'production' 
            ? 'An internal error occurred.' 
            : err.message,
    });
});

// ============================================
// WEBSOCKET SETUP
// ============================================

setupWebSocket(wss);

// ============================================
// GRACEFUL SHUTDOWN
// ============================================

const gracefulShutdown = () => {
    logger.info('[Server] Received shutdown signal. Closing connections...');
    
    wss.clients.forEach((client) => {
        client.close(1001, 'Server shutting down');
    });

    server.close(() => {
        logger.info('[Server] HTTP server closed');
        process.exit(0);
    });

    // Force close after 10 seconds
    setTimeout(() => {
        logger.error('[Server] Forced shutdown after timeout');
        process.exit(1);
    }, 10000);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// ============================================
// START SERVER
// ============================================

server.listen(PORT, () => {
    console.log('');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                  PrivShare Server                           ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log(`║  Status:        Running                                      ║`);
    console.log(`║  Port:          ${PORT.toString().padEnd(44)}║`);
    console.log(`║  Environment:   ${NODE_ENV.padEnd(44)}║`);
    console.log(`║  Architecture:  ZERO-TRUST                                  ║`);
    console.log(`║  File Uploads:  ❌ DISABLED                                  ║`);
    console.log(`║  WebSocket:     ws://localhost:${PORT}/ws`.padEnd(62) + '║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('');

    logger.info(`[Server] PrivShare signaling server started on port ${PORT}`);
});

export { app, server, wss };
