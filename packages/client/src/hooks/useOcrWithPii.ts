/**
 * useOcrWithPii Hook
 * ===================
 * 
 * Combined hook that integrates OCR text extraction with PII detection.
 * Provides a seamless workflow for processing documents and detecting
 * sensitive information.
 * 
 * Workflow:
 * 1. Load image → Run OCR → Extract text regions
 * 2. Process text regions → Detect PII
 * 3. Generate redaction boxes for detected PII
 * 4. Apply redactions using WASM
 */

import { useState, useCallback, useRef } from 'react';
import { useOcrProcessor, type TextRegion, type OcrResult } from './useOcrProcessor';
import { 
    PiiDetectionService, 
    getPiiDetectionService,
    type PiiDetection,
    type PiiDetectionResult,
    type PiiDetectionOptions 
} from '../services/PiiDetectionService';
import { useDocumentStore } from '../store/documentStore';

// ============================================
// TYPES
// ============================================

export interface PiiRegion {
    id: string;
    text: string;
    piiType: string;
    piiTypeName: string;
    x: number;
    y: number;
    width: number;
    height: number;
    confidence: number;
    severity: 'high' | 'medium' | 'low';
}

export interface OcrPiiResult {
    ocrResult: OcrResult;
    piiResult: PiiDetectionResult;
    piiRegions: PiiRegion[];
    highSeverityCount: number;
    totalPiiCount: number;
}

export interface UseOcrWithPiiOptions {
    autoInit?: boolean;
    defaultLanguage?: string;
    debug?: boolean;
    piiDetectionOptions?: PiiDetectionOptions;
    autoDetectPii?: boolean;
    minPiiConfidence?: number;
}

export interface UseOcrWithPiiResult {
    // OCR State
    isReady: boolean;
    isProcessing: boolean;
    progress: { status: string; progress: number; message: string } | null;
    error: string | null;
    language: string;
    availableLanguages: Array<{ code: string; name: string }>;
    
    // PII State
    isDetectingPii: boolean;
    piiDetections: PiiDetection[];
    piiRegions: PiiRegion[];
    piiStats: {
        total: number;
        high: number;
        medium: number;
        low: number;
        types: string[];
    };
    
    // Results
    textRegions: TextRegion[];
    fullText: string;
    confidence: number;
    
    // Actions
    initialize: () => Promise<void>;
    processAndDetect: (imageData: ImageData | ArrayBuffer | string) => Promise<OcrPiiResult>;
    processImage: (imageData: ImageData | ArrayBuffer | string) => Promise<OcrResult>;
    detectPii: (text?: string) => Promise<PiiDetectionResult>;
    setLanguage: (language: string) => Promise<void>;
    cancel: () => void;
    clearResults: () => void;
    createRedactionBoxes: () => Array<{ 
        id: string; 
        x: number; 
        y: number; 
        width: number; 
        height: number; 
        type: string; 
        piiType?: string;
        confidence: number;
    }>;
}

// ============================================
// HOOK IMPLEMENTATION
// ============================================

export function useOcrWithPii(options: UseOcrWithPiiOptions = {}): UseOcrWithPiiResult {
    const {
        autoInit = true,
        defaultLanguage = 'eng',
        debug = false,
        piiDetectionOptions = {},
        minPiiConfidence = 50,
    } = options;

    // ============================================
    // STATE
    // ============================================

    const [isDetectingPii, setIsDetectingPii] = useState(false);
    const [piiDetections, setPiiDetections] = useState<PiiDetection[]>([]);
    const [piiRegions, setPiiRegions] = useState<PiiRegion[]>([]);
    const [piiStats, setPiiStats] = useState({
        total: 0,
        high: 0,
        medium: 0,
        low: 0,
        types: [] as string[],
    });

    // Refs
    const piiServiceRef = useRef<PiiDetectionService | null>(null);

    // Store
    const { setPiiMatches } = useDocumentStore();

    // OCR Hook
    const ocrProcessor = useOcrProcessor({
        autoInit,
        defaultLanguage,
        debug,
    });

    // ============================================
    // INITIALIZE PII SERVICE
    // ============================================

    const ensurePiiService = useCallback(() => {
        if (!piiServiceRef.current) {
            piiServiceRef.current = getPiiDetectionService({
                minConfidence: minPiiConfidence,
                ...piiDetectionOptions,
            });
        }
        return piiServiceRef.current;
    }, [minPiiConfidence, piiDetectionOptions]);

    // ============================================
    // DETECT PII
    // ============================================

    const detectPii = useCallback(async (text?: string): Promise<PiiDetectionResult> => {
        const piiService = ensurePiiService();
        
        setIsDetectingPii(true);

        try {
            const textToAnalyze = text || ocrProcessor.fullText;
            const regions = ocrProcessor.textRegions.map(r => ({
                text: r.text,
                x: r.x,
                y: r.y,
                width: r.width,
                height: r.height,
            }));

            const result = piiService.detect(textToAnalyze, regions);

            // Update state
            setPiiDetections(result.detections);
            setPiiStats({
                total: result.totalCount,
                high: result.highSeverityCount,
                medium: result.mediumSeverityCount,
                low: result.lowSeverityCount,
                types: result.uniqueTypes,
            });

            // Generate PII regions with coordinates
            const regions_with_coords: PiiRegion[] = result.detections
                .filter(d => d.regionIndex !== undefined && ocrProcessor.textRegions[d.regionIndex])
                .map(detection => {
                    const region = ocrProcessor.textRegions[detection.regionIndex!];
                    return {
                        id: `pii-region-${detection.id}`,
                        text: detection.value,
                        piiType: detection.type,
                        piiTypeName: detection.typeName,
                        x: region.x,
                        y: region.y,
                        width: region.width,
                        height: region.height,
                        confidence: detection.confidence,
                        severity: detection.severity,
                    };
                });

            setPiiRegions(regions_with_coords);

            // Update document store
            setPiiMatches(result.detections.map(d => ({
                piiType: d.type as any,
                text: d.value,
                regionIndex: d.regionIndex ?? 0,
                confidence: d.confidence,
            })));

            if (debug) {
                console.log('[useOcrWithPii] PII detection complete:', {
                    total: result.totalCount,
                    types: result.uniqueTypes,
                    regions: regions_with_coords.length,
                });
            }

            return result;
        } finally {
            setIsDetectingPii(false);
        }
    }, [ensurePiiService, ocrProcessor.fullText, ocrProcessor.textRegions, setPiiMatches, debug]);

    // ============================================
    // PROCESS AND DETECT
    // ============================================

    const processAndDetect = useCallback(async (
        imageData: ImageData | ArrayBuffer | string
    ): Promise<OcrPiiResult> => {
        // Run OCR first
        const ocrResult = await ocrProcessor.processImage(imageData);

        // Then detect PII
        const piiResult = await detectPii(ocrResult.fullText);

        // Generate PII regions
        const piiRegions: PiiRegion[] = piiResult.detections
            .filter(d => d.regionIndex !== undefined && ocrResult.regions[d.regionIndex])
            .map(detection => {
                const region = ocrResult.regions[detection.regionIndex!];
                return {
                    id: `pii-region-${detection.id}`,
                    text: detection.value,
                    piiType: detection.type,
                    piiTypeName: detection.typeName,
                    x: region.x,
                    y: region.y,
                    width: region.width,
                    height: region.height,
                    confidence: detection.confidence,
                    severity: detection.severity,
                };
            });

        return {
            ocrResult,
            piiResult,
            piiRegions,
            highSeverityCount: piiResult.highSeverityCount,
            totalPiiCount: piiResult.totalCount,
        };
    }, [ocrProcessor, detectPii]);

    // ============================================
    // CREATE REDACTION BOXES
    // ============================================

    const createRedactionBoxes = useCallback(() => {
        return piiRegions.map(region => ({
            id: `redact-${region.id}`,
            x: region.x,
            y: region.y,
            width: region.width,
            height: region.height,
            type: 'auto',
            piiType: region.piiType,
            confidence: region.confidence,
        }));
    }, [piiRegions]);

    // ============================================
    // CLEAR RESULTS
    // ============================================

    const clearResults = useCallback(() => {
        ocrProcessor.clearResults();
        setPiiDetections([]);
        setPiiRegions([]);
        setPiiStats({ total: 0, high: 0, medium: 0, low: 0, types: [] });
    }, [ocrProcessor]);

    // ============================================
    // RETURN HOOK API
    // ============================================

    return {
        // OCR State
        isReady: ocrProcessor.isReady,
        isProcessing: ocrProcessor.isProcessing,
        progress: ocrProcessor.progress,
        error: ocrProcessor.error,
        language: ocrProcessor.language,
        availableLanguages: ocrProcessor.availableLanguages,
        
        // PII State
        isDetectingPii,
        piiDetections,
        piiRegions,
        piiStats,
        
        // Results
        textRegions: ocrProcessor.textRegions,
        fullText: ocrProcessor.fullText,
        confidence: ocrProcessor.confidence,
        
        // Actions
        initialize: ocrProcessor.initialize,
        processAndDetect,
        processImage: ocrProcessor.processImage,
        detectPii,
        setLanguage: ocrProcessor.setLanguage,
        cancel: ocrProcessor.cancel,
        clearResults,
        createRedactionBoxes,
    };
}

export default useOcrWithPii;
