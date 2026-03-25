/**
 * OCR Worker
 * ==========
 * 
 * Web Worker for running Tesseract.js OCR processing.
 * Offloads CPU-intensive OCR from the main thread to maintain UI responsiveness.
 * 
 * Features:
 * - Multi-language support (lazy loaded)
 * - Progress reporting
 * - Cancellation support
 * - Confidence scoring
 */

import Tesseract from 'tesseract.js';

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
    status: 'loading' | 'recognizing' | 'complete';
    progress: number; // 0-100
    message: string;
}

export interface OcrResult {
    regions: TextRegion[];
    fullText: string;
    processingTimeMs: number;
    language: string;
    confidence: number; // Average confidence
}

export interface OcrWorkerMessage {
    type: 'INIT' | 'PROCESS' | 'CANCEL' | 'SET_LANGUAGE';
    id: string;
    payload?: unknown;
}

export interface OcrWorkerResponse {
    type: 'PROGRESS' | 'SUCCESS' | 'ERROR' | 'CANCELLED';
    id: string;
    payload?: unknown;
    error?: string;
}

// ============================================
// STATE
// ============================================

let currentJob: Tesseract.Worker | null = null;
let isProcessing = false;
let currentLanguage = 'eng';
let workerInstance: Tesseract.Worker | null = null;

// ============================================
// HELPER FUNCTIONS
// ============================================

function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function sendMessage(response: OcrWorkerResponse): void {
    self.postMessage(response);
}

function sendProgress(id: string, progress: OcrProgress): void {
    sendMessage({
        type: 'PROGRESS',
        id,
        payload: progress,
    });
}

// ============================================
// OCR PROCESSING
// ============================================

async function initializeWorker(language: string = 'eng'): Promise<Tesseract.Worker> {
    if (workerInstance) {
        return workerInstance;
    }

    sendProgress('init', {
        status: 'loading',
        progress: 0,
        message: `Loading OCR engine (${language})...`,
    });

    workerInstance = await Tesseract.createWorker(language, 1, {
        logger: (m) => {
            if (m.status === 'loading tesseract core') {
                sendProgress('init', {
                    status: 'loading',
                    progress: Math.round(m.progress * 30),
                    message: 'Loading Tesseract core...',
                });
            } else if (m.status === 'initializing tesseract') {
                sendProgress('init', {
                    status: 'loading',
                    progress: 30 + Math.round(m.progress * 30),
                    message: 'Initializing OCR engine...',
                });
            } else if (m.status === 'loading language traineddata') {
                sendProgress('init', {
                    status: 'loading',
                    progress: 60 + Math.round(m.progress * 30),
                    message: `Loading ${language} language data...`,
                });
            } else if (m.status === 'initializing api') {
                sendProgress('init', {
                    status: 'loading',
                    progress: 95,
                    message: 'Finalizing initialization...',
                });
            }
        },
    });

    currentLanguage = language;

    return workerInstance;
}

async function processImage(
    id: string,
    imageData: ImageData | ArrayBuffer,
    language?: string
): Promise<OcrResult> {
    const startTime = performance.now();

    isProcessing = true;

    // Initialize worker if needed
    const lang = language || currentLanguage;
    if (lang !== currentLanguage || !workerInstance) {
        workerInstance = null;
        await initializeWorker(lang);
    }

    // Check if we have a valid worker
    if (!workerInstance) {
        throw new Error('OCR worker not initialized');
    }

    currentJob = workerInstance;

    sendProgress(id, {
        status: 'recognizing',
        progress: 0,
        message: 'Starting text recognition...',
    });

    // Process the image
    let imageBuffer: Buffer | string;

    if (imageData instanceof ArrayBuffer) {
        // Convert ArrayBuffer to Buffer for Tesseract
        imageBuffer = Buffer.from(imageData);
    } else {
        // Convert ImageData to canvas and then to buffer
        // For ImageData, we need to create a PNG
        const canvas = self.document?.createElement('canvas');
        if (!canvas) {
            // Fallback: create a data URL from ImageData
            const { width, height, data } = imageData;
            const rgbaData = new Uint8ClampedArray(data);
            
            // For worker context without canvas, we need to use offscreen canvas or pass as array buffer
            // Tesseract can handle raw pixel data via recognize method
            const result = await workerInstance.recognize(
                rgbaData,
                {
                    width,
                    height,
                },
                {
                    rectangle: false,
                    logger: (m) => {
                        if (m.status === 'recognizing text') {
                            sendProgress(id, {
                                status: 'recognizing',
                                progress: Math.round(m.progress * 100),
                                message: `Recognizing text... ${Math.round(m.progress * 100)}%`,
                            });
                        }
                    },
                }
            );

            isProcessing = false;
            currentJob = null;

            const regions: TextRegion[] = result.data.words.map((word, index) => ({
                id: `region-${index}`,
                text: word.text,
                x: word.bbox.x0,
                y: word.bbox.y0,
                width: word.bbox.x1 - word.bbox.x0,
                height: word.bbox.y1 - word.bbox.y0,
                confidence: word.confidence,
            }));

            const avgConfidence = regions.length > 0
                ? regions.reduce((sum, r) => sum + r.confidence, 0) / regions.length
                : 0;

            return {
                regions,
                fullText: result.data.text,
                processingTimeMs: performance.now() - startTime,
                language: lang,
                confidence: avgConfidence,
            };
        }
        
        canvas.width = imageData.width;
        canvas.height = imageData.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            throw new Error('Failed to get canvas context');
        }
        ctx.putImageData(imageData, 0, 0);
        
        // Get as blob/buffer
        const dataUrl = canvas.toDataURL('image/png');
        imageBuffer = dataUrl;
    }

    // Run OCR
    const result = await workerInstance.recognize(imageBuffer, {}, {
        rectangle: false,
        logger: (m) => {
            if (m.status === 'recognizing text') {
                sendProgress(id, {
                    status: 'recognizing',
                    progress: Math.round(m.progress * 100),
                    message: `Recognizing text... ${Math.round(m.progress * 100)}%`,
                });
            }
        },
    });

    isProcessing = false;
    currentJob = null;

    // Extract text regions
    const regions: TextRegion[] = result.data.words.map((word, index) => ({
        id: `region-${index}`,
        text: word.text,
        x: word.bbox.x0,
        y: word.bbox.y0,
        width: word.bbox.x1 - word.bbox.x0,
        height: word.bbox.y1 - word.bbox.y0,
        confidence: word.confidence,
    }));

    const avgConfidence = regions.length > 0
        ? regions.reduce((sum, r) => sum + r.confidence, 0) / regions.length
        : 0;

    return {
        regions,
        fullText: result.data.text,
        processingTimeMs: performance.now() - startTime,
        language: lang,
        confidence: avgConfidence,
    };
}

async function setLanguage(language: string): Promise<void> {
    if (language === currentLanguage && workerInstance) {
        return;
    }

    // Re-initialize with new language
    workerInstance = null;
    await initializeWorker(language);
}

function cancelProcessing(): void {
    if (isProcessing && workerInstance) {
        workerInstance.terminate();
        workerInstance = null;
        isProcessing = false;
    }
}

// ============================================
// MESSAGE HANDLER
// ============================================

self.onmessage = async (event: MessageEvent<OcrWorkerMessage>) => {
    const { type, id, payload } = event.data;

    try {
        switch (type) {
            case 'INIT': {
                const initPayload = payload as { language?: string };
                await initializeWorker(initPayload?.language || 'eng');
                sendMessage({
                    type: 'SUCCESS',
                    id,
                    payload: { language: currentLanguage },
                });
                break;
            }

            case 'PROCESS': {
                const processPayload = payload as {
                    imageData: ImageData | ArrayBuffer;
                    language?: string;
                };

                if (isProcessing) {
                    sendMessage({
                        type: 'ERROR',
                        id,
                        error: 'OCR already in progress. Cancel current job first.',
                    });
                    return;
                }

                try {
                    const result = await processImage(
                        id,
                        processPayload.imageData,
                        processPayload.language
                    );
                    sendMessage({
                        type: 'SUCCESS',
                        id,
                        payload: result,
                    });
                } catch (error) {
                    if ((error as Error).message?.includes('terminated')) {
                        sendMessage({
                            type: 'CANCELLED',
                            id,
                        });
                    } else {
                        throw error;
                    }
                }
                break;
            }

            case 'CANCEL': {
                cancelProcessing();
                sendMessage({
                    type: 'CANCELLED',
                    id,
                });
                break;
            }

            case 'SET_LANGUAGE': {
                const langPayload = payload as { language: string };
                await setLanguage(langPayload.language);
                sendMessage({
                    type: 'SUCCESS',
                    id,
                    payload: { language: currentLanguage },
                });
                break;
            }

            default:
                sendMessage({
                    type: 'ERROR',
                    id,
                    error: `Unknown message type: ${type}`,
                });
        }
    } catch (error) {
        sendMessage({
            type: 'ERROR',
            id,
            error: (error as Error).message || 'Unknown error',
        });
    }
};

// Export types for use in other files
export type { OcrWorkerMessage as OcrWorkerMessageType, OcrWorkerResponse as OcrWorkerResponseType };
