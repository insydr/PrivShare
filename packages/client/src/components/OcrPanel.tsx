/**
 * OcrPanel Component
 * ===================
 * 
 * Panel component for OCR controls and results display.
 * Allows users to run OCR, select language, and view detected text.
 */

import React, { useCallback, useState } from 'react';
import { useOcrProcessor } from '../hooks/useOcrProcessor';
import { useDocumentStore } from '../store/documentStore';
import type { TextRegion } from '../hooks/useOcrProcessor';
import './OcrPanel.css';

// ============================================
// COMPONENT PROPS
// ============================================

interface OcrPanelProps {
    className?: string;
    onOcrComplete?: (regions: TextRegion[]) => void;
}

// ============================================
// LANGUAGE OPTIONS
// ============================================

const LANGUAGE_NAMES: Record<string, string> = {
    eng: 'English',
    chi_sim: '中文 (简体)',
    chi_tra: '中文 (繁體)',
    jpn: '日本語',
    kor: '한국어',
    fra: 'Français',
    deu: 'Deutsch',
    spa: 'Español',
    por: 'Português',
    rus: 'Русский',
};

// ============================================
// COMPONENT
// ============================================

export const OcrPanel: React.FC<OcrPanelProps> = ({ 
    className = '',
    onOcrComplete,
}) => {
    // ============================================
    // HOOKS
    // ============================================

    const {
        isReady,
        isProcessing,
        progress,
        error,
        language,
        availableLanguages,
        textRegions,
        fullText,
        confidence,
        initialize,
        processImage,
        setLanguage,
        cancel,
        clearResults,
    } = useOcrProcessor({ 
        autoInit: true, 
        debug: true,
        defaultLanguage: 'eng' 
    });

    const { imageData, currentBuffer, processing } = useDocumentStore();
    const [expandedRegion, setExpandedRegion] = useState<string | null>(null);

    // ============================================
    // HANDLERS
    // ============================================

    const handleRunOcr = useCallback(async () => {
        if (!imageData && !currentBuffer) {
            console.error('[OcrPanel] No image data available');
            return;
        }

        try {
            const source = currentBuffer || imageData;
            if (!source) return;

            const result = await processImage(source);
            onOcrComplete?.(result.regions);
        } catch (err) {
            console.error('[OcrPanel] OCR failed:', err);
        }
    }, [imageData, currentBuffer, processImage, onOcrComplete]);

    const handleLanguageChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
        setLanguage(e.target.value).catch(console.error);
    }, [setLanguage]);

    const handleCancel = useCallback(() => {
        cancel();
    }, [cancel]);

    const handleClear = useCallback(() => {
        clearResults();
    }, [clearResults]);

    const toggleRegion = useCallback((regionId: string) => {
        setExpandedRegion(prev => prev === regionId ? null : regionId);
    }, []);

    // ============================================
    // RENDER
    // ============================================

    return (
        <div className={`ocr-panel ${className}`}>
            {/* Header */}
            <div className="ocr-panel-header">
                <h3>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="16" y1="13" x2="8" y2="13" />
                        <line x1="16" y1="17" x2="8" y2="17" />
                    </svg>
                    Text Recognition (OCR)
                </h3>
                <span className={`status-badge ${isReady ? 'ready' : 'loading'}`}>
                    {isReady ? 'Ready' : 'Loading...'}
                </span>
            </div>

            {/* Controls */}
            <div className="ocr-panel-controls">
                {/* Language Selector */}
                <div className="control-group">
                    <label htmlFor="ocr-language">Language:</label>
                    <select 
                        id="ocr-language"
                        value={language}
                        onChange={handleLanguageChange}
                        disabled={isProcessing}
                    >
                        {availableLanguages.map((lang) => (
                            <option key={lang.code} value={lang.code}>
                                {LANGUAGE_NAMES[lang.code] || lang.name}
                            </option>
                        ))}
                    </select>
                </div>

                {/* Action Buttons */}
                <div className="control-buttons">
                    {!isProcessing ? (
                        <button 
                            className="btn primary"
                            onClick={handleRunOcr}
                            disabled={!isReady || (!imageData && !currentBuffer)}
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polygon points="5 3 19 12 5 21 5 3" />
                            </svg>
                            Run OCR
                        </button>
                    ) : (
                        <button 
                            className="btn danger"
                            onClick={handleCancel}
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                            </svg>
                            Cancel
                        </button>
                    )}

                    {textRegions.length > 0 && (
                        <button 
                            className="btn secondary"
                            onClick={handleClear}
                            disabled={isProcessing}
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                            Clear
                        </button>
                    )}
                </div>
            </div>

            {/* Progress */}
            {(isProcessing || progress) && (
                <div className="ocr-panel-progress">
                    <div className="progress-header">
                        <span className="progress-status">{progress?.message || 'Processing...'}</span>
                        <span className="progress-percent">{progress?.progress || 0}%</span>
                    </div>
                    <div className="progress-bar">
                        <div 
                            className="progress-fill" 
                            style={{ width: `${progress?.progress || 0}%` }}
                        />
                    </div>
                </div>
            )}

            {/* Error */}
            {error && (
                <div className="ocr-panel-error">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <span>{error}</span>
                </div>
            )}

            {/* Results Summary */}
            {textRegions.length > 0 && !isProcessing && (
                <div className="ocr-panel-results">
                    <div className="results-summary">
                        <div className="summary-item">
                            <span className="summary-value">{textRegions.length}</span>
                            <span className="summary-label">Text Regions</span>
                        </div>
                        <div className="summary-item">
                            <span className="summary-value">{Math.round(confidence)}%</span>
                            <span className="summary-label">Confidence</span>
                        </div>
                        <div className="summary-item">
                            <span className="summary-value">{fullText.split(/\s+/).length}</span>
                            <span className="summary-label">Words</span>
                        </div>
                    </div>

                    {/* Text Regions List */}
                    <div className="results-regions">
                        <h4>Detected Text</h4>
                        <div className="regions-list">
                            {textRegions.slice(0, 20).map((region) => (
                                <div 
                                    key={region.id}
                                    className={`region-item ${expandedRegion === region.id ? 'expanded' : ''}`}
                                    onClick={() => toggleRegion(region.id)}
                                >
                                    <div className="region-header">
                                        <span className="region-text">{region.text}</span>
                                        <span className="region-confidence" style={{
                                            color: region.confidence > 80 ? '#16A34A' :
                                                   region.confidence > 50 ? '#D97706' : '#DC2626'
                                        }}>
                                            {Math.round(region.confidence)}%
                                        </span>
                                    </div>
                                    {expandedRegion === region.id && (
                                        <div className="region-details">
                                            <span>Position: ({region.x}, {region.y})</span>
                                            <span>Size: {region.width}×{region.height}px</span>
                                        </div>
                                    )}
                                </div>
                            ))}
                            {textRegions.length > 20 && (
                                <div className="regions-more">
                                    +{textRegions.length - 20} more regions
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Full Text */}
                    <div className="results-full-text">
                        <h4>Extracted Text</h4>
                        <div className="full-text-content">
                            {fullText || <em>No text extracted</em>}
                        </div>
                    </div>
                </div>
            )}

            {/* No Results */}
            {!isProcessing && !error && textRegions.length === 0 && (
                <div className="ocr-panel-empty">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                    </svg>
                    <p>Load an image and click "Run OCR" to extract text</p>
                </div>
            )}
        </div>
    );
};

export default OcrPanel;
