/**
 * PdfService
 * ===========
 * 
 * Service for parsing and rendering PDF documents using PDF.js.
 * Provides page-by-page rendering to ImageData for document processing.
 * 
 * Features:
 * - PDF parsing and page extraction
 * - Page rendering to canvas/ImageData
 * - Multi-page document support
 * - Progress tracking for large documents
 * - Memory-efficient page caching
 */

import * as pdfjsLib from 'pdfjs-dist';

// ============================================
// TYPES
// ============================================

export interface PdfPageInfo {
    pageNumber: number;
    width: number;
    height: number;
    rotation: number;
    scale: number;
}

export interface PdfDocumentInfo {
    pageCount: number;
    pages: PdfPageInfo[];
    fingerprint: string;
    title?: string;
    author?: string;
    subject?: string;
    creator?: string;
    creationDate?: Date;
}

export interface RenderOptions {
    scale?: number;
    rotation?: number;
    backgroundColor?: string;
}

export interface RenderResult {
    imageData: ImageData;
    width: number;
    height: number;
    pageNumber: number;
}

export interface PdfLoadProgress {
    stage: 'loading' | 'parsing' | 'rendering';
    progress: number;
    message: string;
    currentPage?: number;
    totalPages?: number;
}

export type ProgressCallback = (progress: PdfLoadProgress) => void;

// ============================================
// PDF SERVICE CLASS
// ============================================

export class PdfService {
    private pdfDocument: pdfjsLib.PDFDocumentProxy | null = null;
    private pageCache: Map<number, RenderResult> = new Map();
    private maxCacheSize: number = 10; // Max pages to keep in memory
    private debug: boolean;
    private defaultScale: number = 1.5; // Default scale for rendering

    constructor(options: { debug?: boolean; defaultScale?: number } = {}) {
        this.debug = options.debug ?? false;
        this.defaultScale = options.defaultScale ?? 1.5;
        
        // Configure PDF.js worker
        // Using CDN for worker to avoid bundling issues
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
    }

    // ============================================
    // PUBLIC METHODS
    // ============================================

    /**
     * Load a PDF document from ArrayBuffer
     */
    async loadDocument(
        buffer: ArrayBuffer,
        onProgress?: ProgressCallback
    ): Promise<PdfDocumentInfo> {
        this.log('Loading PDF document...');
        
        onProgress?.({ stage: 'loading', progress: 0, message: 'Loading PDF file...' });

        try {
            // Load the PDF document
            const loadingTask = pdfjsLib.getDocument({
                data: buffer,
                cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/cmaps/',
                cMapPacked: true,
            });

            // Track loading progress
            loadingTask.onProgress = (progressData: { loaded: number; total: number }) => {
                const progress = progressData.total > 0 
                    ? (progressData.loaded / progressData.total) * 50 
                    : 25;
                onProgress?.({
                    stage: 'loading',
                    progress,
                    message: `Loading PDF... ${Math.round((progressData.loaded / 1024 / 1024) * 100) / 100}MB`,
                });
            };

            this.pdfDocument = await loadingTask.promise;
            
            onProgress?.({ stage: 'parsing', progress: 50, message: 'Parsing document structure...' });

            // Extract document metadata
            const metadata = await this.pdfDocument.getMetadata();
            const pageCount = this.pdfDocument.numPages;
            
            onProgress?.({ stage: 'parsing', progress: 70, message: `Found ${pageCount} pages` });

            // Get page information
            const pages: PdfPageInfo[] = [];
            for (let i = 1; i <= pageCount; i++) {
                const page = await this.pdfDocument.getPage(i);
                const viewport = page.getViewport({ scale: 1 });
                pages.push({
                    pageNumber: i,
                    width: viewport.width,
                    height: viewport.height,
                    rotation: viewport.rotation,
                    scale: 1,
                });
            }

            const docInfo: PdfDocumentInfo = {
                pageCount,
                pages,
                fingerprint: this.pdfDocument.fingerprints[0] || 'unknown',
                title: (metadata.info as Record<string, unknown>)?.Title as string | undefined,
                author: (metadata.info as Record<string, unknown>)?.Author as string | undefined,
                subject: (metadata.info as Record<string, unknown>)?.Subject as string | undefined,
                creator: (metadata.info as Record<string, unknown>)?.Creator as string | undefined,
                creationDate: (metadata.info as Record<string, unknown>)?.CreationDate 
                    ? new Date((metadata.info as Record<string, unknown>).CreationDate as string) 
                    : undefined,
            };

            onProgress?.({ stage: 'parsing', progress: 100, message: 'PDF loaded successfully' });

            this.log('PDF loaded:', pageCount, 'pages');
            return docInfo;

        } catch (error) {
            this.log('Failed to load PDF:', error);
            throw new Error(`Failed to load PDF: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Render a specific page to ImageData
     */
    async renderPage(
        pageNumber: number,
        options: RenderOptions = {},
        onProgress?: ProgressCallback
    ): Promise<RenderResult> {
        if (!this.pdfDocument) {
            throw new Error('No PDF document loaded. Call loadDocument() first.');
        }

        if (pageNumber < 1 || pageNumber > this.pdfDocument.numPages) {
            throw new Error(`Invalid page number: ${pageNumber}. Valid range: 1-${this.pdfDocument.numPages}`);
        }

        // Check cache first
        const cacheKey = this.getCacheKey(pageNumber, options.scale ?? this.defaultScale);
        if (this.pageCache.has(cacheKey)) {
            this.log('Returning cached page:', pageNumber);
            return this.pageCache.get(cacheKey)!;
        }

        onProgress?.({
            stage: 'rendering',
            progress: 0,
            message: `Rendering page ${pageNumber}...`,
            currentPage: pageNumber,
            totalPages: this.pdfDocument.numPages,
        });

        try {
            const page = await this.pdfDocument.getPage(pageNumber);
            const scale = options.scale ?? this.defaultScale;
            const viewport = page.getViewport({ 
                scale,
                rotation: options.rotation,
            });

            // Create canvas for rendering
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            
            if (!context) {
                throw new Error('Failed to get canvas 2D context');
            }

            canvas.width = Math.floor(viewport.width);
            canvas.height = Math.floor(viewport.height);

            onProgress?.({
                stage: 'rendering',
                progress: 50,
                message: `Rendering page ${pageNumber}...`,
                currentPage: pageNumber,
                totalPages: this.pdfDocument.numPages,
            });

            // Render the page
            const renderContext = {
                canvasContext: context,
                viewport: viewport,
                background: options.backgroundColor ?? 'white',
            } as Parameters<typeof page.render>[0];

            await page.render(renderContext).promise;

            // Extract ImageData
            const imageData = context.getImageData(0, 0, canvas.width, canvas.height);

            const result: RenderResult = {
                imageData,
                width: canvas.width,
                height: canvas.height,
                pageNumber,
            };

            // Cache the result
            this.cachePage(cacheKey, result);

            onProgress?.({
                stage: 'rendering',
                progress: 100,
                message: `Page ${pageNumber} rendered`,
                currentPage: pageNumber,
                totalPages: this.pdfDocument.numPages,
            });

            this.log('Page rendered:', pageNumber, 'Size:', canvas.width, 'x', canvas.height);
            return result;

        } catch (error) {
            this.log('Failed to render page:', pageNumber, error);
            throw new Error(`Failed to render page ${pageNumber}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Render all pages (useful for batch processing)
     */
    async renderAllPages(
        options: RenderOptions = {},
        onProgress?: ProgressCallback
    ): Promise<RenderResult[]> {
        if (!this.pdfDocument) {
            throw new Error('No PDF document loaded. Call loadDocument() first.');
        }

        const pageCount = this.pdfDocument.numPages;
        const results: RenderResult[] = [];

        for (let i = 1; i <= pageCount; i++) {
            const result = await this.renderPage(i, options, (progress) => {
                onProgress?.({
                    ...progress,
                    progress: ((i - 1) / pageCount) * 100 + (progress.progress / pageCount),
                    currentPage: i,
                    totalPages: pageCount,
                });
            });
            results.push(result);
        }

        return results;
    }

    /**
     * Get page dimensions without rendering
     */
    async getPageDimensions(pageNumber: number, scale: number = 1): Promise<{ width: number; height: number }> {
        if (!this.pdfDocument) {
            throw new Error('No PDF document loaded.');
        }

        const page = await this.pdfDocument.getPage(pageNumber);
        const viewport = page.getViewport({ scale });

        return {
            width: Math.floor(viewport.width),
            height: Math.floor(viewport.height),
        };
    }

    /**
     * Get page count
     */
    getPageCount(): number {
        return this.pdfDocument?.numPages ?? 0;
    }

    /**
     * Check if a document is loaded
     */
    isDocumentLoaded(): boolean {
        return this.pdfDocument !== null;
    }

    /**
     * Clear page cache
     */
    clearCache(): void {
        this.pageCache.clear();
        this.log('Page cache cleared');
    }

    /**
     * Unload the current document
     */
    unloadDocument(): void {
        if (this.pdfDocument) {
            this.pdfDocument.destroy();
            this.pdfDocument = null;
        }
        this.clearCache();
        this.log('Document unloaded');
    }

    // ============================================
    // PRIVATE METHODS
    // ============================================

    private getCacheKey(pageNumber: number, scale: number): number {
        return pageNumber * 1000 + Math.round(scale * 100);
    }

    private cachePage(key: number, result: RenderResult): void {
        // Remove oldest entries if cache is full
        if (this.pageCache.size >= this.maxCacheSize) {
            const firstKey = this.pageCache.keys().next().value;
            if (firstKey !== undefined) {
                this.pageCache.delete(firstKey);
            }
        }
        this.pageCache.set(key, result);
    }

    private log(message: string, ...args: unknown[]): void {
        if (this.debug) {
            console.log(`[PdfService] ${message}`, ...args);
        }
    }
}

// ============================================
// SINGLETON INSTANCE
// ============================================

let serviceInstance: PdfService | null = null;

/**
 * Get the PDF service singleton
 */
export function getPdfService(options?: { debug?: boolean; defaultScale?: number }): PdfService {
    if (!serviceInstance) {
        serviceInstance = new PdfService(options);
    }
    return serviceInstance;
}

/**
 * Destroy the PDF service singleton
 */
export function destroyPdfService(): void {
    if (serviceInstance) {
        serviceInstance.unloadDocument();
        serviceInstance = null;
    }
}

export default PdfService;
