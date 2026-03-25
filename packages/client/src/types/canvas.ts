/**
 * Canvas Types
 * ============
 * 
 * Type definitions for canvas-based document viewing and redaction.
 */

// ============================================
// COORDINATE TYPES
// ============================================

/**
 * 2D Point/Coordinate
 */
export interface Point {
    x: number;
    y: number;
}

/**
 * Bounding box/rectangle
 */
export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Normalized rectangle (0-1 range, resolution independent)
 */
export interface NormalizedRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

// ============================================
// REDACTION TYPES
// ============================================

/**
 * Redaction box with metadata
 */
export interface RedactionBox extends Rect {
    id: string;
    type: 'auto' | 'manual';
    pageIndex: number;
    piiType?: string;
    confidence?: number;
    createdAt: number;
    isSelected?: boolean;
}

/**
 * Drawing state for redaction
 */
export interface DrawingState {
    isDrawing: boolean;
    startPoint: Point | null;
    currentPoint: Point | null;
    previewRect: Rect | null;
}

/**
 * Redaction tool modes
 */
export type RedactionTool = 'select' | 'draw' | 'erase';

// ============================================
// CANVAS TYPES
// ============================================

/**
 * Canvas dimensions and scale
 */
export interface CanvasState {
    width: number;
    height: number;
    naturalWidth: number;
    naturalHeight: number;
    scale: number;
    offsetX: number;
    offsetY: number;
}

/**
 * Mouse event data for canvas
 */
export interface CanvasMouseEvent {
    point: Point;
    canvasPoint: Point;
    normalizedPoint: Point;
    originalEvent: React.MouseEvent<HTMLCanvasElement>;
}

/**
 * Canvas render options
 */
export interface CanvasRenderOptions {
    showGrid: boolean;
    showRedactionPreview: boolean;
    highlightColor: string;
    selectedColor: string;
    opacity: number;
}

// ============================================
// VIEW TYPES
// ============================================

/**
 * Viewport/zoom state
 */
export interface ViewState {
    zoom: number;
    minZoom: number;
    maxZoom: number;
    centerX: number;
    centerY: number;
}

/**
 * Document page info
 */
export interface PageState {
    currentPage: number;
    totalPages: number;
    pageWidth: number;
    pageHeight: number;
}

// ============================================
// TRANSFORM UTILITIES
// ============================================

/**
 * Transform point from screen to canvas coordinates
 */
export function screenToCanvas(
    point: Point,
    canvas: HTMLCanvasElement,
    scale: number,
    offset: Point
): Point {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (point.x - rect.left - offset.x) / scale,
        y: (point.y - rect.top - offset.y) / scale,
    };
}

/**
 * Transform point from canvas to screen coordinates
 */
export function canvasToScreen(
    point: Point,
    canvas: HTMLCanvasElement,
    scale: number,
    offset: Point
): Point {
    const rect = canvas.getBoundingClientRect();
    return {
        x: point.x * scale + rect.left + offset.x,
        y: point.y * scale + rect.top + offset.y,
    };
}

/**
 * Normalize coordinates to 0-1 range (resolution independent)
 */
export function normalizeRect(rect: Rect, canvasWidth: number, canvasHeight: number): NormalizedRect {
    return {
        x: rect.x / canvasWidth,
        y: rect.y / canvasHeight,
        width: rect.width / canvasWidth,
        height: rect.height / canvasHeight,
    };
}

/**
 * Denormalize coordinates from 0-1 range
 */
export function denormalizeRect(rect: NormalizedRect, canvasWidth: number, canvasHeight: number): Rect {
    return {
        x: rect.x * canvasWidth,
        y: rect.y * canvasHeight,
        width: rect.width * canvasWidth,
        height: rect.height * canvasHeight,
    };
}

/**
 * Check if two rectangles intersect
 */
export function rectsIntersect(a: Rect, b: Rect): boolean {
    return !(
        a.x + a.width < b.x ||
        b.x + b.width < a.x ||
        a.y + a.height < b.y ||
        b.y + b.height < a.y
    );
}

/**
 * Check if a point is inside a rectangle
 */
export function pointInRect(point: Point, rect: Rect): boolean {
    return (
        point.x >= rect.x &&
        point.x <= rect.x + rect.width &&
        point.y >= rect.y &&
        point.y <= rect.y + rect.height
    );
}

/**
 * Generate unique ID for redaction boxes
 */
export function generateRedactionId(): string {
    return `redaction-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
