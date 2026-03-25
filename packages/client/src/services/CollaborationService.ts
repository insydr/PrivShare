/**
 * CollaborationService
 * =====================
 * 
 * WebSocket client service for real-time collaboration.
 * Handles connection management, room operations, and message routing.
 * 
 * IMPORTANT: Only syncs JSON metadata - NO FILE DATA is ever transmitted.
 */

import type {
    ConnectionState,
    ServerMessage,
    CollaborationServiceOptions,
    CollaborationServiceCallbacks,
    SyncedRedactionBox,
    CursorPosition,
} from '../types/collaboration';
import { getUserColor as getUserColorFn } from '../types/collaboration';

// ============================================
// CONFIGURATION
// ============================================

const DEFAULT_RECONNECT_ATTEMPTS = 5;
const DEFAULT_RECONNECT_DELAY = 2000;
const DEFAULT_HEARTBEAT_INTERVAL = 30000;
const MAX_MESSAGE_SIZE = 50 * 1024; // 50KB

// ============================================
// TYPE IMPORTS FOR MESSAGE HANDLING
// ============================================

interface ConnectedPayload {
    message: string;
    userId: string;
    authenticated: boolean;
}

interface ErrorPayload {
    message: string;
    code: string;
}

// ============================================
// COLLABORATION SERVICE CLASS
// ============================================

export class CollaborationService {
    // ============================================
    // PRIVATE PROPERTIES
    // ============================================

    private ws: WebSocket | null = null;
    private options: Required<CollaborationServiceOptions>;
    private callbacks: CollaborationServiceCallbacks = {};
    private reconnectAttempts = 0;
    private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
    private connectionState: ConnectionState = 'disconnected';
    private currentRoomId: string | null = null;
    private currentUserId: string | null = null;
    private pendingMessages: Array<{ type: string; payload?: unknown; roomId?: string; userId?: string }> = [];
    private lastCursorSync = 0;

    // ============================================
    // CONSTRUCTOR
    // ============================================

    constructor(options: CollaborationServiceOptions) {
        this.options = {
            serverUrl: options.serverUrl,
            token: options.token || '',
            reconnectAttempts: options.reconnectAttempts ?? DEFAULT_RECONNECT_ATTEMPTS,
            reconnectDelay: options.reconnectDelay ?? DEFAULT_RECONNECT_DELAY,
            heartbeatInterval: options.heartbeatInterval ?? DEFAULT_HEARTBEAT_INTERVAL,
            debug: options.debug ?? false,
        };

        this.log('CollaborationService created with options:', this.options);
    }

    // ============================================
    // PUBLIC METHODS
    // ============================================

    /**
     * Set event callbacks
     */
    setCallbacks(callbacks: CollaborationServiceCallbacks): void {
        this.callbacks = { ...this.callbacks, ...callbacks };
    }

    /**
     * Get current connection state
     */
    getConnectionState(): ConnectionState {
        return this.connectionState;
    }

    /**
     * Get current user ID
     */
    getCurrentUserId(): string | null {
        return this.currentUserId;
    }

    /**
     * Get current room ID
     */
    getCurrentRoomId(): string | null {
        return this.currentRoomId;
    }

    /**
     * Connect to the WebSocket server
     */
    connect(token?: string): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                this.log('Already connected');
                resolve();
                return;
            }

            this.updateConnectionState('connecting');
            this.clearReconnectTimeout();

            // Build WebSocket URL with token
            const wsToken = token || this.options.token;
            const wsUrl = `${this.options.serverUrl}/ws?token=${encodeURIComponent(wsToken)}`;

            this.log('Connecting to:', wsUrl);

            try {
                this.ws = new WebSocket(wsUrl);

                // Connection timeout
                const connectionTimeout = setTimeout(() => {
                    if (this.ws?.readyState !== WebSocket.OPEN) {
                        this.log('Connection timeout');
                        this.ws?.close();
                        reject(new Error('Connection timeout'));
                    }
                }, 10000);

                this.ws.onopen = () => {
                    clearTimeout(connectionTimeout);
                    this.log('WebSocket connected');
                    this.reconnectAttempts = 0;
                    this.updateConnectionState('connected');
                    this.startHeartbeat();
                    this.flushPendingMessages();
                    resolve();
                };

                this.ws.onmessage = (event) => {
                    this.handleMessage(event.data);
                };

                this.ws.onerror = (error) => {
                    clearTimeout(connectionTimeout);
                    this.log('WebSocket error:', error);
                    this.updateConnectionState('error');
                    this.callbacks.onError?.({
                        message: 'WebSocket connection error',
                        code: 'WS_ERROR',
                    });
                    reject(error);
                };

                this.ws.onclose = (event) => {
                    clearTimeout(connectionTimeout);
                    this.log('WebSocket closed:', event.code, event.reason);
                    this.handleDisconnect();
                };

            } catch (error) {
                this.log('Failed to create WebSocket:', error);
                this.updateConnectionState('error');
                reject(error);
            }
        });
    }

    /**
     * Disconnect from the WebSocket server
     */
    disconnect(): void {
        this.log('Disconnecting...');
        this.clearReconnectTimeout();
        this.stopHeartbeat();

        if (this.ws) {
            this.ws.close(1000, 'Client disconnect');
            this.ws = null;
        }

        this.currentRoomId = null;
        this.updateConnectionState('disconnected');
    }

    /**
     * Join a collaboration room
     */
    joinRoom(roomId: string, userName?: string): void {
        this.log('Joining room:', roomId);
        this.currentRoomId = roomId;

        this.send({
            type: 'join-room',
            roomId,
            payload: { userName },
        });
    }

    /**
     * Leave the current room
     */
    leaveRoom(): void {
        if (!this.currentRoomId) return;

        this.log('Leaving room:', this.currentRoomId);

        this.send({
            type: 'leave-room',
            roomId: this.currentRoomId,
        });

        this.currentRoomId = null;
    }

    /**
     * Sync redaction boxes to other collaborators
     */
    syncRedactions(boxes: SyncedRedactionBox[]): void {
        if (!this.currentRoomId) {
            this.log('Cannot sync redactions: not in a room');
            return;
        }

        // Validate message size
        const payload = { boxes };
        const payloadSize = JSON.stringify(payload).length;

        if (payloadSize > MAX_MESSAGE_SIZE) {
            this.log('Redaction sync payload too large:', payloadSize);
            this.callbacks.onError?.({
                message: 'Redaction data too large. Reduce the number of boxes.',
                code: 'PAYLOAD_TOO_LARGE',
            });
            return;
        }

        this.log('Syncing', boxes.length, 'redaction boxes');

        this.send({
            type: 'redaction-sync',
            roomId: this.currentRoomId,
            userId: this.currentUserId || undefined,
            payload,
        });
    }

    /**
     * Sync cursor position to other collaborators
     */
    syncCursor(x: number, y: number): void {
        if (!this.currentRoomId || !this.currentUserId) return;

        // Throttle cursor updates (only send every 50ms)
        if (this.lastCursorSync && Date.now() - this.lastCursorSync < 50) {
            return;
        }
        this.lastCursorSync = Date.now();

        this.send({
            type: 'cursor-sync',
            roomId: this.currentRoomId,
            userId: this.currentUserId,
            payload: { x, y },
        });
    }

    /**
     * Destroy the service and cleanup
     */
    destroy(): void {
        this.log('Destroying CollaborationService');
        this.disconnect();
        this.callbacks = {};
        this.pendingMessages = [];
    }

    // ============================================
    // PRIVATE METHODS
    // ============================================

    /**
     * Handle incoming WebSocket message
     */
    private handleMessage(data: string): void {
        try {
            const message: ServerMessage = JSON.parse(data);
            this.log('Received message:', message.type);

            switch (message.type) {
                case 'connected':
                    this.handleConnected(message.payload as ConnectedPayload);
                    break;

                case 'room-state':
                    this.handleRoomState(message);
                    break;

                case 'user-joined':
                    this.handleUserJoined(message);
                    break;

                case 'user-left':
                    this.handleUserLeft(message);
                    break;

                case 'redaction-sync':
                    this.handleRedactionSync(message);
                    break;

                case 'cursor-sync':
                    this.handleCursorSync(message);
                    break;

                case 'error':
                    this.handleError(message.payload as ErrorPayload);
                    break;

                case 'pong':
                    // Heartbeat response - no action needed
                    break;

                default:
                    this.log('Unknown message type:', (message as { type: string }).type);
            }

        } catch (error) {
            this.log('Failed to parse message:', error);
        }
    }

    /**
     * Handle connected message from server
     */
    private handleConnected(payload: ConnectedPayload): void {
        this.log('Server confirmed connection. User ID:', payload.userId);
        this.currentUserId = payload.userId;
    }

    /**
     * Handle room state message
     */
    private handleRoomState(message: { roomId: string; payload: unknown }): void {
        this.log('Room state received:', message.payload);
        this.callbacks.onRoomState?.(message.payload as Parameters<NonNullable<CollaborationServiceCallbacks['onRoomState']>>[0]);
    }

    /**
     * Handle user joined message
     */
    private handleUserJoined(message: { roomId: string; payload: { userId: string; userName: string } }): void {
        this.log('User joined:', message.payload.userName);
        this.callbacks.onUserJoined?.({
            id: message.payload.userId,
            name: message.payload.userName,
        });
    }

    /**
     * Handle user left message
     */
    private handleUserLeft(message: { roomId: string; payload: { userId: string } }): void {
        this.log('User left:', message.payload.userId);
        this.callbacks.onUserLeft?.(message.payload.userId);
    }

    /**
     * Handle redaction sync message
     */
    private handleRedactionSync(message: { roomId: string; userId: string; payload: { boxes: SyncedRedactionBox[] } }): void {
        this.log('Redaction sync from:', message.userId, 'boxes:', message.payload.boxes.length);
        this.callbacks.onRedactionSync?.(message.payload.boxes, message.userId);
    }

    /**
     * Handle cursor sync message
     */
    private handleCursorSync(message: { roomId: string; userId: string; payload: { x: number; y: number }; timestamp?: number }): void {
        const cursor: CursorPosition = {
            ...message.payload,
            userId: message.userId,
            userName: '', // Will be filled by callback
            color: getUserColorFn(message.userId),
            timestamp: message.timestamp || Date.now(),
        };
        this.callbacks.onCursorSync?.(cursor);
    }

    /**
     * Handle error message
     */
    private handleError(payload: ErrorPayload): void {
        this.log('Server error:', payload);
        this.callbacks.onError?.(payload);
    }

    /**
     * Handle unexpected disconnect
     */
    private handleDisconnect(): void {
        this.stopHeartbeat();

        if (this.connectionState !== 'disconnected') {
            this.attemptReconnect();
        }
    }

    /**
     * Attempt to reconnect after disconnect
     */
    private attemptReconnect(): void {
        if (this.reconnectAttempts >= this.options.reconnectAttempts) {
            this.log('Max reconnect attempts reached');
            this.updateConnectionState('error');
            this.callbacks.onError?.({
                message: 'Connection lost. Please refresh the page.',
                code: 'CONNECTION_LOST',
            });
            return;
        }

        this.reconnectAttempts++;
        this.log(`Reconnecting... Attempt ${this.reconnectAttempts}/${this.options.reconnectAttempts}`);

        this.updateConnectionState('connecting');

        this.reconnectTimeout = setTimeout(() => {
            this.connect().catch(() => {
                // Error handling is done in connect()
            });
        }, this.options.reconnectDelay * this.reconnectAttempts);
    }

    /**
     * Send a message to the server
     */
    private send(message: { type: string; payload?: unknown; roomId?: string; userId?: string }): void {
        if (this.ws?.readyState !== WebSocket.OPEN) {
            this.log('WebSocket not open, queueing message');
            this.pendingMessages.push(message);
            return;
        }

        const messageStr = JSON.stringify(message);

        if (messageStr.length > MAX_MESSAGE_SIZE) {
            this.log('Message too large, not sending');
            return;
        }

        this.ws.send(messageStr);
    }

    /**
     * Send pending messages after connection
     */
    private flushPendingMessages(): void {
        while (this.pendingMessages.length > 0 && this.ws?.readyState === WebSocket.OPEN) {
            const message = this.pendingMessages.shift();
            if (message) {
                this.send(message);
            }
        }
    }

    /**
     * Start heartbeat interval
     */
    private startHeartbeat(): void {
        this.stopHeartbeat();
        this.heartbeatInterval = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ type: 'pong' }));
            }
        }, this.options.heartbeatInterval);
    }

    /**
     * Stop heartbeat interval
     */
    private stopHeartbeat(): void {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    /**
     * Clear reconnect timeout
     */
    private clearReconnectTimeout(): void {
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
    }

    /**
     * Update connection state and notify callback
     */
    private updateConnectionState(state: ConnectionState): void {
        this.connectionState = state;
        this.callbacks.onConnectionChange?.(state);
    }

    /**
     * Debug logging
     */
    private log(message: string, ...args: unknown[]): void {
        if (this.options.debug) {
            console.log(`[CollaborationService] ${message}`, ...args);
        }
    }
}

// ============================================
// SINGLETON INSTANCE
// ============================================

let serviceInstance: CollaborationService | null = null;

/**
 * Get or create the CollaborationService singleton
 */
export function getCollaborationService(
    options?: CollaborationServiceOptions
): CollaborationService {
    if (!serviceInstance && options) {
        serviceInstance = new CollaborationService(options);
    }

    if (!serviceInstance) {
        throw new Error('CollaborationService not initialized. Call with options first.');
    }

    return serviceInstance;
}

/**
 * Destroy the singleton instance
 */
export function destroyCollaborationService(): void {
    if (serviceInstance) {
        serviceInstance.destroy();
        serviceInstance = null;
    }
}

export default CollaborationService;
