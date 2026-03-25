/**
 * OcrService
 * ==========
 * 
 * Service for managing OCR operations via Web Worker.
 * Provides a Promise-based API for OCR processing with progress tracking.
 * 
 * Features:
 * - Lazy initialization of OCR worker
 * - Progress callbacks
 * - Cancellation support
 * - Multi-language support
 * - Automatic cleanup
 */

import type { TextRegion, OcrResult, OcrProgress } from '../workers/ocr.worker';

// ============================================
// TYPES
// ============================================

export type { TextRegion, OcrResult, OcrProgress };

export interface OcrServiceOptions {
    language?: string;
    debug?: boolean;
    onProgress?: (progress: OcrProgress) => void;
}

export interface OcrServiceCallbacks {
    onProgress?: (progress: OcrProgress) => void;
}

// ============================================
// OCR SERVICE CLASS
// ============================================

export class OcrService {
    private worker: Worker | null = null;
    private language: string;
    private debug: boolean;
    private callbacks: OcrServiceCallbacks = {};
    private pendingRequests: Map<string, {
        resolve: (value: unknown) => void;
        reject: (reason: unknown) => void;
        progress?: (progress: OcrProgress) => void;
    }> = new Map();
    private isInitialized = false;
    private initPromise: Promise<void> | null = null;

    constructor(options: OcrServiceOptions = {}) {
        this.language = options.language || 'eng';
        this.debug = options.debug ?? false;
        this.callbacks.onProgress = options.onProgress;
    }

    // ============================================
    // PUBLIC METHODS
    // ============================================

    /**
     * Initialize the OCR service
     * Must be called before processing
     */
    async initialize(language?: string): Promise<void> {
        if (this.isInitialized && (!language || language === this.language)) {
            return;
        }

        // Wait for any pending initialization
        if (this.initPromise) {
            await this.initPromise;
            return;
        }

        this.initPromise = this.doInitialize(language);
        await this.initPromise;
        this.initPromise = null;
    }

    private async doInitialize(language?: string): Promise<void> {
        const lang = language || this.language;
        this.log('Initializing OCR service with language:', lang);

        // Create worker
        if (!this.worker) {
            this.worker = new Worker(
                new URL('../workers/ocr.worker.ts', import.meta.url),
                { type: 'module' }
            );
            this.worker.onmessage = this.handleWorkerMessage.bind(this);
            this.worker.onerror = this.handleWorkerError.bind(this);
        }

        // Send init message
        const id = this.generateId();
        
        await new Promise<void>((resolve, reject) => {
            this.pendingRequests.set(id, {
                resolve: () => resolve(),
                reject,
            });

            this.worker?.postMessage({
                type: 'INIT',
                id,
                payload: { language: lang },
            });
        });

        this.language = lang;
        this.isInitialized = true;
        this.log('OCR service initialized');
    }

    /**
     * Process an image for OCR
     */
    async processImage(
        imageData: ImageData | ArrayBuffer,
        options?: { language?: string; onProgress?: (progress: OcrProgress) => void }
    ): Promise<OcrResult> {
        // Ensure initialized
        if (!this.isInitialized) {
            await this.initialize(options?.language);
        }

        // Change language if needed
        if (options?.language && options.language !== this.language) {
            await this.setLanguage(options.language);
        }

        const id = this.generateId();
        this.log('Processing image with OCR, id:', id);

        return new Promise((resolve, reject) => {
            this.pendingRequests.set(id, {
                resolve: resolve as (value: unknown) => void,
                reject,
                progress: options?.onProgress,
            });

            this.worker?.postMessage({
                type: 'PROCESS',
                id,
                payload: { imageData },
            });
        });
    }

    /**
     * Set the OCR language
     */
    async setLanguage(language: string): Promise<void> {
        if (language === this.language && this.isInitialized) {
            return;
        }

        this.log('Setting language to:', language);

        const id = this.generateId();

        await new Promise<void>((resolve, reject) => {
            this.pendingRequests.set(id, {
                resolve: () => {
                    this.language = language;
                    resolve();
                },
                reject,
            });

            this.worker?.postMessage({
                type: 'SET_LANGUAGE',
                id,
                payload: { language },
            });
        });
    }

    /**
     * Cancel current OCR processing
     */
    cancel(): void {
        this.log('Cancelling OCR processing');

        const id = this.generateId();

        this.worker?.postMessage({
            type: 'CANCEL',
            id,
        });

        // Reject all pending requests
        for (const [requestId, pending] of this.pendingRequests) {
            pending.reject(new Error('OCR processing cancelled'));
        }
        this.pendingRequests.clear();
    }

    /**
     * Terminate the OCR worker
     */
    terminate(): void {
        this.log('Terminating OCR service');

        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }

        this.isInitialized = false;
        this.pendingRequests.clear();
    }

    /**
     * Get current language
     */
    getLanguage(): string {
        return this.language;
    }

    /**
     * Check if service is ready
     */
    isReady(): boolean {
        return this.isInitialized && this.worker !== null;
    }

    // ============================================
    // PRIVATE METHODS
    // ============================================

    private generateId(): string {
        return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    private handleWorkerMessage(event: MessageEvent): void {
        const { type, id, payload, error } = event.data;
        this.log('Worker message:', type, id);

        const pending = this.pendingRequests.get(id);
        if (!pending) {
            // Progress messages may not have a pending request
            if (type === 'PROGRESS') {
                const progress = payload as OcrProgress;
                // Call specific progress callback if available
                if (pending?.progress) {
                    pending.progress(progress);
                }
                // Also call global callback
                this.callbacks.onProgress?.(progress);
            }
            return;
        }

        switch (type) {
            case 'SUCCESS':
                this.pendingRequests.delete(id);
                pending.resolve(payload);
                break;

            case 'ERROR':
                this.pendingRequests.delete(id);
                pending.reject(new Error(error || 'OCR processing failed'));
                break;

            case 'CANCELLED':
                this.pendingRequests.delete(id);
                pending.reject(new Error('OCR processing cancelled'));
                break;

            case 'PROGRESS':
                const progress = payload as OcrProgress;
                if (pending.progress) {
                    pending.progress(progress);
                }
                this.callbacks.onProgress?.(progress);
                break;

            default:
                this.log('Unknown message type:', type);
        }
    }

    private handleWorkerError(event: ErrorEvent): void {
        this.log('Worker error:', event.message);

        // Reject all pending requests
        for (const [, pending] of this.pendingRequests) {
            pending.reject(new Error(`Worker error: ${event.message}`));
        }
        this.pendingRequests.clear();

        // Reset state
        this.isInitialized = false;
        this.worker = null;
    }

    private log(message: string, ...args: unknown[]): void {
        if (this.debug) {
            console.log(`[OcrService] ${message}`, ...args);
        }
    }
}

// ============================================
// SINGLETON INSTANCE
// ============================================

let serviceInstance: OcrService | null = null;

/**
 * Get the OCR service singleton
 */
export function getOcrService(options?: OcrServiceOptions): OcrService {
    if (!serviceInstance) {
        serviceInstance = new OcrService(options);
    }
    return serviceInstance;
}

/**
 * Destroy the OCR service singleton
 */
export function destroyOcrService(): void {
    if (serviceInstance) {
        serviceInstance.terminate();
        serviceInstance = null;
    }
}

export default OcrService;
