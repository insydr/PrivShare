/**
 * useOcrProcessor Hook
 * ====================
 * 
 * React hook for OCR processing with Tesseract.js integration.
 * Provides automatic OCR on document load and manual OCR triggering.
 * 
 * Features:
 * - Automatic initialization
 * - Progress tracking
 * - Language selection
 * - Integration with document store
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import Tesseract from 'tesseract.js';
import { useDocumentStore } from '../store/documentStore';

// ============================================
// TYPES
// ============================================

export interface TextRegion {
    id: string;
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
    confidence: number;
}

export interface OcrProgress {
    status: string;
    progress: number;
    message: string;
}

export interface OcrResult {
    regions: TextRegion[];
    fullText: string;
    processingTimeMs: number;
    language: string;
    confidence: number;
}

export interface UseOcrProcessorOptions {
    autoInit?: boolean;
    defaultLanguage?: string;
    debug?: boolean;
}

export interface UseOcrProcessorResult {
    isReady: boolean;
    isProcessing: boolean;
    progress: OcrProgress | null;
    error: string | null;
    language: string;
    availableLanguages: Array<{ code: string; name: string }>;
    textRegions: TextRegion[];
    fullText: string;
    confidence: number;
    initialize: () => Promise<void>;
    processImage: (imageData: ImageData | ArrayBuffer | string) => Promise<OcrResult>;
    setLanguage: (language: string) => Promise<void>;
    cancel: () => void;
    clearResults: () => void;
}

// ============================================
// CONSTANTS
// ============================================

const AVAILABLE_LANGUAGES = [
    { code: 'eng', name: 'English' },
    { code: 'chi_sim', name: 'Chinese (Simplified)' },
    { code: 'chi_tra', name: 'Chinese (Traditional)' },
    { code: 'jpn', name: 'Japanese' },
    { code: 'kor', name: 'Korean' },
    { code: 'fra', name: 'French' },
    { code: 'deu', name: 'German' },
    { code: 'spa', name: 'Spanish' },
    { code: 'por', name: 'Portuguese' },
    { code: 'rus', name: 'Russian' },
];

// ============================================
// HOOK IMPLEMENTATION
// ============================================

export function useOcrProcessor(options: UseOcrProcessorOptions = {}): UseOcrProcessorResult {
    const {
        autoInit = true,
        defaultLanguage = 'eng',
        debug = false,
    } = options;

    // State
    const [isReady, setIsReady] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [progress, setProgress] = useState<OcrProgress | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [language, setLanguageState] = useState(defaultLanguage);
    const [textRegions, setTextRegions] = useState<TextRegion[]>([]);
    const [fullText, setFullText] = useState('');
    const [confidence, setConfidence] = useState(0);

    // Refs
    const workerRef = useRef<Tesseract.Worker | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    // Store
    const { setProcessing, setTextRegions: setStoreTextRegions } = useDocumentStore();

    // ============================================
    // INITIALIZATION
    // ============================================

    const initialize = useCallback(async () => {
        if (workerRef.current) {
            setIsReady(true);
            return;
        }

        setError(null);
        setProgress({ status: 'loading', progress: 0, message: 'Loading OCR engine...' });

        try {
            if (debug) {
                console.log('[useOcrProcessor] Initializing with language:', language);
            }

            const worker = await Tesseract.createWorker(language, 1, {
                logger: (m) => {
                    if (debug) {
                        console.log('[useOcrProcessor] Tesseract:', m);
                    }
                    setProgress({
                        status: m.status,
                        progress: Math.round(m.progress * 100),
                        message: m.status,
                    });
                },
            });

            workerRef.current = worker;
            setIsReady(true);
            setProgress(null);

            if (debug) {
                console.log('[useOcrProcessor] Initialized successfully');
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to initialize OCR';
            setError(message);
            setIsReady(false);
            console.error('[useOcrProcessor] Initialization failed:', message);
        }
    }, [language, debug]);

    // Auto-init on mount
    useEffect(() => {
        if (autoInit) {
            initialize().catch(console.error);
        }

        return () => {
            if (workerRef.current) {
                workerRef.current.terminate();
                workerRef.current = null;
            }
        };
    }, [autoInit, initialize]);

    // ============================================
    // PROCESS IMAGE
    // ============================================

    const processImage = useCallback(async (
        imageData: ImageData | ArrayBuffer | string
    ): Promise<OcrResult> => {
        if (!workerRef.current) {
            throw new Error('OCR worker not initialized. Call initialize() first.');
        }

        setIsProcessing(true);
        setError(null);
        setProgress({ status: 'recognizing', progress: 0, message: 'Starting OCR...' });

        const startTime = performance.now();

        try {
            setProcessing({ stage: 'processing', progress: 10, message: 'Running OCR...' });

            // Create abort controller for cancellation
            abortControllerRef.current = new AbortController();

            // Process the image
            const result = await workerRef.current.recognize(imageData, {}, {
                rectangle: false,
            });

            // Extract text regions (words)
            const regions: TextRegion[] = result.data.words.map((word, index) => ({
                id: `region-${index}`,
                text: word.text,
                x: word.bbox.x0,
                y: word.bbox.y0,
                width: word.bbox.x1 - word.bbox.x0,
                height: word.bbox.y1 - word.bbox.y0,
                confidence: word.confidence,
            }));

            // Calculate average confidence
            const avgConfidence = regions.length > 0
                ? regions.reduce((sum, r) => sum + r.confidence, 0) / regions.length
                : 0;

            const processingTimeMs = performance.now() - startTime;

            // Store results
            setTextRegions(regions);
            setFullText(result.data.text);
            setConfidence(avgConfidence);

            // Update document store
            setStoreTextRegions(regions.map(r => ({
                id: r.id,
                text: r.text,
                x: r.x,
                y: r.y,
                width: r.width,
                height: r.height,
                confidence: r.confidence,
            })));

            setProcessing({ stage: 'idle', progress: 100, message: 'OCR complete' });
            setProgress(null);

            if (debug) {
                console.log('[useOcrProcessor] OCR complete:', {
                    regionCount: regions.length,
                    confidence: avgConfidence,
                    time: processingTimeMs,
                });
            }

            return {
                regions,
                fullText: result.data.text,
                processingTimeMs,
                language,
                confidence: avgConfidence,
            };
        } catch (err) {
            const message = err instanceof Error ? err.message : 'OCR processing failed';
            setError(message);
            setProcessing({ stage: 'error', progress: 0, message });
            throw err;
        } finally {
            setIsProcessing(false);
            abortControllerRef.current = null;
        }
    }, [language, debug, setProcessing, setStoreTextRegions]);

    // ============================================
    // SET LANGUAGE
    // ============================================

    const handleSetLanguage = useCallback(async (newLanguage: string) => {
        setLanguageState(newLanguage);

        // Re-initialize worker with new language
        if (workerRef.current) {
            await workerRef.current.terminate();
            workerRef.current = null;
        }

        setIsReady(false);
        setTextRegions([]);
        setFullText('');
        setConfidence(0);

        // Re-initialize with new language
        const originalLanguage = language;
        setLanguageState(newLanguage);
        
        await initialize();

        if (debug) {
            console.log('[useOcrProcessor] Language changed to:', newLanguage);
        }
    }, [initialize, debug, language]);

    // ============================================
    // CANCEL
    // ============================================

    const cancel = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }

        if (workerRef.current) {
            workerRef.current.terminate();
            workerRef.current = null;
        }

        setIsProcessing(false);
        setProgress(null);
        setProcessing({ stage: 'idle', progress: 0, message: '' });
        setIsReady(false);

        if (debug) {
            console.log('[useOcrProcessor] Cancelled');
        }
    }, [setProcessing, debug]);

    // ============================================
    // CLEAR RESULTS
    // ============================================

    const clearResults = useCallback(() => {
        setTextRegions([]);
        setFullText('');
        setConfidence(0);
    }, []);

    // ============================================
    // RETURN HOOK API
    // ============================================

    return {
        isReady,
        isProcessing,
        progress,
        error,
        language,
        availableLanguages: AVAILABLE_LANGUAGES,
        textRegions,
        fullText,
        confidence,
        initialize,
        processImage,
        setLanguage: handleSetLanguage,
        cancel,
        clearResults,
    };
}

// ============================================
// EXTENDED HOOK WITH PII DETECTION
// ============================================

export function useOcrWithPiiDetection(options: UseOcrProcessorOptions = {}) {
    const ocrProcessor = useOcrProcessor(options);

    const processAndDetectPii = useCallback(async (
        imageData: ImageData | ArrayBuffer | string
    ): Promise<OcrResult> => {
        // Run OCR first
        const ocrResult = await ocrProcessor.processImage(imageData);
        
        // PII detection will be done by Wasm module separately
        // This hook just provides the text regions for PII detection
        return ocrResult;
    }, [ocrProcessor]);

    return {
        ...ocrProcessor,
        processAndDetectPii,
    };
}

export default useOcrProcessor;
