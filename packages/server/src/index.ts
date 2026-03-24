/**
 * PrivShare Server - Signaling Only Backend
 * 
 * CRITICAL SECURITY REQUIREMENT:
 * This server implements a Zero-Trust architecture where:
 * - NO FILE UPLOADS are accepted under any circumstances
 * - Only JSON metadata is processed for signaling
 * - WebRTC signaling happens through this server
 * - Original documents NEVER touch the server
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import helmet from 'helmet';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';

dotenv.config();

const app: Express = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Configuration
const PORT = process.env.PORT || 3001;
const MAX_JSON_PAYLOAD = '10kb'; // Strict limit for metadata-only payloads

// ============================================
// SECURITY MIDDLEWARE
// ============================================

// Helmet for security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'", 'ws:', 'wss:'],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: true,
  crossOriginOpenerPolicy: true,
  crossOriginResourcePolicy: { policy: 'same-origin' },
}));

// CORS configuration
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ============================================
// ZERO-TRUST FILE UPLOAD PREVENTION
// ============================================

/**
 * Middleware that strictly enforces NO FILE UPLOADS
 * This is the core of the Zero-Trust architecture requirement:
 * "The backend will NOT accept file uploads"
 */

// Reject any request with multipart/form-data (file uploads)
const rejectFileUploads = (req: Request, res: Response, next: NextFunction): void => {
  const contentType = req.headers['content-type'] || '';
  
  // Reject multipart/form-data (used for file uploads)
  if (contentType.includes('multipart/form-data')) {
    res.status(415).json({
      error: 'UNSUPPORTED_MEDIA_TYPE',
      message: 'File uploads are not permitted. PrivShare enforces a Zero-Trust architecture where files never leave your device.',
      code: 'ZERO_TRUST_VIOLATION',
    });
    return;
  }
  
  // Reject application/octet-stream (binary file data)
  if (contentType.includes('application/octet-stream')) {
    res.status(415).json({
      error: 'UNSUPPORTED_MEDIA_TYPE',
      message: 'Binary data uploads are not permitted. PrivShare enforces a Zero-Trust architecture.',
      code: 'ZERO_TRUST_VIOLATION',
    });
    return;
  }
  
  next();
};

// Apply file upload rejection to all routes
app.use(rejectFileUploads);

// Strict payload size limit - only JSON metadata
app.use(express.json({ 
  limit: MAX_JSON_PAYLOAD,
  strict: true,
  type: ['application/json'],
}));

// Additional validation: Reject if body contains file-like data
const validateJsonPayload = (req: Request, res: Response, next: NextFunction): void => {
  if (req.body) {
    const bodyString = JSON.stringify(req.body);
    
    // Check for base64-encoded data that might be file content
    const base64Pattern = /data:[a-zA-Z0-9]+\/[a-zA-Z0-9.+_-]+;base64,[A-Za-z0-9+/=]{100,}/;
    if (base64Pattern.test(bodyString)) {
      res.status(400).json({
        error: 'INVALID_PAYLOAD',
        message: 'Base64-encoded file data is not permitted in requests.',
        code: 'ZERO_TRUST_VIOLATION',
      });
      return;
    }
    
    // Check for ArrayBuffer-like structures
    if (req.body.data && Array.isArray(req.body.data) && req.body.data.length > 1000) {
      res.status(400).json({
        error: 'INVALID_PAYLOAD',
        message: 'Array-like binary data is not permitted. Only metadata is allowed.',
        code: 'ZERO_TRUST_VIOLATION',
      });
      return;
    }
  }
  
  next();
};

app.use(validateJsonPayload);

// ============================================
// HEALTH CHECK
// ============================================

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ 
    status: 'healthy', 
    version: '1.0.0',
    architecture: 'zero-trust',
    fileUploads: 'DISABLED',
  });
});

// ============================================
// SESSION MANAGEMENT (Signaling Only)
// ============================================

interface CollabSession {
  id: string;
  name: string;
  createdBy: string;
  createdAt: Date;
  participants: Set<string>;
}

const sessions = new Map<string, CollabSession>();

// Create a new collaboration session
app.post('/api/sessions', (req: Request, res: Response) => {
  const { name, createdBy } = req.body;
  
  if (!name || !createdBy) {
    res.status(400).json({
      error: 'MISSING_FIELDS',
      message: 'Session name and createdBy are required.',
    });
    return;
  }
  
  const sessionId = uuidv4();
  const session: CollabSession = {
    id: sessionId,
    name,
    createdBy,
    createdAt: new Date(),
    participants: new Set([createdBy]),
  };
  
  sessions.set(sessionId, session);
  
  res.status(201).json({
    sessionId: session.id,
    name: session.name,
    createdAt: session.createdAt,
  });
});

// Get session info
app.get('/api/sessions/:sessionId', (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  
  if (!session) {
    res.status(404).json({
      error: 'SESSION_NOT_FOUND',
      message: 'The requested session does not exist.',
    });
    return;
  }
  
  res.json({
    sessionId: session.id,
    name: session.name,
    createdAt: session.createdAt,
    participantCount: session.participants.size,
  });
});

// ============================================
// WEBRTC SIGNALING (WebSocket)
// ============================================

interface SignalingMessage {
  type: 'join' | 'offer' | 'answer' | 'ice-candidate' | 'redaction-sync' | 'leave';
  sessionId: string;
  userId: string;
  payload?: unknown;
}

const userSockets = new Map<string, WebSocket>();

wss.on('connection', (ws: WebSocket) => {
  let currentUserId: string | null = null;
  let currentSessionId: string | null = null;
  
  console.log('[WebSocket] New connection established');
  
  ws.on('message', (data: Buffer) => {
    try {
      const message: SignalingMessage = JSON.parse(data.toString());
      
      // Validate message size (prevent large payloads)
      if (data.length > 50 * 1024) { // 50KB max
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Message too large. Only metadata is allowed.',
          code: 'ZERO_TRUST_VIOLATION',
        }));
        return;
      }
      
      switch (message.type) {
        case 'join':
          currentUserId = message.userId;
          currentSessionId = message.sessionId;
          userSockets.set(currentUserId, ws);
          
          const session = sessions.get(currentSessionId);
          if (session) {
            session.participants.add(currentUserId);
          }
          
          console.log(`[WebSocket] User ${currentUserId} joined session ${currentSessionId}`);
          break;
          
        case 'offer':
        case 'answer':
        case 'ice-candidate':
          // WebRTC signaling - relay to other participants
          if (!currentSessionId) break;
          
          const targetSession = sessions.get(currentSessionId);
          if (targetSession) {
            targetSession.participants.forEach((participantId) => {
              if (participantId !== currentUserId) {
                const participantWs = userSockets.get(participantId);
                if (participantWs && participantWs.readyState === WebSocket.OPEN) {
                  participantWs.send(JSON.stringify({
                    type: message.type,
                    userId: currentUserId,
                    payload: message.payload,
                  }));
                }
              }
            });
          }
          break;
          
        case 'redaction-sync':
          // Sync redaction coordinates (metadata only, no file data)
          if (!currentSessionId) break;
          
          const syncSession = sessions.get(currentSessionId);
          if (syncSession) {
            syncSession.participants.forEach((participantId) => {
              if (participantId !== currentUserId) {
                const participantWs = userSockets.get(participantId);
                if (participantWs && participantWs.readyState === WebSocket.OPEN) {
                  participantWs.send(JSON.stringify({
                    type: 'redaction-sync',
                    userId: currentUserId,
                    payload: message.payload,
                  }));
                }
              }
            });
          }
          break;
          
        case 'leave':
          if (currentUserId && currentSessionId) {
            const leaveSession = sessions.get(currentSessionId);
            if (leaveSession) {
              leaveSession.participants.delete(currentUserId);
            }
            userSockets.delete(currentUserId);
          }
          break;
      }
    } catch (error) {
      console.error('[WebSocket] Error processing message:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Failed to process message.',
      }));
    }
  });
  
  ws.on('close', () => {
    if (currentUserId && currentSessionId) {
      const session = sessions.get(currentSessionId);
      if (session) {
        session.participants.delete(currentUserId);
      }
      userSockets.delete(currentUserId);
      console.log(`[WebSocket] User ${currentUserId} disconnected`);
    }
  });
  
  ws.on('error', (error) => {
    console.error('[WebSocket] Error:', error);
  });
});

// ============================================
// START SERVER
// ============================================

server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                    PrivShare Server                        ║
╠════════════════════════════════════════════════════════════╣
║  Status: Running                                            ║
║  Port: ${PORT}                                                   ║
║  Architecture: ZERO-TRUST                                   ║
║  File Uploads: DISABLED                                     ║
║  Allowed Payloads: JSON metadata only (max ${MAX_JSON_PAYLOAD})          ║
╚════════════════════════════════════════════════════════════╝
  `);
});

export { app, server, wss };
