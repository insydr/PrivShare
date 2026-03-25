/**
 * PageNavigation Component
 * =========================
 * 
 * Navigation controls for multi-page PDF documents.
 * Provides page switching, thumbnail view, and page information.
 */

import React, { useCallback, useMemo } from 'react';
import { useDocumentStore } from '../store/documentStore';
import './PageNavigation.css';

// ============================================
// COMPONENT PROPS
// ============================================

interface PageNavigationProps {
    className?: string;
    onPageChange?: (pageNumber: number) => void;
    showPageInfo?: boolean;
}

// ============================================
// PAGE NAVIGATION COMPONENT
// ============================================

export const PageNavigation: React.FC<PageNavigationProps> = ({
    className = '',
    onPageChange,
    showPageInfo = true,
}) => {
    // ============================================
    // STORE STATE
    // ============================================

    const {
        document,
        currentPage,
        renderedPages,
        setCurrentPage,
    } = useDocumentStore();

    // ============================================
    // DERIVED VALUES
    // ============================================

    const pageCount = document?.pageCount ?? 1;
    const isMultiPage = pageCount > 1;
    const pageInfo = document?.pages[currentPage];
    
    // Get redaction count for current page
    const currentPageRedactions = useMemo(() => {
        return document?.redactions.filter(r => r.pageIndex === currentPage).length ?? 0;
    }, [document?.redactions, currentPage]);

    // ============================================
    // HANDLERS
    // ============================================

    const handlePrevPage = useCallback(() => {
        if (currentPage > 0) {
            const newPage = currentPage - 1;
            setCurrentPage(newPage);
            onPageChange?.(newPage);
            // Dispatch event for PDF page rendering
            window.dispatchEvent(new CustomEvent('page:change', { detail: { page: newPage } }));
        }
    }, [currentPage, setCurrentPage, onPageChange]);

    const handleNextPage = useCallback(() => {
        if (currentPage < pageCount - 1) {
            const newPage = currentPage + 1;
            setCurrentPage(newPage);
            onPageChange?.(newPage);
            // Dispatch event for PDF page rendering
            window.dispatchEvent(new CustomEvent('page:change', { detail: { page: newPage } }));
        }
    }, [currentPage, pageCount, setCurrentPage, onPageChange]);

    const handlePageSelect = useCallback((pageNumber: number) => {
        if (pageNumber >= 0 && pageNumber < pageCount) {
            setCurrentPage(pageNumber);
            onPageChange?.(pageNumber);
            // Dispatch event for PDF page rendering
            window.dispatchEvent(new CustomEvent('page:change', { detail: { page: pageNumber } }));
        }
    }, [pageCount, setCurrentPage, onPageChange]);

    const handlePageInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const value = parseInt(e.target.value, 10) - 1; // Convert 1-indexed to 0-indexed
        if (!isNaN(value)) {
            handlePageSelect(value);
        }
    }, [handlePageSelect]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'ArrowLeft') {
            handlePrevPage();
        } else if (e.key === 'ArrowRight') {
            handleNextPage();
        }
    }, [handlePrevPage, handleNextPage]);

    // ============================================
    // RENDER
    // ============================================

    if (!isMultiPage) {
        return null; // Don't show navigation for single-page documents
    }

    return (
        <div 
            className={`page-navigation ${className}`}
            onKeyDown={handleKeyDown}
            tabIndex={0}
            role="navigation"
            aria-label="Page navigation"
        >
            {/* Previous Page Button */}
            <button
                className="page-nav-btn prev"
                onClick={handlePrevPage}
                disabled={currentPage === 0}
                title="Previous Page (←)"
                aria-label="Previous page"
            >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="15 18 9 12 15 6" />
                </svg>
            </button>

            {/* Page Input */}
            <div className="page-input-container">
                <input
                    type="number"
                    className="page-input"
                    value={currentPage + 1}
                    onChange={handlePageInputChange}
                    min={1}
                    max={pageCount}
                    aria-label="Current page"
                />
                <span className="page-separator">/</span>
                <span className="page-total">{pageCount}</span>
            </div>

            {/* Next Page Button */}
            <button
                className="page-nav-btn next"
                onClick={handleNextPage}
                disabled={currentPage >= pageCount - 1}
                title="Next Page (→)"
                aria-label="Next page"
            >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="9 18 15 12 9 6" />
                </svg>
            </button>

            {/* Page Info */}
            {showPageInfo && pageInfo && (
                <div className="page-info">
                    <span className="page-dimensions">
                        {Math.round(pageInfo.width)} × {Math.round(pageInfo.height)} px
                    </span>
                    {currentPageRedactions > 0 && (
                        <span className="page-redactions">
                            {currentPageRedactions} redaction{currentPageRedactions !== 1 ? 's' : ''}
                        </span>
                    )}
                    {renderedPages.has(currentPage) && (
                        <span className="page-rendered" title="Page rendered">
                            ✓
                        </span>
                    )}
                </div>
            )}

            {/* Page Thumbnails (optional, shown for small page counts) */}
            {pageCount <= 10 && (
                <div className="page-thumbnails">
                    {Array.from({ length: pageCount }, (_, i) => (
                        <button
                            key={i}
                            className={`page-thumbnail ${i === currentPage ? 'active' : ''} ${renderedPages.has(i) ? 'rendered' : ''}`}
                            onClick={() => handlePageSelect(i)}
                            title={`Page ${i + 1}`}
                            aria-label={`Go to page ${i + 1}`}
                            aria-current={i === currentPage ? 'page' : undefined}
                        >
                            {i + 1}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

// ============================================
// PAGE THUMBNAIL LIST COMPONENT
// ============================================

interface PageThumbnailListProps {
    className?: string;
    onPageSelect?: (pageNumber: number) => void;
}

export const PageThumbnailList: React.FC<PageThumbnailListProps> = ({
    className = '',
    onPageSelect,
}) => {
    const {
        document,
        currentPage,
        renderedPages,
        setCurrentPage,
    } = useDocumentStore();

    const pageCount = document?.pageCount ?? 1;
    const isMultiPage = pageCount > 1;

    const handlePageClick = useCallback((pageNumber: number) => {
        setCurrentPage(pageNumber);
        onPageSelect?.(pageNumber);
    }, [setCurrentPage, onPageSelect]);

    if (!isMultiPage) {
        return null;
    }

    return (
        <div className={`page-thumbnail-list ${className}`}>
            <div className="thumbnail-list-header">
                <span>Pages</span>
                <span className="rendered-count">
                    {renderedPages.size}/{pageCount} loaded
                </span>
            </div>
            <div className="thumbnail-list-content">
                {Array.from({ length: pageCount }, (_, i) => {
                    const pageInfo = document?.pages[i];
                    const pageRedactions = document?.redactions.filter(r => r.pageIndex === i).length ?? 0;
                    
                    return (
                        <button
                            key={i}
                            className={`thumbnail-item ${i === currentPage ? 'active' : ''}`}
                            onClick={() => handlePageClick(i)}
                            title={`Page ${i + 1}${pageRedactions > 0 ? ` (${pageRedactions} redactions)` : ''}`}
                        >
                            <div className="thumbnail-number">{i + 1}</div>
                            {pageInfo && (
                                <div className="thumbnail-dimensions">
                                    {Math.round(pageInfo.width / 10)}×{Math.round(pageInfo.height / 10)}
                                </div>
                            )}
                            {pageRedactions > 0 && (
                                <div className="thumbnail-redactions">
                                    {pageRedactions} red.
                                </div>
                            )}
                            <div className={`thumbnail-status ${renderedPages.has(i) ? 'rendered' : ''}`}>
                                {renderedPages.has(i) ? '✓' : '○'}
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

export default PageNavigation;
