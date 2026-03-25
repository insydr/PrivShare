/**
 * Room Manager for WebSocket Collaboration
 * ========================================
 * 
 * Manages collaborative rooms for real-time redaction sync.
 * Handles:
 * - Room creation and joining
 * - User presence tracking
 * - Redaction box synchronization
 * - WebRTC signaling relay
 * 
 * IMPORTANT: Only JSON metadata is exchanged - NO FILES
 */

import { WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger';

// ============================================
// TYPES
// ============================================

export interface User {
    id: string;
    name: string;
    socket: WebSocket;
    joinedAt: Date;
}

export interface Room {
    id: string;
    name: string;
    createdBy: string;
    createdAt: Date;
    users: Map<string, User>;
    documentMetadata: {
        width: number;
        height: number;
        format: string;
        originalHash: string;
    } | null;
}

export interface SignalingMessage {
    type: MessageType;
    roomId: string;
    userId: string;
    payload?: unknown;
    timestamp?: number;
}

export type MessageType =
    | 'join-room'
    | 'leave-room'
    | 'user-joined'
    | 'user-left'
    | 'redaction-sync'
    | 'cursor-sync'
    | 'offer'
    | 'answer'
    | 'ice-candidate'
    | 'room-state'
    | 'error'
    | 'pong';

export interface RedactionBox {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    type: 'auto' | 'manual';
    pageIndex: number;
    userId: string;
    timestamp: number;
}

export interface CursorPosition {
    x: number;
    y: number;
    userId: string;
    userName: string;
}

// ============================================
// ROOM MANAGER CLASS
// ============================================

export class RoomManager {
    private rooms: Map<string, Room> = new Map();
    private userRooms: Map<string, string> = new Map(); // userId -> roomId

    /**
     * Create a new room
     */
    createRoom(name: string, createdBy: string): Room {
        const roomId = uuidv4();
        const room: Room = {
            id: roomId,
            name,
            createdBy,
            createdAt: new Date(),
            users: new Map(),
            documentMetadata: null,
        };

        this.rooms.set(roomId, room);
        logger.info(`[RoomManager] Room created: ${roomId} by ${createdBy}`);

        return room;
    }

    /**
     * Get room by ID
     */
    getRoom(roomId: string): Room | undefined {
        return this.rooms.get(roomId);
    }

    /**
     * Join a room
     */
    joinRoom(roomId: string, userId: string, userName: string, socket: WebSocket): boolean {
        const room = this.rooms.get(roomId);

        if (!room) {
            logger.warn(`[RoomManager] Attempt to join non-existent room: ${roomId}`);
            return false;
        }

        // Check if user is already in another room
        const existingRoomId = this.userRooms.get(userId);
        if (existingRoomId && existingRoomId !== roomId) {
            this.leaveRoom(userId);
        }

        // Add user to room
        const user: User = {
            id: userId,
            name: userName,
            socket,
            joinedAt: new Date(),
        };

        room.users.set(userId, user);
        this.userRooms.set(userId, roomId);

        logger.info(`[RoomManager] User ${userId} (${userName}) joined room ${roomId}. Users: ${room.users.size}`);

        // Notify other users in the room
        this.broadcastToRoom(roomId, {
            type: 'user-joined',
            roomId,
            userId,
            payload: {
                userId,
                userName,
                joinedAt: user.joinedAt.toISOString(),
            },
        }, userId);

        return true;
    }

    /**
     * Leave a room
     */
    leaveRoom(userId: string): void {
        const roomId = this.userRooms.get(userId);

        if (!roomId) {
            return;
        }

        const room = this.rooms.get(roomId);

        if (room) {
            room.users.delete(userId);

            logger.info(`[RoomManager] User ${userId} left room ${roomId}. Users: ${room.users.size}`);

            // Notify other users
            this.broadcastToRoom(roomId, {
                type: 'user-left',
                roomId,
                userId,
                payload: { userId },
            });

            // Delete room if empty
            if (room.users.size === 0) {
                this.rooms.delete(roomId);
                logger.info(`[RoomManager] Room ${roomId} deleted (empty)`);
            }
        }

        this.userRooms.delete(userId);
    }

    /**
     * Get users in a room
     */
    getRoomUsers(roomId: string): User[] {
        const room = this.rooms.get(roomId);
        return room ? Array.from(room.users.values()) : [];
    }

    /**
     * Get room state for a new user
     */
    getRoomState(roomId: string): {
        roomId: string;
        name: string;
        users: Array<{ id: string; name: string }>;
        documentMetadata: Room['documentMetadata'];
    } | null {
        const room = this.rooms.get(roomId);

        if (!room) {
            return null;
        }

        return {
            roomId: room.id,
            name: room.name,
            users: Array.from(room.users.values()).map(u => ({
                id: u.id,
                name: u.name,
            })),
            documentMetadata: room.documentMetadata,
        };
    }

    /**
     * Set document metadata for a room
     */
    setDocumentMetadata(roomId: string, metadata: Room['documentMetadata']): void {
        const room = this.rooms.get(roomId);

        if (room) {
            room.documentMetadata = metadata;
            logger.info(`[RoomManager] Document metadata set for room ${roomId}`);
        }
    }

    /**
     * Broadcast message to all users in a room (except sender)
     */
    broadcastToRoom(roomId: string, message: SignalingMessage, excludeUserId?: string): void {
        const room = this.rooms.get(roomId);

        if (!room) {
            return;
        }

        const messageStr = JSON.stringify({
            ...message,
            timestamp: Date.now(),
        });

        room.users.forEach((user, userId) => {
            if (userId !== excludeUserId && user.socket.readyState === WebSocket.OPEN) {
                user.socket.send(messageStr);
            }
        });
    }

    /**
     * Send message to specific user
     */
    sendToUser(userId: string, message: SignalingMessage): boolean {
        const roomId = this.userRooms.get(userId);

        if (!roomId) {
            return false;
        }

        const room = this.rooms.get(roomId);

        if (!room) {
            return false;
        }

        const user = room.users.get(userId);

        if (user && user.socket.readyState === WebSocket.OPEN) {
            user.socket.send(JSON.stringify({
                ...message,
                timestamp: Date.now(),
            }));
            return true;
        }

        return false;
    }

    /**
     * Handle redaction sync - broadcast redaction boxes to other users
     */
    handleRedactionSync(roomId: string, userId: string, redactionBoxes: RedactionBox[]): void {
        logger.info(`[RoomManager] Redaction sync from ${userId} in room ${roomId}: ${redactionBoxes.length} boxes`);

        // Validate that this is NOT file data
        const boxesJson = JSON.stringify(redactionBoxes);
        if (boxesJson.length > 100 * 1024) { // 100KB limit for redaction data
            logger.warn(`[RoomManager] Redaction sync rejected - payload too large: ${boxesJson.length} bytes`);
            this.sendToUser(userId, {
                type: 'error',
                roomId,
                userId: 'system',
                payload: {
                    message: 'Redaction data too large. Only metadata is allowed.',
                    code: 'PAYLOAD_TOO_LARGE',
                },
            });
            return;
        }

        this.broadcastToRoom(roomId, {
            type: 'redaction-sync',
            roomId,
            userId,
            payload: {
                boxes: redactionBoxes,
                syncType: 'full', // or 'incremental'
            },
        }, userId);
    }

    /**
     * Handle cursor position sync
     */
    handleCursorSync(roomId: string, userId: string, position: CursorPosition): void {
        const room = this.rooms.get(roomId);

        if (!room) {
            return;
        }

        const user = room.users.get(userId);

        if (!user) {
            return;
        }

        // Broadcast cursor position with user info
        this.broadcastToRoom(roomId, {
            type: 'cursor-sync',
            roomId,
            userId,
            payload: {
                x: position.x,
                y: position.y,
                userId,
                userName: user.name,
            },
        }, userId);
    }

    /**
     * Handle WebRTC signaling
     */
    handleWebRTCSignaling(
        roomId: string,
        userId: string,
        type: 'offer' | 'answer' | 'ice-candidate',
        payload: unknown
    ): void {
        this.broadcastToRoom(roomId, {
            type,
            roomId,
            userId,
            payload,
        }, userId);
    }

    /**
     * Get all active rooms (for admin/debug)
     */
    getAllRooms(): Array<{ id: string; name: string; userCount: number }> {
        return Array.from(this.rooms.values()).map(room => ({
            id: room.id,
            name: room.name,
            userCount: room.users.size,
        }));
    }

    /**
     * Get statistics
     */
    getStats(): { totalRooms: number; totalUsers: number } {
        return {
            totalRooms: this.rooms.size,
            totalUsers: this.userRooms.size,
        };
    }

    /**
     * Clean up disconnected users
     */
    cleanupDisconnectedUsers(): void {
        this.rooms.forEach((room, roomId) => {
            room.users.forEach((user, userId) => {
                if (user.socket.readyState !== WebSocket.OPEN) {
                    logger.info(`[RoomManager] Cleaning up disconnected user: ${userId}`);
                    this.leaveRoom(userId);
                }
            });
        });
    }
}

// Export singleton instance
export const roomManager = new RoomManager();
