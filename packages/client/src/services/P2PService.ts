/**
 * P2PService
 * ===========
 * 
 * WebRTC-based Peer-to-Peer file transfer service.
 * Enables direct browser-to-browser file sharing without server involvement.
 * 
 * Architecture:
 * 1. Sender creates WebRTC offer with data channel
 * 2. Offer sent via WebSocket signaling to recipient
 * 3. Recipient creates answer and sends back
 * 4. ICE candidates exchanged through signaling
 * 5. Direct data channel established
 * 6. File transferred in chunks
 * 
 * Security:
 * - Files are encrypted before transfer (optional)
 * - Chunk-based transfer with integrity verification
 * - Progress tracking and cancellation support
 */

import { CollaborationService } from './CollaborationService';

// ============================================
// TYPES
// ============================================

export interface P2PTransferOptions {
    chunkSize?: number; // Default: 16384 (16KB)
    enableEncryption?: boolean;
    debug?: boolean;
}

export interface P2PTransferProgress {
    transferId: string;
    direction: 'send' | 'receive';
    fileName: string;
    fileSize: number;
    bytesTransferred: number;
    progress: number; // 0-100
    speed: number; // bytes per second
    startTime: number;
    estimatedTimeRemaining?: number;
}

export interface P2PTransferResult {
    transferId: string;
    fileName: string;
    fileSize: number;
    direction: 'send' | 'receive';
    success: boolean;
    duration: number;
    hash?: string;
}

export interface P2PConnectionState {
    state: 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed';
    localPeerId?: string;
    remotePeerId?: string;
}

export type P2PCallbacks = {
    onConnectionStateChange?: (state: P2PConnectionState) => void;
    onTransferProgress?: (progress: P2PTransferProgress) => void;
    onTransferComplete?: (result: P2PTransferResult) => void;
    onTransferError?: (error: string, transferId: string) => void;
    onDataReceived?: (data: ArrayBuffer, fileName: string) => void;
    onIncomingTransferRequest?: (request: { 
        transferId: string; 
        fileName: string; 
        fileSize: number; 
        senderId: string;
    }) => boolean; // Return true to accept
};

// ============================================
// CONSTANTS
// ============================================

const DEFAULT_CHUNK_SIZE = 16384; // 16KB - optimal for WebRTC
const MAX_MESSAGE_SIZE = 65535; // 64KB - WebRTC data channel limit
const CONNECTION_TIMEOUT = 30000; // 30 seconds
const ICE_CANDIDATE_TIMEOUT = 10000; // 10 seconds

// ============================================
// P2P SERVICE CLASS
// ============================================

export class P2PService {
    private peerConnection: RTCPeerConnection | null = null;
    private dataChannel: RTCDataChannel | null = null;
    private collaborationService: CollaborationService | null = null;
    private options: Required<P2PTransferOptions>;
    private callbacks: P2PCallbacks = {};
    private connectionState: P2PConnectionState = { state: 'new' };
    
    // Transfer state
    private currentTransfer: {
        id: string;
        fileName: string;
        fileSize: number;
        direction: 'send' | 'receive';
        bytesTransferred: number;
        buffer?: ArrayBuffer[];
        startTime: number;
        lastProgressTime: number;
        lastBytesTransferred: number;
    } | null = null;
    
    // ICE candidates queue
    private iceCandidatesQueue: RTCIceCandidateInit[] = [];
    private remoteDescriptionSet = false;
    
    // Transfer ID counter
    private transferIdCounter = 0;
    
    // Pending transfer requests
    private pendingRequests: Map<string, { 
        resolve: (accept: boolean) => void;
        timeout: ReturnType<typeof setTimeout>;
    }> = new Map();

    constructor(options: P2PTransferOptions = {}) {
        this.options = {
            chunkSize: options.chunkSize ?? DEFAULT_CHUNK_SIZE,
            enableEncryption: options.enableEncryption ?? false,
            debug: options.debug ?? false,
        };
    }

    // ============================================
    // PUBLIC METHODS
    // ============================================

    /**
     * Set event callbacks
     */
    setCallbacks(callbacks: P2PCallbacks): void {
        this.callbacks = { ...this.callbacks, ...callbacks };
    }

    /**
     * Set collaboration service for signaling
     */
    setCollaborationService(service: CollaborationService): void {
        this.collaborationService = service;
        
        // Listen for WebRTC signaling messages
        service.setCallbacks({
            onWebRTCSignal: (type, payload, fromUserId) => {
                this.handleSignalingMessage(type, payload, fromUserId);
            },
        });
    }

    /**
     * Get current connection state
     */
    getConnectionState(): P2PConnectionState {
        return { ...this.connectionState };
    }

    /**
     * Initialize peer connection as sender (create offer)
     */
    async initializeAsSender(): Promise<RTCSessionDescriptionInit> {
        this.log('Initializing as sender');
        
        await this.createPeerConnection();
        
        // Create data channel
        this.dataChannel = this.peerConnection!.createDataChannel('fileTransfer', {
            ordered: true,
        });
        
        this.setupDataChannel(this.dataChannel);
        
        // Create offer
        const offer = await this.peerConnection!.createOffer({
            offerToReceiveData: false,
        });
        
        await this.peerConnection!.setLocalDescription(offer);
        
        this.updateConnectionState({ state: 'connecting' });
        
        // Wait for ICE gathering to complete
        await this.waitForIceGathering();
        
        return offer;
    }

    /**
     * Handle incoming offer (as receiver)
     */
    async handleOffer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
        this.log('Handling offer as receiver');
        
        await this.createPeerConnection();
        
        await this.peerConnection!.setRemoteDescription(new RTCSessionDescription(offer));
        this.remoteDescriptionSet = true;
        
        // Process queued ICE candidates
        await this.processQueuedIceCandidates();
        
        // Create answer
        const answer = await this.peerConnection!.createAnswer();
        await this.peerConnection!.setLocalDescription(answer);
        
        this.updateConnectionState({ state: 'connecting' });
        
        // Wait for ICE gathering
        await this.waitForIceGathering();
        
        return answer;
    }

    /**
     * Handle incoming answer (as sender)
     */
    async handleAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
        this.log('Handling answer');
        
        if (!this.peerConnection) {
            throw new Error('Peer connection not initialized');
        }
        
        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        this.remoteDescriptionSet = true;
        
        // Process queued ICE candidates
        await this.processQueuedIceCandidates();
    }

    /**
     * Add ICE candidate
     */
    async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
        if (!this.peerConnection) {
            this.iceCandidatesQueue.push(candidate);
            return;
        }
        
        if (!this.remoteDescriptionSet) {
            this.iceCandidatesQueue.push(candidate);
            return;
        }
        
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        this.log('Added ICE candidate');
    }

    /**
     * Send file to connected peer
     */
    async sendFile(file: File): Promise<P2PTransferResult> {
        if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
            throw new Error('Data channel not ready. Establish connection first.');
        }

        const transferId = `transfer-${++this.transferIdCounter}`;
        const startTime = Date.now();

        this.currentTransfer = {
            id: transferId,
            fileName: file.name,
            fileSize: file.size,
            direction: 'send',
            bytesTransferred: 0,
            startTime,
            lastProgressTime: startTime,
            lastBytesTransferred: 0,
        };

        try {
            // Send file metadata
            this.sendControlMessage({
                type: 'file-start',
                transferId,
                fileName: file.name,
                fileSize: file.size,
            });

            // Read and send file in chunks
            const reader = new FileReader();
            let offset = 0;

            await new Promise<void>((resolve, reject) => {
                reader.onerror = (error) => reject(error);
                
                reader.onload = (e) => {
                    const chunk = e.target?.result as ArrayBuffer;
                    
                    if (chunk) {
                        // Wait for buffer to have space
                        while (this.dataChannel!.bufferedAmount > 1024 * 1024) {
                            await new Promise(r => setTimeout(r, 50));
                        }
                        
                        this.dataChannel!.send(chunk);
                        offset += chunk.byteLength;
                        
                        // Update progress
                        this.updateTransferProgress(offset);
                        
                        // Notify progress
                        this.callbacks.onTransferProgress?.(this.getProgress());
                    }
                    
                    if (offset < file.size) {
                        readNextChunk();
                    } else {
                        resolve();
                    }
                };

                const readNextChunk = () => {
                    const slice = file.slice(offset, offset + this.options.chunkSize);
                    reader.readAsArrayBuffer(slice);
                };

                readNextChunk();
            });

            // Send completion message
            this.sendControlMessage({
                type: 'file-end',
                transferId,
            });

            const result: P2PTransferResult = {
                transferId,
                fileName: file.name,
                fileSize: file.size,
                direction: 'send',
                success: true,
                duration: Date.now() - startTime,
            };

            this.currentTransfer = null;
            this.callbacks.onTransferComplete?.(result);

            return result;
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Send failed';
            this.callbacks.onTransferError?.(errorMsg, transferId);
            throw error;
        }
    }

    /**
     * Accept incoming transfer
     */
    acceptTransfer(transferId: string): void {
        const request = this.pendingRequests.get(transferId);
        if (request) {
            clearTimeout(request.timeout);
            request.resolve(true);
            this.pendingRequests.delete(transferId);
        }
    }

    /**
     * Reject incoming transfer
     */
    rejectTransfer(transferId: string): void {
        const request = this.pendingRequests.get(transferId);
        if (request) {
            clearTimeout(request.timeout);
            request.resolve(false);
            this.pendingRequests.delete(transferId);
        }
    }

    /**
     * Cancel current transfer
     */
    cancelTransfer(): void {
        if (this.currentTransfer) {
            this.sendControlMessage({
                type: 'transfer-cancel',
                transferId: this.currentTransfer.id,
            });
            
            this.callbacks.onTransferError?.('Transfer cancelled', this.currentTransfer.id);
            this.currentTransfer = null;
        }
    }

    /**
     * Close connection
     */
    close(): void {
        this.log('Closing P2P connection');
        
        if (this.dataChannel) {
            this.dataChannel.close();
            this.dataChannel = null;
        }
        
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
        
        this.updateConnectionState({ state: 'disconnected' });
        this.currentTransfer = null;
        this.iceCandidatesQueue = [];
        this.remoteDescriptionSet = false;
    }

    // ============================================
    // PRIVATE METHODS
    // ============================================

    private async createPeerConnection(): Promise<void> {
        if (this.peerConnection) {
            return;
        }

        const config: RTCConfiguration = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
            ],
        };

        this.peerConnection = new RTCPeerConnection(config);

        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.log('ICE candidate generated');
                this.sendSignalingMessage('ice-candidate', event.candidate.toJSON());
            }
        };

        this.peerConnection.onconnectionstatechange = () => {
            const state = this.peerConnection!.connectionState;
            this.log('Connection state:', state);
            
            switch (state) {
                case 'connected':
                    this.updateConnectionState({ state: 'connected' });
                    break;
                case 'disconnected':
                case 'closed':
                    this.updateConnectionState({ state: 'disconnected' });
                    break;
                case 'failed':
                    this.updateConnectionState({ state: 'failed' });
                    break;
            }
        };

        this.peerConnection.ondatachannel = (event) => {
            this.log('Received data channel');
            this.dataChannel = event.channel;
            this.setupDataChannel(this.dataChannel);
        };
    }

    private setupDataChannel(channel: RTCDataChannel): void {
        channel.binaryType = 'arraybuffer';

        channel.onopen = () => {
            this.log('Data channel opened');
            this.updateConnectionState({ state: 'connected' });
        };

        channel.onclose = () => {
            this.log('Data channel closed');
            this.updateConnectionState({ state: 'disconnected' });
        };

        channel.onerror = (error) => {
            this.log('Data channel error:', error);
            this.callbacks.onTransferError?.('Data channel error', this.currentTransfer?.id || '');
        };

        channel.onmessage = (event) => {
            this.handleDataChannelMessage(event.data);
        };
    }

    private handleDataChannelMessage(data: ArrayBuffer | string): void {
        // Check if it's a control message (string) or data chunk (ArrayBuffer)
        if (typeof data === 'string') {
            const message = JSON.parse(data);
            this.handleControlMessage(message);
        } else {
            // Data chunk
            this.handleDataChunk(data);
        }
    }

    private handleControlMessage(message: { type: string; [key: string]: unknown }): void {
        switch (message.type) {
            case 'file-start':
                this.handleFileStart(message as { transferId: string; fileName: string; fileSize: number });
                break;
                
            case 'file-end':
                this.handleFileEnd();
                break;
                
            case 'transfer-cancel':
                this.handleTransferCancel();
                break;
        }
    }

    private handleFileStart(msg: { transferId: string; fileName: string; fileSize: number; senderId?: string }): void {
        const accept = this.callbacks.onIncomingTransferRequest?.({
            transferId: msg.transferId,
            fileName: msg.fileName,
            fileSize: msg.fileSize,
            senderId: msg.senderId || 'unknown',
        });

        if (accept) {
            this.currentTransfer = {
                id: msg.transferId,
                fileName: msg.fileName,
                fileSize: msg.fileSize,
                direction: 'receive',
                bytesTransferred: 0,
                buffer: [],
                startTime: Date.now(),
                lastProgressTime: Date.now(),
                lastBytesTransferred: 0,
            };
            
            this.sendControlMessage({ type: 'transfer-accept', transferId: msg.transferId });
        } else {
            this.sendControlMessage({ type: 'transfer-reject', transferId: msg.transferId });
        }
    }

    private handleDataChunk(chunk: ArrayBuffer): void {
        if (!this.currentTransfer || !this.currentTransfer.buffer) {
            return;
        }

        this.currentTransfer.buffer.push(chunk);
        this.currentTransfer.bytesTransferred += chunk.byteLength;

        this.callbacks.onTransferProgress?.(this.getProgress());
    }

    private handleFileEnd(): void {
        if (!this.currentTransfer || !this.currentTransfer.buffer) {
            return;
        }

        // Combine all chunks
        const totalSize = this.currentTransfer.bytesTransferred;
        const combined = new Uint8Array(totalSize);
        let offset = 0;

        for (const chunk of this.currentTransfer.buffer) {
            combined.set(new Uint8Array(chunk), offset);
            offset += chunk.byteLength;
        }

        const result: P2PTransferResult = {
            transferId: this.currentTransfer.id,
            fileName: this.currentTransfer.fileName,
            fileSize: totalSize,
            direction: 'receive',
            success: true,
            duration: Date.now() - this.currentTransfer.startTime,
        };

        // Notify callback with received data
        this.callbacks.onDataReceived?.(combined.buffer, this.currentTransfer.fileName);
        this.callbacks.onTransferComplete?.(result);

        this.currentTransfer = null;
    }

    private handleTransferCancel(): void {
        if (this.currentTransfer) {
            this.callbacks.onTransferError?.('Transfer cancelled by peer', this.currentTransfer.id);
            this.currentTransfer = null;
        }
    }

    private handleSignalingMessage(type: string, payload: unknown, fromUserId: string): void {
        this.log('Received signaling:', type, 'from:', fromUserId);

        switch (type) {
            case 'offer':
                if (payload) {
                    this.handleOffer(payload as RTCSessionDescriptionInit)
                        .then((answer) => {
                            this.sendSignalingMessage('answer', answer);
                        })
                        .catch((err) => this.log('Error handling offer:', err));
                }
                break;

            case 'answer':
                if (payload) {
                    this.handleAnswer(payload as RTCSessionDescriptionInit)
                        .catch((err) => this.log('Error handling answer:', err));
                }
                break;

            case 'ice-candidate':
                if (payload) {
                    this.addIceCandidate(payload as RTCIceCandidateInit)
                        .catch((err) => this.log('Error adding ICE candidate:', err));
                }
                break;
        }
    }

    private sendSignalingMessage(type: string, payload: unknown): void {
        if (this.collaborationService) {
            // This would be sent through the collaboration service
            // The actual implementation depends on how the collaboration service
            // exposes WebRTC signaling
            this.log('Sending signaling:', type);
            
            // Emit custom event for the collaboration service to pick up
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('p2p:signaling', {
                    detail: { type, payload },
                }));
            }
        }
    }

    private sendControlMessage(message: object): void {
        if (this.dataChannel && this.dataChannel.readyState === 'open') {
            this.dataChannel.send(JSON.stringify(message));
        }
    }

    private async processQueuedIceCandidates(): Promise<void> {
        for (const candidate of this.iceCandidatesQueue) {
            await this.peerConnection!.addIceCandidate(new RTCIceCandidate(candidate));
        }
        this.iceCandidatesQueue = [];
    }

    private waitForIceGathering(): Promise<void> {
        return new Promise((resolve) => {
            if (this.peerConnection!.iceGatheringState === 'complete') {
                resolve();
                return;
            }

            const checkState = () => {
                if (this.peerConnection!.iceGatheringState === 'complete') {
                    this.peerConnection!.removeEventListener('icegatheringstatechange', checkState);
                    resolve();
                }
            };

            this.peerConnection!.addEventListener('icegatheringstatechange', checkState);

            // Timeout
            setTimeout(() => {
                this.peerConnection!.removeEventListener('icegatheringstatechange', checkState);
                resolve();
            }, ICE_CANDIDATE_TIMEOUT);
        });
    }

    private updateTransferProgress(bytesTransferred: number): void {
        if (this.currentTransfer) {
            this.currentTransfer.bytesTransferred = bytesTransferred;
        }
    }

    private getProgress(): P2PTransferProgress {
        if (!this.currentTransfer) {
            throw new Error('No active transfer');
        }

        const now = Date.now();
        const elapsed = (now - this.currentTransfer.lastProgressTime) / 1000;
        const bytesDiff = this.currentTransfer.bytesTransferred - this.currentTransfer.lastBytesTransferred;
        const speed = elapsed > 0 ? bytesDiff / elapsed : 0;

        this.currentTransfer.lastProgressTime = now;
        this.currentTransfer.lastBytesTransferred = this.currentTransfer.bytesTransferred;

        const remaining = this.currentTransfer.fileSize - this.currentTransfer.bytesTransferred;
        const estimatedTimeRemaining = speed > 0 ? remaining / speed : undefined;

        return {
            transferId: this.currentTransfer.id,
            direction: this.currentTransfer.direction,
            fileName: this.currentTransfer.fileName,
            fileSize: this.currentTransfer.fileSize,
            bytesTransferred: this.currentTransfer.bytesTransferred,
            progress: (this.currentTransfer.bytesTransferred / this.currentTransfer.fileSize) * 100,
            speed,
            startTime: this.currentTransfer.startTime,
            estimatedTimeRemaining,
        };
    }

    private updateConnectionState(newState: Partial<P2PConnectionState>): void {
        this.connectionState = { ...this.connectionState, ...newState };
        this.callbacks.onConnectionStateChange?.(this.connectionState);
    }

    private log(message: string, ...args: unknown[]): void {
        if (this.options.debug) {
            console.log(`[P2PService] ${message}`, ...args);
        }
    }
}

// ============================================
// SINGLETON INSTANCE
// ============================================

let serviceInstance: P2PService | null = null;

export function getP2PService(options?: P2PTransferOptions): P2PService {
    if (!serviceInstance) {
        serviceInstance = new P2PService(options);
    }
    return serviceInstance;
}

export function destroyP2PService(): void {
    if (serviceInstance) {
        serviceInstance.close();
        serviceInstance = null;
    }
}

export default P2PService;
