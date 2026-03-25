/**
 * WebSocket Handler
 * =================
 * 
 * Handles WebSocket connections for real-time collaboration.
 * Manages room joining, signaling, and redaction synchronization.
 */

import { WebSocket, WebSocketServer } from 'ws';
import { roomManager, SignalingMessage, MessageType } from '../utils/roomManager';
import logger from '../utils/logger';
import { verifyToken } from '../middleware/auth';

// ============================================
// TYPES
// ============================================

interface WebSocketClient {
    userId: string;
    userName: string;
    roomId: string | null;
    isAuthenticated: boolean;
    lastPing: number;
}

// ============================================
// CONFIGURATION
// ============================================

const MAX_MESSAGE_SIZE = 50 * 1024; // 50KB max for signaling messages
const PING_INTERVAL = 30000; // 30 seconds
const PING_TIMEOUT = 10000; // 10 seconds to respond to ping

// ============================================
// WEBSOCKET HANDLER
// ============================================

export const setupWebSocket = (wss: WebSocketServer): void => {
    const clients = new Map<WebSocket, WebSocketClient>();

    // Ping interval to check connection health
    setInterval(() => {
        clients.forEach((client, ws) => {
            if (Date.now() - client.lastPing > PING_INTERVAL + PING_TIMEOUT) {
                logger.warn(`[WebSocket] Client ${client.userId} timed out`);
                ws.terminate();
                return;
            }

            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'ping' }));
            }
        });
    }, PING_INTERVAL);

    wss.on('connection', (ws: WebSocket, req) => {
        const client: WebSocketClient = {
            userId: '',
            userName: '',
            roomId: null,
            isAuthenticated: false,
            lastPing: Date.now(),
        };

        clients.set(ws, client);

        // Extract auth token from query params or headers
        const url = new URL(req.url || '', `http://${req.headers.host}`);
        const token = url.searchParams.get('token') || 
                      (req.headers.authorization?.startsWith('Bearer ') 
                          ? req.headers.authorization.substring(7) 
                          : null);

        // Authenticate connection
        if (token) {
            const payload = verifyToken(token);
            if (payload) {
                client.userId = payload.userId;
                client.userName = payload.name;
                client.isAuthenticated = true;
                logger.info(`[WebSocket] Client authenticated: ${client.userId} (${client.userName})`);
            } else {
                ws.send(JSON.stringify({
                    type: 'error',
                    payload: {
                        message: 'Invalid or expired authentication token',
                        code: 'AUTH_INVALID',
                    },
                }));
                ws.close(1008, 'Authentication failed');
                return;
            }
        }

        logger.info(`[WebSocket] New connection established. Authenticated: ${client.isAuthenticated}`);

        // ============================================
        // MESSAGE HANDLER
        // ============================================

        ws.on('message', (data: Buffer) => {
            // Check message size
            if (data.length > MAX_MESSAGE_SIZE) {
                ws.send(JSON.stringify({
                    type: 'error',
                    payload: {
                        message: `Message too large. Maximum size is ${MAX_MESSAGE_SIZE / 1024}KB.`,
                        code: 'MESSAGE_TOO_LARGE',
                    },
                }));
                return;
            }

            try {
                const message: SignalingMessage = JSON.parse(data.toString());
                handleMessage(ws, client, message);
            } catch (error) {
                logger.error('[WebSocket] Failed to parse message:', error);
                ws.send(JSON.stringify({
                    type: 'error',
                    payload: {
                        message: 'Invalid message format. Expected JSON.',
                        code: 'INVALID_FORMAT',
                    },
                }));
            }
        });

        // ============================================
        // CLOSE HANDLER
        // ============================================

        ws.on('close', (code, reason) => {
            logger.info(`[WebSocket] Connection closed: ${client.userId}. Code: ${code}, Reason: ${reason}`);

            // Leave room if in one
            if (client.roomId) {
                roomManager.leaveRoom(client.userId);
            }

            clients.delete(ws);
        });

        // ============================================
        // ERROR HANDLER
        // ============================================

        ws.on('error', (error) => {
            logger.error(`[WebSocket] Error for client ${client.userId}:`, error);
        });

        // Send initial connection success message
        ws.send(JSON.stringify({
            type: 'connected',
            payload: {
                message: 'Connected to PrivShare signaling server',
                userId: client.userId,
                authenticated: client.isAuthenticated,
            },
        }));
    });

    // ============================================
    // MESSAGE ROUTER
    // ============================================

    function handleMessage(ws: WebSocket, client: WebSocketClient, message: SignalingMessage): void {
        const { type, roomId, userId, payload } = message;

        logger.debug(`[WebSocket] Received: ${type} from ${client.userId}`);

        switch (type) {
            case 'pong':
                client.lastPing = Date.now();
                break;

            case 'join-room':
                handleJoinRoom(ws, client, message);
                break;

            case 'leave-room':
                handleLeaveRoom(ws, client);
                break;

            case 'redaction-sync':
                handleRedactionSync(ws, client, message);
                break;

            case 'cursor-sync':
                handleCursorSync(ws, client, message);
                break;

            case 'offer':
            case 'answer':
            case 'ice-candidate':
                handleWebRTCSignaling(ws, client, message);
                break;

            default:
                ws.send(JSON.stringify({
                    type: 'error',
                    payload: {
                        message: `Unknown message type: ${type}`,
                        code: 'UNKNOWN_TYPE',
                    },
                }));
        }
    }

    // ============================================
    // ROOM HANDLERS
    // ============================================

    function handleJoinRoom(ws: WebSocket, client: WebSocketClient, message: SignalingMessage): void {
        const { roomId, payload } = message;
        const userName = (payload as { userName?: string })?.userName || client.userName || 'Anonymous';

        if (!client.isAuthenticated) {
            ws.send(JSON.stringify({
                type: 'error',
                payload: {
                    message: 'Authentication required to join rooms',
                    code: 'AUTH_REQUIRED',
                },
            }));
            return;
        }

        // Leave current room if in one
        if (client.roomId) {
            roomManager.leaveRoom(client.userId);
        }

        // Join new room
        const success = roomManager.joinRoom(roomId, client.userId, userName, ws);

        if (success) {
            client.roomId = roomId;

            // Send room state to the joining user
            const roomState = roomManager.getRoomState(roomId);

            ws.send(JSON.stringify({
                type: 'room-state',
                roomId,
                userId: client.userId,
                payload: roomState,
            }));

            logger.info(`[WebSocket] User ${client.userId} joined room ${roomId}`);
        } else {
            ws.send(JSON.stringify({
                type: 'error',
                roomId,
                userId: client.userId,
                payload: {
                    message: 'Room not found',
                    code: 'ROOM_NOT_FOUND',
                },
            }));
        }
    }

    function handleLeaveRoom(ws: WebSocket, client: WebSocketClient): void {
        if (client.roomId) {
            roomManager.leaveRoom(client.userId);
            client.roomId = null;

            ws.send(JSON.stringify({
                type: 'left-room',
                userId: client.userId,
                payload: {
                    message: 'Successfully left the room',
                },
            }));

            logger.info(`[WebSocket] User ${client.userId} left room`);
        }
    }

    // ============================================
    // REDACTION SYNC HANDLER
    // ============================================

    function handleRedactionSync(ws: WebSocket, client: WebSocketClient, message: SignalingMessage): void {
        if (!client.roomId) {
            ws.send(JSON.stringify({
                type: 'error',
                payload: {
                    message: 'Not in a room. Join a room first.',
                    code: 'NOT_IN_ROOM',
                },
            }));
            return;
        }

        const payload = message.payload as { boxes?: unknown[] };
        const boxes = payload.boxes || [];

        // Security check: Ensure boxes don't contain file data
        const boxesJson = JSON.stringify(boxes);
        
        // Check for base64 image data
        if (/data:image\//.test(boxesJson)) {
            logSecurityViolation(ws, client, 'Base64 image data detected in redaction boxes');
            return;
        }

        // Check for excessive size
        if (boxesJson.length > 10 * 1024) { // 10KB
            ws.send(JSON.stringify({
                type: 'error',
                payload: {
                    message: 'Redaction data too large. Only coordinates are allowed.',
                    code: 'PAYLOAD_TOO_LARGE',
                },
            }));
            return;
        }

        // Broadcast to other users in room
        roomManager.handleRedactionSync(client.roomId, client.userId, boxes as never[]);
    }

    // ============================================
    // CURSOR SYNC HANDLER
    // ============================================

    function handleCursorSync(ws: WebSocket, client: WebSocketClient, message: SignalingMessage): void {
        if (!client.roomId) {
            return; // Silently ignore if not in room
        }

        const payload = message.payload as { x: number; y: number };
        
        roomManager.handleCursorSync(client.roomId, client.userId, {
            x: payload.x,
            y: payload.y,
            userId: client.userId,
            userName: client.userName,
        });
    }

    // ============================================
    // WEBRTC SIGNALING HANDLER
    // ============================================

    function handleWebRTCSignaling(ws: WebSocket, client: WebSocketClient, message: SignalingMessage): void {
        if (!client.roomId) {
            ws.send(JSON.stringify({
                type: 'error',
                payload: {
                    message: 'Not in a room. Join a room first.',
                    code: 'NOT_IN_ROOM',
                },
            }));
            return;
        }

        const validTypes: MessageType[] = ['offer', 'answer', 'ice-candidate'];
        
        if (validTypes.includes(message.type)) {
            roomManager.handleWebRTCSignaling(
                client.roomId,
                client.userId,
                message.type,
                message.payload
            );
        }
    }

    // ============================================
    // SECURITY VIOLATION LOGGER
    // ============================================

    function logSecurityViolation(ws: WebSocket, client: WebSocketClient, reason: string): void {
        logger.error(`[SECURITY] WebSocket violation by ${client.userId}: ${reason}`);

        console.warn('');
        console.warn('╔══════════════════════════════════════════════════════════════════╗');
        console.warn('│           ⚠️  SECURITY WARNING: WEBSOCKET VIOLATION               │');
        console.warn('╠══════════════════════════════════════════════════════════════════╣');
        console.warn(`│  User ID:   ${client.userId.padEnd(49)}│`);
        console.warn(`│  Reason:    ${reason.padEnd(49)}│`);
        console.warn('╚══════════════════════════════════════════════════════════════════╝');
        console.warn('');

        ws.send(JSON.stringify({
            type: 'error',
            payload: {
                message: 'Security violation detected. Connection terminated.',
                code: 'SECURITY_VIOLATION',
            },
        }));

        ws.close(1011, 'Security violation');
    }
};

export default setupWebSocket;
