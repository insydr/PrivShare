/**
 * Collaboration Types
 * ===================
 * 
 * Type definitions for real-time collaboration features.
 * Handles WebSocket communication, cursor tracking, and redaction sync.
 */

import type { RedactionBox } from './canvas';

// Re-export RedactionBox for convenience
export type { RedactionBox } from './canvas';

// ============================================
// USER TYPES
// ============================================

/**
 * Collaborator user info
 */
export interface Collaborator {
    id: string;
    name: string;
    color: string; // Unique color for cursor
    joinedAt: Date;
    isOnline: boolean;
}

/**
 * Cursor position with user info
 */
export interface CursorPosition {
    x: number;
    y: number;
    userId: string;
    userName: string;
    color: string;
    timestamp: number;
}

// ============================================
// WEBSOCKET MESSAGE TYPES
// ============================================

/**
 * WebSocket connection states
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * Message types from server to client
 */
export type ServerMessageType =
    | 'connected'
    | 'room-state'
    | 'user-joined'
    | 'user-left'
    | 'redaction-sync'
    | 'cursor-sync'
    | 'error'
    | 'pong';

/**
 * Message types from client to server
 */
export type ClientMessageType =
    | 'join-room'
    | 'leave-room'
    | 'redaction-sync'
    | 'cursor-sync'
    | 'pong';

/**
 * Base message structure
 */
export interface BaseMessage {
    type: string;
    roomId?: string;
    userId?: string;
    payload?: unknown;
    timestamp?: number;
}

/**
 * Server connected message
 */
export interface ConnectedMessage extends BaseMessage {
    type: 'connected';
    payload: {
        message: string;
        userId: string;
        authenticated: boolean;
    };
}

/**
 * Room state message
 */
export interface RoomStateMessage extends BaseMessage {
    type: 'room-state';
    roomId: string;
    payload: {
        roomId: string;
        name: string;
        users: Array<{ id: string; name: string }>;
        documentMetadata: {
            width: number;
            height: number;
            format: string;
            originalHash: string;
        } | null;
    };
}

/**
 * User joined message
 */
export interface UserJoinedMessage extends BaseMessage {
    type: 'user-joined';
    roomId: string;
    payload: {
        userId: string;
        userName: string;
        joinedAt: string;
    };
}

/**
 * User left message
 */
export interface UserLeftMessage extends BaseMessage {
    type: 'user-left';
    roomId: string;
    payload: {
        userId: string;
    };
}

/**
 * Redaction sync message
 */
export interface RedactionSyncMessage extends BaseMessage {
    type: 'redaction-sync';
    roomId: string;
    userId: string;
    payload: {
        boxes: SyncedRedactionBox[];
        syncType: 'full' | 'incremental';
    };
}

/**
 * Cursor sync message
 */
export interface CursorSyncMessage extends BaseMessage {
    type: 'cursor-sync';
    roomId: string;
    userId: string;
    payload: CursorPosition;
}

/**
 * Error message
 */
export interface ErrorMessage extends BaseMessage {
    type: 'error';
    payload: {
        message: string;
        code: string;
    };
}

/**
 * All server message types
 */
export type ServerMessage =
    | ConnectedMessage
    | RoomStateMessage
    | UserJoinedMessage
    | UserLeftMessage
    | RedactionSyncMessage
    | CursorSyncMessage
    | ErrorMessage
    | { type: 'pong' };

// ============================================
// REDACTION SYNC TYPES
// ============================================

/**
 * Redaction box with sync metadata
 */
export interface SyncedRedactionBox extends RedactionBox {
    userId: string;
    timestamp: number;
    syncId?: string; // For conflict resolution
}

/**
 * Redaction operation types for sync
 */
export type RedactionOperation = 'add' | 'update' | 'remove';

/**
 * Redaction change event
 */
export interface RedactionChange {
    operation: RedactionOperation;
    box: SyncedRedactionBox;
    userId: string;
    timestamp: number;
}

// ============================================
// COLLABORATION SESSION TYPES
// ============================================

/**
 * Collaboration session info
 */
export interface CollaborationSession {
    roomId: string;
    roomName: string;
    createdBy: string;
    joinedAt: Date;
    collaborators: Collaborator[];
}

/**
 * Collaboration state for the store
 */
export interface CollaborationState {
    // Connection
    connectionState: ConnectionState;
    error: string | null;
    
    // Session
    session: CollaborationSession | null;
    currentUserId: string | null;
    currentUserName: string | null;
    
    // Users
    collaborators: Map<string, Collaborator>;
    cursors: Map<string, CursorPosition>;
    
    // Sync
    lastSyncTimestamp: number;
    pendingSync: boolean;
}

// ============================================
// COLLABORATION SERVICE OPTIONS
// ============================================

/**
 * Options for CollaborationService
 */
export interface CollaborationServiceOptions {
    serverUrl: string;
    token?: string;
    reconnectAttempts?: number;
    reconnectDelay?: number;
    heartbeatInterval?: number;
    debug?: boolean;
}

/**
 * Event callbacks for CollaborationService
 */
export interface CollaborationServiceCallbacks {
    onConnectionChange?: (state: ConnectionState) => void;
    onRoomState?: (state: RoomStateMessage['payload']) => void;
    onUserJoined?: (user: { id: string; name: string }) => void;
    onUserLeft?: (userId: string) => void;
    onRedactionSync?: (boxes: SyncedRedactionBox[], userId: string) => void;
    onCursorSync?: (position: CursorPosition) => void;
    onError?: (error: { message: string; code: string }) => void;
}

// ============================================
// CURSOR COLORS
// ============================================

/**
 * Predefined colors for collaborator cursors
 */
export const CURSOR_COLORS = [
    '#FF6B6B', // Red
    '#4ECDC4', // Teal
    '#45B7D1', // Blue
    '#96CEB4', // Green
    '#FFEAA7', // Yellow
    '#DDA0DD', // Plum
    '#98D8C8', // Mint
    '#F7DC6F', // Gold
    '#BB8FCE', // Purple
    '#85C1E9', // Sky
] as const;

/**
 * Get a color for a user based on their ID
 */
export function getUserColor(userId: string): string {
    // Generate a consistent color based on user ID
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
        hash = ((hash << 5) - hash) + userId.charCodeAt(i);
        hash = hash & hash; // Convert to 32bit integer
    }
    return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length];
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Generate a unique sync ID for conflict resolution
 */
export function generateSyncId(): string {
    return `sync-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Check if a redaction is newer (for last-write-wins)
 */
export function isNewerRedaction(
    existing: SyncedRedactionBox | undefined,
    incoming: SyncedRedactionBox
): boolean {
    if (!existing) return true;
    return incoming.timestamp > existing.timestamp;
}

/**
 * Merge redaction boxes with conflict resolution (last-write-wins)
 */
export function mergeRedactions(
    local: RedactionBox[],
    remote: SyncedRedactionBox[],
    currentUserId: string
): RedactionBox[] {
    const merged = new Map<string, SyncedRedactionBox>();

    // Add all local boxes
    local.forEach((box) => {
        merged.set(box.id, {
            ...box,
            userId: currentUserId,
            timestamp: box.createdAt || Date.now(),
        });
    });

    // Merge remote boxes (last-write-wins)
    remote.forEach((box) => {
        const existing = merged.get(box.id);
        if (isNewerRedaction(existing, box)) {
            merged.set(box.id, box);
        }
    });

    return Array.from(merged.values());
}
