/**
 * useCollaboration Hook
 * ======================
 * 
 * React hook for real-time collaboration features.
 * Manages WebSocket connection, room operations, and redaction syncing.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
    CollaborationService,
    getCollaborationService,
    destroyCollaborationService,
} from '../services/CollaborationService';
import type {
    ConnectionState,
    Collaborator,
    CursorPosition,
    SyncedRedactionBox,
    getUserColor,
} from '../types/collaboration';
import { getUserColor as getUserColorFn } from '../types/collaboration';

// ============================================
// HOOK OPTIONS
// ============================================

export interface UseCollaborationOptions {
    /**
     * WebSocket server URL
     */
    serverUrl?: string;

    /**
     * Authentication token (JWT)
     */
    token?: string;

    /**
     * Enable debug logging
     */
    debug?: boolean;

    /**
     * Auto-connect on mount
     */
    autoConnect?: boolean;

    /**
     * Room ID to join on connect
     */
    roomId?: string;

    /**
     * User display name
     */
    userName?: string;
}

// ============================================
// HOOK RETURN TYPE
// ============================================

export interface UseCollaborationResult {
    // Connection state
    connectionState: ConnectionState;
    isConnected: boolean;
    isConnecting: boolean;
    error: string | null;

    // Session info
    roomId: string | null;
    userId: string | null;

    // Collaborators
    collaborators: Collaborator[];
    cursors: CursorPosition[];

    // Actions
    connect: (token?: string) => Promise<void>;
    disconnect: () => void;
    joinRoom: (roomId: string, userName?: string) => void;
    leaveRoom: () => void;
    syncRedactions: (boxes: SyncedRedactionBox[]) => void;
    syncCursor: (x: number, y: number) => void;

    // Internal
    service: CollaborationService | null;
}

// ============================================
// DEFAULT OPTIONS
// ============================================

const DEFAULT_SERVER_URL = 'ws://localhost:3001';
const DEFAULT_AUTO_CONNECT = false;

// ============================================
// HOOK IMPLEMENTATION
// ============================================

export function useCollaboration(options: UseCollaborationOptions = {}): UseCollaborationResult {
    const {
        serverUrl = DEFAULT_SERVER_URL,
        token,
        debug = false,
        autoConnect = DEFAULT_AUTO_CONNECT,
        roomId: initialRoomId,
        userName,
    } = options;

    // ============================================
    // STATE
    // ============================================

    const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
    const [error, setError] = useState<string | null>(null);
    const [roomId, setRoomId] = useState<string | null>(null);
    const [userId, setUserId] = useState<string | null>(null);
    const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
    const [cursors, setCursors] = useState<CursorPosition[]>([]);

    // ============================================
    // REFS
    // ============================================

    const serviceRef = useRef<CollaborationService | null>(null);

    // ============================================
    // DERIVED STATE
    // ============================================

    const isConnected = connectionState === 'connected';
    const isConnecting = connectionState === 'connecting';

    // ============================================
    // INITIALIZE SERVICE
    // ============================================

    useEffect(() => {
        // Create service instance
        serviceRef.current = getCollaborationService({
            serverUrl,
            token: token || '',
            debug,
        });

        // Set up callbacks
        serviceRef.current.setCallbacks({
            onConnectionChange: (state) => {
                setConnectionState(state);
                if (state === 'disconnected') {
                    setRoomId(null);
                    setCollaborators([]);
                    setCursors([]);
                }
            },

            onRoomState: (state) => {
                setRoomId(state.roomId);

                // Set collaborators from room state
                const users = state.users.map((u) => ({
                    id: u.id,
                    name: u.name,
                    color: getUserColorFn(u.id),
                    joinedAt: new Date(),
                    isOnline: true,
                }));
                setCollaborators(users);

                if (debug) {
                    console.log('[useCollaboration] Room state:', state);
                }
            },

            onUserJoined: (user) => {
                setCollaborators((prev) => {
                    // Avoid duplicates
                    if (prev.some((c) => c.id === user.id)) {
                        return prev;
                    }
                    return [
                        ...prev,
                        {
                            id: user.id,
                            name: user.name,
                            color: getUserColorFn(user.id),
                            joinedAt: new Date(),
                            isOnline: true,
                        },
                    ];
                });

                if (debug) {
                    console.log('[useCollaboration] User joined:', user);
                }
            },

            onUserLeft: (leftUserId) => {
                setCollaborators((prev) => prev.filter((c) => c.id !== leftUserId));
                setCursors((prev) => prev.filter((c) => c.userId !== leftUserId));

                if (debug) {
                    console.log('[useCollaboration] User left:', leftUserId);
                }
            },

            onRedactionSync: (boxes, fromUserId) => {
                // This will be handled by the document store
                // We emit an event that the store can listen to
                if (debug) {
                    console.log('[useCollaboration] Redaction sync from:', fromUserId, 'boxes:', boxes.length);
                }

                // Dispatch custom event for document store to handle
                window.dispatchEvent(new CustomEvent('collaboration:redaction-sync', {
                    detail: { boxes, userId: fromUserId },
                }));
            },

            onCursorSync: (position) => {
                setCursors((prev) => {
                    // Update or add cursor
                    const existing = prev.findIndex((c) => c.userId === position.userId);
                    if (existing >= 0) {
                        const updated = [...prev];
                        updated[existing] = position;
                        return updated;
                    }
                    return [...prev, position];
                });
            },

            onError: (err) => {
                setError(err.message);
                console.error('[useCollaboration] Error:', err);
            },
        });

        // Update userId when available
        setUserId(serviceRef.current.getCurrentUserId());

        // Auto-connect if requested
        if (autoConnect && token) {
            serviceRef.current.connect(token).catch((err) => {
                console.error('[useCollaboration] Auto-connect failed:', err);
            });
        }

        // Cleanup on unmount
        return () => {
            if (serviceRef.current) {
                serviceRef.current.disconnect();
            }
        };
    }, [serverUrl, debug, autoConnect, token]);

    // ============================================
    // ACTIONS
    // ============================================

    /**
     * Connect to the WebSocket server
     */
    const connect = useCallback(async (connectToken?: string) => {
        if (!serviceRef.current) {
            throw new Error('Service not initialized');
        }

        setError(null);
        await serviceRef.current.connect(connectToken || token);
        setUserId(serviceRef.current.getCurrentUserId());
    }, [token]);

    /**
     * Disconnect from the WebSocket server
     */
    const disconnect = useCallback(() => {
        if (serviceRef.current) {
            serviceRef.current.disconnect();
        }
    }, []);

    /**
     * Join a collaboration room
     */
    const joinRoom = useCallback((newRoomId: string, name?: string) => {
        if (!serviceRef.current) {
            console.error('[useCollaboration] Cannot join room: service not initialized');
            return;
        }

        serviceRef.current.joinRoom(newRoomId, name || userName);
        setRoomId(newRoomId);
    }, [userName]);

    /**
     * Leave the current room
     */
    const leaveRoom = useCallback(() => {
        if (serviceRef.current) {
            serviceRef.current.leaveRoom();
            setRoomId(null);
            setCollaborators([]);
            setCursors([]);
        }
    }, []);

    /**
     * Sync redaction boxes to other collaborators
     */
    const syncRedactions = useCallback((boxes: SyncedRedactionBox[]) => {
        if (serviceRef.current) {
            serviceRef.current.syncRedactions(boxes);
        }
    }, []);

    /**
     * Sync cursor position to other collaborators
     */
    const syncCursor = useCallback((x: number, y: number) => {
        if (serviceRef.current) {
            serviceRef.current.syncCursor(x, y);
        }
    }, []);

    // ============================================
    // JOIN INITIAL ROOM IF PROVIDED
    // ============================================

    useEffect(() => {
        if (isConnected && initialRoomId && !roomId) {
            joinRoom(initialRoomId);
        }
    }, [isConnected, initialRoomId, roomId, joinRoom]);

    // ============================================
    // RETURN
    // ============================================

    return {
        // Connection state
        connectionState,
        isConnected,
        isConnecting,
        error,

        // Session info
        roomId,
        userId,

        // Collaborators
        collaborators,
        cursors,

        // Actions
        connect,
        disconnect,
        joinRoom,
        leaveRoom,
        syncRedactions,
        syncCursor,

        // Internal
        service: serviceRef.current,
    };
}

export default useCollaboration;
