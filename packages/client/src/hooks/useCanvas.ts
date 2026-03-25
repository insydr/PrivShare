/**
 * useCanvas Hook
 * ==============
 * 
 * Custom hook for managing canvas operations including:
 * - Responsive resizing
 * - Image rendering
 * - Coordinate transformations
 * - Scale and zoom management
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import type { Point, Rect, CanvasState } from '../types/canvas';

// ============================================
// HOOK OPTIONS
// ============================================

interface UseCanvasOptions {
    /**
     * Whether to maintain aspect ratio when resizing
     * @default true
     */
    maintainAspectRatio?: boolean;

    /**
     * Maximum scale factor
     * @default 3
     */
    maxScale?: number;

    /**
     * Minimum scale factor
     * @default 0.1
     */
    minScale?: number;

    /**
     * Padding around the canvas in pixels
     * @default 40
     */
    padding?: number;

    /**
     * Container element to observe for resize
     */
    containerRef?: React.RefObject<HTMLElement>;
}

// ============================================
// HOOK RETURN TYPE
// ============================================

interface UseCanvasReturn {
    // Refs
    canvasRef: React.RefObject<HTMLCanvasElement>;

    // State
    canvasState: CanvasState;

    // Actions
    setNaturalSize: (width: number, height: number) => void;
    setScale: (scale: number) => void;
    fitToContainer: () => void;
    centerCanvas: () => void;

    // Coordinate transforms
    screenToCanvas: (point: Point) => Point;
    canvasToScreen: (point: Point) => Point;

    // Drawing helpers
    clearCanvas: (ctx: CanvasRenderingContext2D) => void;
    drawImage: (ctx: CanvasRenderingContext2D, image: CanvasImageSource) => void;
    drawRect: (ctx: CanvasRenderingContext2D, rect: Rect, color: string, fill?: boolean) => void;
}

// ============================================
// HOOK IMPLEMENTATION
// ============================================

export function useCanvas(options: UseCanvasOptions = {}): UseCanvasReturn {
    const {
        maintainAspectRatio = true,
        maxScale = 3,
        minScale = 0.1,
        padding = 40,
        containerRef,
    } = options;

    // Refs
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // State
    const [canvasState, setCanvasState] = useState<CanvasState>({
        width: 800,
        height: 600,
        naturalWidth: 800,
        naturalHeight: 600,
        scale: 1,
        offsetX: 0,
        offsetY: 0,
    });

    // ============================================
    // SIZE MANAGEMENT
    // ============================================

    /**
     * Set the natural (original) dimensions of the content
     */
    const setNaturalSize = useCallback((width: number, height: number) => {
        setCanvasState(prev => ({
            ...prev,
            naturalWidth: width,
            naturalHeight: height,
        }));
    }, []);

    /**
     * Calculate scale to fit content in container
     */
    const calculateFitScale = useCallback((containerWidth: number, containerHeight: number) => {
        const availableWidth = containerWidth - padding * 2;
        const availableHeight = containerHeight - padding * 2;

        const scaleX = availableWidth / canvasState.naturalWidth;
        const scaleY = availableHeight / canvasState.naturalHeight;

        return Math.min(scaleX, scaleY, maxScale);
    }, [canvasState.naturalWidth, canvasState.naturalHeight, padding, maxScale]);

    /**
     * Fit canvas to container while maintaining aspect ratio
     */
    const fitToContainer = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const container = containerRef?.current || canvas.parentElement;
        if (!container) return;

        const containerRect = container.getBoundingClientRect();
        const scale = calculateFitScale(containerRect.width, containerRect.height);

        const width = canvasState.naturalWidth * scale;
        const height = canvasState.naturalHeight * scale;

        const offsetX = (containerRect.width - width) / 2;
        const offsetY = (containerRect.height - height) / 2;

        setCanvasState(prev => ({
            ...prev,
            width,
            height,
            scale,
            offsetX,
            offsetY,
        }));
    }, [containerRef, canvasState.naturalWidth, canvasState.naturalHeight, calculateFitScale]);

    /**
     * Center the canvas in its container
     */
    const centerCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const container = canvas.parentElement;
        if (!container) return;

        const containerRect = container.getBoundingClientRect();

        const offsetX = (containerRect.width - canvasState.width) / 2;
        const offsetY = (containerRect.height - canvasState.height) / 2;

        setCanvasState(prev => ({
            ...prev,
            offsetX,
            offsetY,
        }));
    }, [canvasState.width, canvasState.height]);

    /**
     * Set scale and update dimensions
     */
    const setScale = useCallback((newScale: number) => {
        const clampedScale = Math.max(minScale, Math.min(maxScale, newScale));

        const width = canvasState.naturalWidth * clampedScale;
        const height = canvasState.naturalHeight * clampedScale;

        setCanvasState(prev => ({
            ...prev,
            width,
            height,
            scale: clampedScale,
        }));

        // Re-center after scale change
        requestAnimationFrame(() => centerCanvas());
    }, [canvasState.naturalWidth, canvasState.naturalHeight, minScale, maxScale, centerCanvas]);

    // ============================================
    // COORDINATE TRANSFORMS
    // ============================================

    /**
     * Convert screen coordinates to canvas coordinates
     */
    const screenToCanvas = useCallback((point: Point): Point => {
        const canvas = canvasRef.current;
        if (!canvas) return point;

        const rect = canvas.getBoundingClientRect();
        return {
            x: (point.x - rect.left) / canvasState.scale,
            y: (point.y - rect.top) / canvasState.scale,
        };
    }, [canvasState.scale]);

    /**
     * Convert canvas coordinates to screen coordinates
     */
    const canvasToScreen = useCallback((point: Point): Point => {
        const canvas = canvasRef.current;
        if (!canvas) return point;

        const rect = canvas.getBoundingClientRect();
        return {
            x: point.x * canvasState.scale + rect.left,
            y: point.y * canvasState.scale + rect.top,
        };
    }, [canvasState.scale]);

    // ============================================
    // DRAWING HELPERS
    // ============================================

    /**
     * Clear the canvas
     */
    const clearCanvas = useCallback((ctx: CanvasRenderingContext2D) => {
        const canvas = ctx.canvas;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }, []);

    /**
     * Draw an image scaled to fit canvas
     */
    const drawImage = useCallback((ctx: CanvasRenderingContext2D, image: CanvasImageSource) => {
        const canvas = ctx.canvas;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    }, []);

    /**
     * Draw a rectangle
     */
    const drawRect = useCallback((
        ctx: CanvasRenderingContext2D,
        rect: Rect,
        color: string,
        fill = false
    ) => {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 2;

        if (fill) {
            ctx.globalAlpha = 0.3;
            ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
            ctx.globalAlpha = 1;
        }

        ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
        ctx.restore();
    }, []);

    // ============================================
    // RESIZE OBSERVER
    // ============================================

    useEffect(() => {
        const container = containerRef?.current || canvasRef.current?.parentElement;
        if (!container) return;

        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                // Debounce resize handling
                requestAnimationFrame(() => {
                    fitToContainer();
                });
            }
        });

        resizeObserver.observe(container);

        return () => {
            resizeObserver.disconnect();
        };
    }, [containerRef, fitToContainer]);

    // Initial fit
    useEffect(() => {
        if (canvasState.naturalWidth > 0 && canvasState.naturalHeight > 0) {
            fitToContainer();
        }
    }, [canvasState.naturalWidth, canvasState.naturalHeight, fitToContainer]);

    // ============================================
    // RETURN
    // ============================================

    return {
        canvasRef,
        canvasState,
        setNaturalSize,
        setScale,
        fitToContainer,
        centerCanvas,
        screenToCanvas,
        canvasToScreen,
        clearCanvas,
        drawImage,
        drawRect,
    };
}

// ============================================
// EXPORTS
// ============================================

export type { UseCanvasOptions, UseCanvasReturn };
