/**
 * useP2PTransfer Hook
 * ====================
 *
 * React hook for managing P2P file transfer functionality.
 * Provides an easy-to-use API for establishing connections and transferring files.
 *
 * Features:
 * - Connection management
 * - File sending/receiving
 * - Progress tracking
 * - Automatic signaling through collaboration service
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import {
    P2PService,
    getP2PService,
    destroyP2PService,
    type P2PTransferProgress,
    type P2PTransferResult,
    type P2PConnectionState,
    type P2PCallbacks,
} from '../services/P2PService';
import type { CollaborationService } from '../services/CollaborationService';

// ============================================
// TYPES
// ============================================

export interface TransferState {
    isSending: boolean;
    isReceiving: boolean;
    progress: P2PTransferProgress | null;
    result: P2PTransferResult | null;
    error: string | null;
}

export interface IncomingTransferRequest {
    transferId: string;
    fileName: string;
    fileSize: number;
    senderId: string;
}

export interface UseP2PTransferOptions {
    collaborationService?: CollaborationService | null;
    currentUserId?: string;
    autoAcceptTransfers?: boolean;
    maxFileSize?: number; // in bytes
    debug?: boolean;
}

export interface UseP2PTransferResult {
    // Connection
    connectionState: P2PConnectionState;
    isConnected: boolean;
    isConnecting: boolean;

    // Transfer State
    transferState: TransferState;
    isTransferring: boolean;
    incomingRequest: IncomingTransferRequest | null;

    // Actions
    initializeConnection: () => Promise<void>;
    closeConnection: () => void;
    sendFile: (file: File) => Promise<P2PTransferResult>;
    acceptTransfer: () => void;
    rejectTransfer: () => void;
    cancelTransfer: () => void;
    clearError: () => void;
    clearResult: () => void;

    // Events
    onFileReceived: ((data: ArrayBuffer, fileName: string) => void) | null;
    setOnFileReceived: (callback: ((data: ArrayBuffer, fileName: string) => void) | null) => void;
}

// ============================================
// HOOK IMPLEMENTATION
// ============================================

export function useP2PTransfer(options: UseP2PTransferOptions = {}): UseP2PTransferResult {
    const {
        collaborationService,
        currentUserId,
        autoAcceptTransfers = false,
        maxFileSize = 50 * 1024 * 1024, // 50MB default
        debug = false,
    } = options;

    // ============================================
    // STATE
    // ============================================

    const [connectionState, setConnectionState] = useState<P2PConnectionState>({ state: 'new' });
    const [transferState, setTransferState] = useState<TransferState>({
        isSending: false,
        isReceiving: false,
        progress: null,
        result: null,
        error: null,
    });
    const [incomingRequest, setIncomingRequest] = useState<IncomingTransferRequest | null>(null);

    // Refs
    const p2pServiceRef = useRef<P2PService | null>(null);
    const onFileReceivedRef = useRef<((data: ArrayBuffer, fileName: string) => void) | null>(null);
    const pendingRequestRef = useRef<{ resolve: (accept: boolean) => void } | null>(null);

    // ============================================
    // INITIALIZE P2P SERVICE
    // ============================================

    useEffect(() => {
        p2pServiceRef.current = getP2PService({ debug });

        const p2p = p2pServiceRef.current;

        // Set collaboration service if available
        if (collaborationService) {
            p2p.setCollaborationService(collaborationService);
        }

        // Set callbacks
        const callbacks: P2PCallbacks = {
            onConnectionStateChange: (state) => {
                setConnectionState(state);
                if (debug) {
                    console.log('[useP2PTransfer] Connection state changed:', state);
                }
            },

            onTransferProgress: (progress) => {
                setTransferState(prev => ({
                    ...prev,
                    progress,
                    error: null,
                }));
                if (debug) {
                    console.log('[useP2PTransfer] Progress:', progress.progress.toFixed(1) + '%');
                }
            },

            onTransferComplete: (result) => {
                setTransferState(prev => ({
                    ...prev,
                    isSending: false,
                    isReceiving: false,
                    progress: null,
                    result,
                }));
                if (debug) {
                    console.log('[useP2PTransfer] Transfer complete:', result.fileName);
                }
            },

            onTransferError: (error, transferId) => {
                setTransferState(prev => ({
                    ...prev,
                    isSending: false,
                    isReceiving: false,
                    progress: null,
                    error,
                }));
                if (debug) {
                    console.error('[useP2PTransfer] Transfer error:', error);
                }
            },

            onDataReceived: (data, fileName) => {
                if (onFileReceivedRef.current) {
                    onFileReceivedRef.current(data, fileName);
                }
                if (debug) {
                    console.log('[useP2PTransfer] File received:', fileName);
                }
            },

            onIncomingTransferRequest: (request) => {
                // Check file size limit
                if (request.fileSize > maxFileSize) {
                    if (debug) {
                        console.log('[useP2PTransfer] Rejecting transfer - file too large');
                    }
                    return false;
                }

                setIncomingRequest({
                    transferId: request.transferId,
                    fileName: request.fileName,
                    fileSize: request.fileSize,
                    senderId: request.senderId,
                });

                // If auto-accept is enabled, accept immediately
                if (autoAcceptTransfers) {
                    setTransferState(prev => ({ ...prev, isReceiving: true }));
                    return true;
                }

                // Otherwise, wait for user decision
                return new Promise<boolean>((resolve) => {
                    pendingRequestRef.current = { resolve };
                });
            },
        };

        p2p.setCallbacks(callbacks);

        return () => {
            // Clean up on unmount
            p2p.close();
        };
    }, [collaborationService, autoAcceptTransfers, maxFileSize, debug]);

    // ============================================
    // CONNECTION ACTIONS
    // ============================================

    const initializeConnection = useCallback(async () => {
        if (!p2pServiceRef.current) {
            if (debug) {
                console.error('[useP2PTransfer] P2P service not initialized');
            }
            return;
        }

        try {
            // If we have a collaboration service, use it for signaling
            if (collaborationService) {
                const offer = await p2pServiceRef.current.initializeAsSender();
                // The collaboration service will handle the signaling
                if (debug) {
                    console.log('[useP2PTransfer] Created WebRTC offer');
                }
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to initialize connection';
            setTransferState(prev => ({ ...prev, error: message }));
        }
    }, [collaborationService, debug]);

    const closeConnection = useCallback(() => {
        if (p2pServiceRef.current) {
            p2pServiceRef.current.close();
            setConnectionState({ state: 'disconnected' });
        }
    }, []);

    // ============================================
    // FILE TRANSFER ACTIONS
    // ============================================

    const sendFile = useCallback(async (file: File): Promise<P2PTransferResult> => {
        if (!p2pServiceRef.current) {
            throw new Error('P2P service not initialized');
        }

        // Check file size
        if (file.size > maxFileSize) {
            throw new Error(`File size exceeds maximum of ${(maxFileSize / (1024 * 1024)).toFixed(0)}MB`);
        }

        setTransferState(prev => ({
            ...prev,
            isSending: true,
            progress: null,
            result: null,
            error: null,
        }));

        try {
            const result = await p2pServiceRef.current.sendFile(file);
            return result;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to send file';
            setTransferState(prev => ({
                ...prev,
                isSending: false,
                error: message,
            }));
            throw error;
        }
    }, [maxFileSize]);

    const acceptTransfer = useCallback(() => {
        if (incomingRequest && pendingRequestRef.current) {
            setTransferState(prev => ({ ...prev, isReceiving: true }));
            pendingRequestRef.current.resolve(true);
            pendingRequestRef.current = null;
            setIncomingRequest(null);
        }
    }, [incomingRequest]);

    const rejectTransfer = useCallback(() => {
        if (pendingRequestRef.current) {
            pendingRequestRef.current.resolve(false);
            pendingRequestRef.current = null;
            setIncomingRequest(null);
        }
    }, []);

    const cancelTransfer = useCallback(() => {
        if (p2pServiceRef.current) {
            p2pServiceRef.current.cancelTransfer();
            setTransferState(prev => ({
                ...prev,
                isSending: false,
                isReceiving: false,
                progress: null,
            }));
        }
    }, []);

    const clearError = useCallback(() => {
        setTransferState(prev => ({ ...prev, error: null }));
    }, []);

    const clearResult = useCallback(() => {
        setTransferState(prev => ({ ...prev, result: null }));
    }, []);

    const setOnFileReceived = useCallback((callback: ((data: ArrayBuffer, fileName: string) => void) | null) => {
        onFileReceivedRef.current = callback;
    }, []);

    // ============================================
    // RETURN HOOK API
    // ============================================

    const isConnected = connectionState.state === 'connected';
    const isConnecting = connectionState.state === 'connecting';
    const isTransferring = transferState.isSending || transferState.isReceiving;

    return {
        // Connection
        connectionState,
        isConnected,
        isConnecting,

        // Transfer State
        transferState,
        isTransferring,
        incomingRequest,

        // Actions
        initializeConnection,
        closeConnection,
        sendFile,
        acceptTransfer,
        rejectTransfer,
        cancelTransfer,
        clearError,
        clearResult,

        // Events
        onFileReceived: onFileReceivedRef.current,
        setOnFileReceived,
    };
}

export default useP2PTransfer;
