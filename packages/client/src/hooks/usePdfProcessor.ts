/**
 * usePdfProcessor Hook
 * =====================
 * 
 * Custom hook for processing PDF documents with PDF.js.
 * Handles multi-page PDF loading, rendering, and page management.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { getPdfService, type PdfDocumentInfo, type RenderResult, type PdfLoadProgress } from '../services/PdfService';
import { useDocumentStore } from '../store/documentStore';

interface UsePdfProcessorOptions {
    renderScale?: number;
    debug?: boolean;
}

interface UsePdfProcessorResult {
    isLoading: boolean;
    progress: PdfLoadProgress | null;
    error: string | null;
    documentInfo: PdfDocumentInfo | null;
    loadPdf: (buffer: ArrayBuffer) => Promise<PdfDocumentInfo | null>;
    renderPage: (pageNumber: number) => Promise<RenderResult | null>;
    renderAllPages: () => Promise<RenderResult[]>;
    unloadPdf: () => void;
}

export function usePdfProcessor(options: UsePdfProcessorOptions = {}): UsePdfProcessorResult {
    const { renderScale = 1.5, debug = false } = options;

    const [isLoading, setIsLoading] = useState(false);
    const [progress, setProgress] = useState<PdfLoadProgress | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [documentInfo, setDocumentInfo] = useState<PdfDocumentInfo | null>(null);

    const {
        setPageImageData,
        setProcessing,
    } = useDocumentStore();

    const pdfService = useRef(getPdfService({ debug, defaultScale: renderScale }));

    /**
     * Load a PDF document from ArrayBuffer
     */
    const loadPdf = useCallback(async (buffer: ArrayBuffer): Promise<PdfDocumentInfo | null> => {
        setIsLoading(true);
        setError(null);
        setProgress({ stage: 'loading', progress: 0, message: 'Loading PDF...' });

        try {
            const info = await pdfService.current.loadDocument(buffer, (p) => {
                setProgress(p);
                const stage = p.stage === 'parsing' ? 'processing' : p.stage;
                setProcessing({
                    stage: stage as 'idle' | 'loading' | 'processing' | 'rendering' | 'redacting' | 'exporting' | 'error',
                    progress: p.progress,
                    message: p.message,
                });
            });

            setDocumentInfo(info);

            if (debug) {
                console.log('[usePdfProcessor] PDF loaded:', info);
            }

            return info;
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Failed to load PDF';
            setError(errorMessage);
            console.error('[usePdfProcessor] Error loading PDF:', err);
            return null;
        } finally {
            setIsLoading(false);
            setProgress(null);
        }
    }, [debug, setPdfBuffer, setProcessing]);

    /**
     * Render a specific page
     */
    const renderPage = useCallback(async (pageNumber: number): Promise<RenderResult | null> => {
        if (!documentInfo) {
            console.error('[usePdfProcessor] No document loaded');
            return null;
        }

        setIsLoading(true);
        setError(null);

        try {
            const result = await pdfService.current.renderPage(pageNumber, { scale: renderScale }, (p) => {
                setProgress(p);
            });

            // Store the rendered page in the document store
            setPageImageData(pageNumber - 1, result.imageData); // Convert 1-indexed to 0-indexed

            if (debug) {
                console.log('[usePdfProcessor] Page rendered:', pageNumber);
            }

            return result;
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : `Failed to render page ${pageNumber}`;
            setError(errorMessage);
            console.error('[usePdfProcessor] Error rendering page:', pageNumber, err);
            return null;
        } finally {
            setIsLoading(false);
            setProgress(null);
        }
    }, [documentInfo, renderScale, debug, setPageImageData]);

    /**
     * Render all pages
     */
    const renderAllPages = useCallback(async (): Promise<RenderResult[]> => {
        if (!documentInfo) {
            console.error('[usePdfProcessor] No document loaded');
            return [];
        }

        setIsLoading(true);
        setError(null);
        setProgress({ stage: 'rendering', progress: 0, message: 'Rendering all pages...' });

        try {
            const results = await pdfService.current.renderAllPages({ scale: renderScale }, (p) => {
                setProgress(p);
                setProcessing({
                    stage: 'processing',
                    progress: p.progress,
                    message: p.message,
                });
            });

            // Store all rendered pages in the document store
            results.forEach((result) => {
                setPageImageData(result.pageNumber - 1, result.imageData);
            });

            if (debug) {
                console.log('[usePdfProcessor] All pages rendered:', results.length);
            }

            return results;
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Failed to render all pages';
            setError(errorMessage);
            console.error('[usePdfProcessor] Error rendering all pages:', err);
            return [];
        } finally {
            setIsLoading(false);
            setProgress(null);
        }
    }, [documentInfo, renderScale, debug, setPageImageData, setProcessing]);

    /**
     * Unload the PDF
     */
    const unloadPdf = useCallback(() => {
        pdfService.current.unloadDocument();
        setDocumentInfo(null);
        setError(null);
        setProgress(null);
    }, []);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            // Don't destroy the service on unmount as it's a singleton
            // Just clear the document
            pdfService.current.unloadDocument();
        };
    }, []);

    return {
        isLoading,
        progress,
        error,
        documentInfo,
        loadPdf,
        renderPage,
        renderAllPages,
        unloadPdf,
    };
}

export default usePdfProcessor;
