/**
 * P2PTransferPanel Component
 * ===========================
 *
 * UI component for peer-to-peer file transfer using WebRTC.
 * Enables direct browser-to-browser file sharing without server involvement.
 *
 * Features:
 * - Create/join transfer sessions
 * - Connection status display
 * - File selection and sending
 * - Progress tracking
 * - Incoming transfer requests
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
    P2PService,
    getP2PService,
    type P2PTransferProgress,
    type P2PTransferResult,
    type P2PConnectionState,
} from '../services/P2PService';
import { CollaborationService } from '../services/CollaborationService';
import './P2PTransferPanel.css';

// ============================================
// TYPES
// ============================================

interface P2PTransferPanelProps {
    className?: string;
    collaborationService?: CollaborationService;
    currentUserId?: string;
    onFileReceived?: (data: ArrayBuffer, fileName: string) => void;
}

interface IncomingRequest {
    transferId: string;
    fileName: string;
    fileSize: number;
    senderId: string;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatSpeed(bytesPerSecond: number): string {
    return `${formatFileSize(bytesPerSecond)}/s`;
}

function formatTime(seconds: number): string {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

// ============================================
// COMPONENT
// ============================================

export const P2PTransferPanel: React.FC<P2PTransferPanelProps> = ({
    className = '',
    collaborationService,
    currentUserId,
    onFileReceived,
}) => {
    // ============================================
    // STATE
    // ============================================

    const [connectionState, setConnectionState] = useState<P2PConnectionState>({ state: 'new' });
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [transferProgress, setTransferProgress] = useState<P2PTransferProgress | null>(null);
    const [transferResult, setTransferResult] = useState<P2PTransferResult | null>(null);
    const [incomingRequest, setIncomingRequest] = useState<IncomingRequest | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isSending, setIsSending] = useState(false);

    // Refs
    const fileInputRef = useRef<HTMLInputElement>(null);
    const p2pServiceRef = useRef<P2PService | null>(null);

    // ============================================
    // INITIALIZE P2P SERVICE
    // ============================================

    useEffect(() => {
        p2pServiceRef.current = getP2PService({ debug: true });

        const p2p = p2pServiceRef.current;

        // Set callbacks
        p2p.setCallbacks({
            onConnectionStateChange: (state) => {
                setConnectionState(state);
                console.log('[P2PTransferPanel] Connection state:', state);
            },
            onTransferProgress: (progress) => {
                setTransferProgress(progress);
            },
            onTransferComplete: (result) => {
                setTransferResult(result);
                setTransferProgress(null);
                setIsSending(false);
                setSelectedFile(null);
                console.log('[P2PTransferPanel] Transfer complete:', result);
            },
            onTransferError: (errorMsg, transferId) => {
                setError(errorMsg);
                setTransferProgress(null);
                setIsSending(false);
                console.error('[P2PTransferPanel] Transfer error:', errorMsg);
            },
            onDataReceived: (data, fileName) => {
                console.log('[P2PTransferPanel] File received:', fileName);
                onFileReceived?.(data, fileName);
            },
            onIncomingTransferRequest: (request) => {
                setIncomingRequest(request);
                // Return false initially - user needs to accept
                return false;
            },
        });

        // Set collaboration service if provided
        if (collaborationService) {
            p2p.setCollaborationService(collaborationService);
        }

        return () => {
            // Don't destroy the singleton, just close the connection
            // p2p.close();
        };
    }, [collaborationService, onFileReceived]);

    // ============================================
    // HANDLERS
    // ============================================

    const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setSelectedFile(file);
            setError(null);
            setTransferResult(null);
        }
    }, []);

    const handleSendFile = useCallback(async () => {
        if (!selectedFile || !p2pServiceRef.current) {
            return;
        }

        const state = p2pServiceRef.current.getConnectionState();
        if (state.state !== 'connected') {
            setError('Not connected to a peer. Create or join a session first.');
            return;
        }

        setIsSending(true);
        setError(null);
        setTransferResult(null);

        try {
            await p2pServiceRef.current.sendFile(selectedFile);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to send file');
            setIsSending(false);
        }
    }, [selectedFile]);

    const handleAcceptTransfer = useCallback(() => {
        if (incomingRequest && p2pServiceRef.current) {
            p2pServiceRef.current.acceptTransfer(incomingRequest.transferId);
            setIncomingRequest(null);
        }
    }, [incomingRequest]);

    const handleRejectTransfer = useCallback(() => {
        if (incomingRequest && p2pServiceRef.current) {
            p2pServiceRef.current.rejectTransfer(incomingRequest.transferId);
            setIncomingRequest(null);
        }
    }, [incomingRequest]);

    const handleCancelTransfer = useCallback(() => {
        if (p2pServiceRef.current) {
            p2pServiceRef.current.cancelTransfer();
            setIsSending(false);
            setTransferProgress(null);
        }
    }, []);

    const handleClearError = useCallback(() => {
        setError(null);
    }, []);

    const handleClearResult = useCallback(() => {
        setTransferResult(null);
    }, []);

    // ============================================
    // RENDER
    // ============================================

    const isConnected = connectionState.state === 'connected';
    const isConnecting = connectionState.state === 'connecting';
    const isTransferring = transferProgress !== null;

    return (
        <div className={`p2p-transfer-panel ${className}`}>
            {/* Header */}
            <div className="panel-header">
                <h3>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                    </svg>
                    P2P File Transfer
                </h3>
                <span className={`connection-status ${connectionState.state}`}>
                    {connectionState.state === 'new' && 'Not Connected'}
                    {connectionState.state === 'connecting' && 'Connecting...'}
                    {connectionState.state === 'connected' && 'Connected'}
                    {connectionState.state === 'disconnected' && 'Disconnected'}
                    {connectionState.state === 'failed' && 'Connection Failed'}
                </span>
            </div>

            {/* Connection Info */}
            {isConnected && (
                <div className="connection-info">
                    <div className="info-item">
                        <span className="label">Local Peer:</span>
                        <span className="value">{connectionState.localPeerId?.substring(0, 8)}...</span>
                    </div>
                    <div className="info-item">
                        <span className="label">Remote Peer:</span>
                        <span className="value">{connectionState.remotePeerId?.substring(0, 8)}...</span>
                    </div>
                </div>
            )}

            {/* Incoming Request */}
            {incomingRequest && (
                <div className="incoming-request">
                    <div className="request-header">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                        <span>Incoming File Transfer</span>
                    </div>
                    <div className="request-details">
                        <p><strong>File:</strong> {incomingRequest.fileName}</p>
                        <p><strong>Size:</strong> {formatFileSize(incomingRequest.fileSize)}</p>
                        <p><strong>From:</strong> {incomingRequest.senderId}</p>
                    </div>
                    <div className="request-actions">
                        <button className="btn primary" onClick={handleAcceptTransfer}>
                            Accept
                        </button>
                        <button className="btn secondary" onClick={handleRejectTransfer}>
                            Reject
                        </button>
                    </div>
                </div>
            )}

            {/* Transfer Progress */}
            {transferProgress && (
                <div className="transfer-progress">
                    <div className="progress-header">
                        <span className="direction">
                            {transferProgress.direction === 'send' ? 'Sending' : 'Receiving'}
                        </span>
                        <span className="file-name">{transferProgress.fileName}</span>
                    </div>
                    <div className="progress-stats">
                        <span>{formatFileSize(transferProgress.bytesTransferred)} / {formatFileSize(transferProgress.fileSize)}</span>
                        <span>{Math.round(transferProgress.progress)}%</span>
                    </div>
                    <div className="progress-bar">
                        <div
                            className="progress-fill"
                            style={{ width: `${transferProgress.progress}%` }}
                        />
                    </div>
                    <div className="progress-details">
                        <span>Speed: {formatSpeed(transferProgress.speed)}</span>
                        {transferProgress.estimatedTimeRemaining && (
                            <span>ETA: {formatTime(transferProgress.estimatedTimeRemaining)}</span>
                        )}
                    </div>
                    {isSending && (
                        <button className="btn danger cancel-btn" onClick={handleCancelTransfer}>
                            Cancel
                        </button>
                    )}
                </div>
            )}

            {/* Transfer Result */}
            {transferResult && (
                <div className={`transfer-result ${transferResult.success ? 'success' : 'failed'}`}>
                    <div className="result-header">
                        {transferResult.success ? (
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                                <polyline points="22 4 12 14.01 9 11.01" />
                            </svg>
                        ) : (
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="12" cy="12" r="10" />
                                <line x1="15" y1="9" x2="9" y2="15" />
                                <line x1="9" y1="9" x2="15" y2="15" />
                            </svg>
                        )}
                        <span>{transferResult.success ? 'Transfer Complete' : 'Transfer Failed'}</span>
                    </div>
                    <p className="result-file">{transferResult.fileName}</p>
                    <p className="result-size">{formatFileSize(transferResult.fileSize)}</p>
                    <p className="result-duration">Duration: {formatTime(transferResult.duration / 1000)}</p>
                    <button className="btn secondary small" onClick={handleClearResult}>
                        Clear
                    </button>
                </div>
            )}

            {/* Error */}
            {error && (
                <div className="error-message">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <span>{error}</span>
                    <button className="clear-error" onClick={handleClearError}>×</button>
                </div>
            )}

            {/* File Selection */}
            {!isTransferring && !transferResult && (
                <div className="file-selection">
                    <input
                        ref={fileInputRef}
                        type="file"
                        onChange={handleFileSelect}
                        style={{ display: 'none' }}
                    />
                    <button
                        className="btn secondary"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isConnecting || isTransferring}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                        </svg>
                        Select File
                    </button>

                    {selectedFile && (
                        <div className="selected-file">
                            <span className="file-name">{selectedFile.name}</span>
                            <span className="file-size">{formatFileSize(selectedFile.size)}</span>
                        </div>
                    )}

                    <button
                        className="btn primary"
                        onClick={handleSendFile}
                        disabled={!selectedFile || !isConnected || isTransferring}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="22" y1="2" x2="11" y2="13" />
                            <polygon points="22 2 15 22 11 13 2 9 22 2" />
                        </svg>
                        Send File
                    </button>
                </div>
            )}

            {/* Not Connected Message */}
            {!isConnected && !isConnecting && (
                <div className="not-connected">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <line x1="17" y1="11" x2="23" y2="11" />
                    </svg>
                    <p>Connect with a peer to start transferring files</p>
                    <span className="hint">Use the collaboration session to establish a P2P connection</span>
                </div>
            )}
        </div>
    );
};

export default P2PTransferPanel;
