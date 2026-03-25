/**
 * useWasmProcessor Hook
 * =====================
 * 
 * React hook for integrating WASM processing into components.
 * Provides a clean API for all WASM operations with automatic
 * state management and error handling.
 * 
 * Features:
 * - Automatic initialization on mount (configurable)
 * - Loading states (idle, loading, ready, error)
 * - Error handling with React state
 * - Cleanup on unmount
 * - TypeScript support
 * 
 * Usage:
 * ```tsx
 * const { 
 *   isReady, 
 *   loadImage, 
 *   redactBox, 
 *   getHash 
 * } = useWasmProcessor({ autoInit: true });
 * 
 * const result = await loadImage(file);
 * ```
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { WasmWorker } from '../workers/WasmWorker';
import type {
    WasmLoadingState,
    WasmModuleInfo,
    Box,
    LoadImageResult,
    RedactResult,
    ImageInfo,
    PiiMatch,
    TextRegion,
    UseWasmProcessorResult,
    UseWasmProcessorOptions,
} from '../types/wasm-worker';

// ============================================
// HOOK IMPLEMENTATION
// ============================================

export function useWasmProcessor(options: UseWasmProcessorOptions = {}): UseWasmProcessorResult {
    const {
        autoInit = true,
        debug = false,
        timeout = 30000,
    } = options;

    // ============================================
    // STATE
    // ============================================

    const [loadingState, setLoadingState] = useState<WasmLoadingState>('idle');
    const [error, setError] = useState<string | null>(null);
    const [moduleInfo, setModuleInfo] = useState<WasmModuleInfo | null>(null);

    // Use ref to hold the worker instance (prevents recreation on re-renders)
    const workerRef = useRef<WasmWorker | null>(null);
    const initPromiseRef = useRef<Promise<void> | null>(null);

    // ============================================
    // COMPUTED PROPERTIES
    // ============================================

    const isReady = loadingState === 'ready';
    const isLoading = loadingState === 'loading';

    // ============================================
    // INITIALIZE
    // ============================================

    const initialize = useCallback(async (): Promise<void> => {
        // Prevent multiple concurrent initializations
        if (initPromiseRef.current) {
            return initPromiseRef.current;
        }

        // Already initialized
        if (loadingState === 'ready') {
            return;
        }

        setLoadingState('loading');
        setError(null);

        try {
            // Create worker if not exists
            if (!workerRef.current) {
                workerRef.current = new WasmWorker({ timeout, debug });
            }

            // Initialize
            initPromiseRef.current = workerRef.current.initialize();
            await initPromiseRef.current;

            setModuleInfo(workerRef.current.moduleInfo);
            setLoadingState('ready');

            console.log('[useWasmProcessor] WASM module initialized successfully');
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setError(message);
            setLoadingState('error');
            console.error('[useWasmProcessor] Initialization failed:', message);
            throw err;
        } finally {
            initPromiseRef.current = null;
        }
    }, [loadingState, timeout, debug]);

    // ============================================
    // LOAD IMAGE
    // ============================================

    const loadImage = useCallback(async (file: File): Promise<LoadImageResult> => {
        if (!workerRef.current?.isReady) {
            throw new Error('WASM module not initialized. Call initialize() first.');
        }

        setError(null);

        try {
            const result = await workerRef.current.loadImage(file);
            console.log('[useWasmProcessor] Image loaded:', result.dimensions);
            return result;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setError(message);
            throw err;
        }
    }, []);

    // ============================================
    // REDACT OPERATIONS
    // ============================================

    const redactBox = useCallback(async (
        buffer: ArrayBuffer,
        box: Box
    ): Promise<RedactResult> => {
        if (!workerRef.current?.isReady) {
            throw new Error('WASM module not initialized');
        }

        setError(null);

        try {
            const result = await workerRef.current.redactBox(buffer, box);
            console.log('[useWasmProcessor] Box redacted:', result.redactedPixels, 'pixels');
            return result;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setError(message);
            throw err;
        }
    }, []);

    const redactMultiple = useCallback(async (
        buffer: ArrayBuffer,
        boxes: Box[]
    ): Promise<RedactResult> => {
        if (!workerRef.current?.isReady) {
            throw new Error('WASM module not initialized');
        }

        setError(null);

        try {
            const result = await workerRef.current.redactMultiple(buffer, boxes);
            console.log('[useWasmProcessor] Multiple redactions:', result.redactedPixels, 'pixels');
            return result;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setError(message);
            throw err;
        }
    }, []);

    // ============================================
    // HASH OPERATIONS
    // ============================================

    const getHash = useCallback(async (
        buffer: ArrayBuffer,
        label?: string
    ): Promise<string> => {
        if (!workerRef.current?.isReady) {
            throw new Error('WASM module not initialized');
        }

        setError(null);

        try {
            const hash = await workerRef.current.getHash(buffer, label);
            return hash;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setError(message);
            throw err;
        }
    }, []);

    // ============================================
    // IMAGE UTILITIES
    // ============================================

    const getImageInfo = useCallback(async (buffer: ArrayBuffer): Promise<ImageInfo> => {
        if (!workerRef.current?.isReady) {
            throw new Error('WASM module not initialized');
        }

        setError(null);

        try {
            const info = await workerRef.current.getImageInfo(buffer);
            return info;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setError(message);
            throw err;
        }
    }, []);

    const resizeImage = useCallback(async (
        buffer: ArrayBuffer,
        width: number,
        height: number
    ): Promise<ArrayBuffer> => {
        if (!workerRef.current?.isReady) {
            throw new Error('WASM module not initialized');
        }

        setError(null);

        try {
            const result = await workerRef.current.resizeImage(buffer, width, height);
            return result;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setError(message);
            throw err;
        }
    }, []);

    const toGrayscale = useCallback(async (buffer: ArrayBuffer): Promise<ArrayBuffer> => {
        if (!workerRef.current?.isReady) {
            throw new Error('WASM module not initialized');
        }

        setError(null);

        try {
            const result = await workerRef.current.toGrayscale(buffer);
            return result;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setError(message);
            throw err;
        }
    }, []);

    // ============================================
    // PII DETECTION
    // ============================================

    const detectPii = useCallback(async (regions: TextRegion[]): Promise<PiiMatch[]> => {
        if (!workerRef.current?.isReady) {
            throw new Error('WASM module not initialized');
        }

        setError(null);

        try {
            const matches = await workerRef.current.detectPii(regions);
            console.log('[useWasmProcessor] PII detected:', matches.length, 'matches');
            return matches;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setError(message);
            throw err;
        }
    }, []);

    // ============================================
    // TERMINATE
    // ============================================

    const terminate = useCallback((): void => {
        if (workerRef.current) {
            console.log('[useWasmProcessor] Terminating worker');
            workerRef.current.terminate();
            workerRef.current = null;
        }

        setLoadingState('idle');
        setModuleInfo(null);
        setError(null);
        initPromiseRef.current = null;
    }, []);

    // ============================================
    // AUTO-INIT ON MOUNT
    // ============================================

    useEffect(() => {
        if (autoInit && loadingState === 'idle') {
            initialize().catch(console.error);
        }

        // Cleanup on unmount
        return () => {
            if (workerRef.current) {
                workerRef.current.terminate();
                workerRef.current = null;
            }
        };
    }, [autoInit, loadingState, initialize]);

    // ============================================
    // RETURN HOOK API
    // ============================================

    return {
        // State
        loadingState,
        isReady,
        isLoading,
        error,

        // Module info
        moduleInfo,

        // Actions
        initialize,
        loadImage,
        redactBox,
        redactMultiple,
        getHash,
        getImageInfo,
        resizeImage,
        toGrayscale,
        detectPii,
        terminate,
    };
}

// ============================================
// EXTENDED HOOK FOR DOCUMENT PROCESSING
// ============================================

/**
 * Extended hook that combines WASM processing with document state management
 */
export function useDocumentProcessor() {
    const wasmProcessor = useWasmProcessor({ autoInit: true });
    
    const [processingState, setProcessingState] = useState<{
        stage: 'idle' | 'loading' | 'processing' | 'redacting' | 'exporting' | 'complete' | 'error';
        progress: number;
        message: string;
    }>({
        stage: 'idle',
        progress: 0,
        message: '',
    });

    const [documentData, setDocumentData] = useState<{
        imageData: ImageData | null;
        dimensions: { width: number; height: number } | null;
        originalHash: string | null;
        currentBuffer: ArrayBuffer | null;
    }>({
        imageData: null,
        dimensions: null,
        originalHash: null,
        currentBuffer: null,
    });

    // Process a document file
    const processDocument = useCallback(async (file: File) => {
        if (!wasmProcessor.isReady) {
            throw new Error('WASM processor not ready');
        }

        try {
            setProcessingState({ stage: 'loading', progress: 10, message: 'Loading file...' });

            const result = await wasmProcessor.loadImage(file);

            setDocumentData({
                imageData: result.imageData,
                dimensions: result.dimensions,
                originalHash: result.hash,
                currentBuffer: await file.arrayBuffer(),
            });

            setProcessingState({ stage: 'complete', progress: 100, message: 'Document loaded' });

            return result;
        } catch (error) {
            setProcessingState({ 
                stage: 'error', 
                progress: 0, 
                message: error instanceof Error ? error.message : 'Processing failed' 
            });
            throw error;
        }
    }, [wasmProcessor]);

    // Apply redactions to the current document
    const applyRedactions = useCallback(async (boxes: Box[]) => {
        if (!documentData.currentBuffer) {
            throw new Error('No document loaded');
        }

        try {
            setProcessingState({ stage: 'redacting', progress: 50, message: 'Applying redactions...' });

            const result = await wasmProcessor.redactMultiple(documentData.currentBuffer, boxes);

            // Update current buffer with redacted version
            setDocumentData(prev => ({
                ...prev,
                currentBuffer: result.pngBuffer,
            }));

            setProcessingState({ stage: 'complete', progress: 100, message: 'Redactions applied' });

            return result;
        } catch (error) {
            setProcessingState({ 
                stage: 'error', 
                progress: 0, 
                message: error instanceof Error ? error.message : 'Redaction failed' 
            });
            throw error;
        }
    }, [documentData.currentBuffer, wasmProcessor]);

    // Export the current document as a download
    const exportDocument = useCallback((fileName: string) => {
        if (!documentData.currentBuffer) {
            throw new Error('No document to export');
        }

        const blob = new Blob([documentData.currentBuffer], { type: 'image/png' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName.replace(/\.[^.]+$/, '_redacted.png');
        link.click();
        URL.revokeObjectURL(url);
    }, [documentData.currentBuffer]);

    // Reset state
    const reset = useCallback(() => {
        setProcessingState({ stage: 'idle', progress: 0, message: '' });
        setDocumentData({
            imageData: null,
            dimensions: null,
            originalHash: null,
            currentBuffer: null,
        });
    }, []);

    return {
        // WASM processor state
        ...wasmProcessor,

        // Document processing state
        processingState,
        documentData,

        // Document actions
        processDocument,
        applyRedactions,
        exportDocument,
        reset,
    };
}

// ============================================
// EXPORTS
// ============================================

export default useWasmProcessor;
