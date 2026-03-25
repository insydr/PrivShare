/**
 * AnalysisPanel Component
 * ========================
 *
 * Combined OCR and PII Detection panel for document analysis.
 * Provides a unified interface for:
 * - Running OCR text extraction
 * - Detecting PII in extracted text
 * - Creating auto-redaction boxes for detected PII
 * - Managing PII by severity and type
 */

import React, { useCallback, useState } from 'react';
import { useOcrWithPii, type PiiRegion } from '../hooks/useOcrWithPii';
import { useDocumentStore } from '../store/documentStore';
import type { RedactionArea } from '../store/documentStore';
import './AnalysisPanel.css';

// ============================================
// TYPES
// ============================================

interface AnalysisPanelProps {
    className?: string;
    onAnalysisComplete?: (result: { piiCount: number; regions: PiiRegion[] }) => void;
}

type FilterMode = 'all' | 'high' | 'medium' | 'low';

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
// SEVERITY COLORS
// ============================================

const SEVERITY_COLORS: Record<string, string> = {
    high: '#DC2626',    // Red
    medium: '#D97706',  // Orange
    low: '#2563EB',     // Blue
};

const SEVERITY_BG_COLORS: Record<string, string> = {
    high: '#FEE2E2',    // Light red
    medium: '#FEF3C7',  // Light orange
    low: '#DBEAFE',     // Light blue
};

// ============================================
// COMPONENT
// ============================================

export const AnalysisPanel: React.FC<AnalysisPanelProps> = ({
    className = '',
    onAnalysisComplete,
}) => {
    // ============================================
    // HOOKS
    // ============================================

    const {
        isReady,
        isProcessing,
        isDetectingPii,
        progress,
        error,
        language,
        availableLanguages,
        textRegions,
        fullText,
        confidence,
        piiRegions,
        piiStats,
        processAndDetect,
        setLanguage,
        cancel,
        clearResults,
        createRedactionBoxes,
    } = useOcrWithPii({
        autoInit: true,
        debug: true,
        minPiiConfidence: 50,
    });

    const {
        imageData,
        currentBuffer,
        addRedaction,
        document: doc,
        clearRedactions,
    } = useDocumentStore();

    const [filterMode, setFilterMode] = useState<FilterMode>('all');
    const [selectedPiiType, setSelectedPiiType] = useState<string | null>(null);
    const [expandedSection, setExpandedSection] = useState<'ocr' | 'pii' | null>('pii');

    // ============================================
    // DERIVED STATE
    // ============================================

    const hasImage = imageData !== null || currentBuffer !== null;
    const isAnalyzing = isProcessing || isDetectingPii;

    const filteredPiiRegions = piiRegions.filter(region => {
        if (filterMode === 'all') return true;
        return region.severity === filterMode;
    }).filter(region => {
        if (!selectedPiiType) return true;
        return region.piiType === selectedPiiType;
    });

    const uniquePiiTypes = [...new Set(piiRegions.map(r => r.piiType))];

    // ============================================
    // HANDLERS
    // ============================================

    const handleRunAnalysis = useCallback(async () => {
        if (!hasImage) {
            console.error('[AnalysisPanel] No image available');
            return;
        }

        try {
            const source = currentBuffer || imageData;
            if (!source) return;

            const result = await processAndDetect(source);
            onAnalysisComplete?.({
                piiCount: result.totalPiiCount,
                regions: result.piiRegions,
            });
        } catch (err) {
            console.error('[AnalysisPanel] Analysis failed:', err);
        }
    }, [hasImage, currentBuffer, imageData, processAndDetect, onAnalysisComplete]);

    const handleLanguageChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
        setLanguage(e.target.value).catch(console.error);
    }, [setLanguage]);

    const handleAutoRedact = useCallback(() => {
        const boxes = createRedactionBoxes();

        if (boxes.length === 0) {
            alert('No PII detected to redact. Run analysis first.');
            return;
        }

        // Filter based on current filter
        const boxesToAdd = boxes.filter(box => {
            const region = piiRegions.find(r => `redact-pii-region-${r.id}` === box.id);
            if (!region) return false;

            if (filterMode !== 'all' && region.severity !== filterMode) return false;
            if (selectedPiiType && region.piiType !== selectedPiiType) return false;

            return true;
        });

        if (boxesToAdd.length === 0) {
            alert('No PII matches the current filter.');
            return;
        }

        // Check for existing redactions
        const existingIds = new Set(doc?.redactions.map(r => r.id) || []);
        const newBoxes = boxesToAdd.filter(box => !existingIds.has(box.id));

        if (newBoxes.length === 0) {
            alert('All selected PII already has redactions.');
            return;
        }

        // Add redactions
        newBoxes.forEach(box => {
            const redaction: RedactionArea = {
                id: box.id,
                x: box.x,
                y: box.y,
                width: box.width,
                height: box.height,
                pageIndex: 0,
                type: 'auto',
                piiType: box.piiType,
                confidence: box.confidence,
                createdAt: Date.now(),
            };
            addRedaction(redaction);
        });

        console.log('[AnalysisPanel] Added', newBoxes.length, 'auto-redactions');
    }, [createRedactionBoxes, piiRegions, filterMode, selectedPiiType, doc?.redactions, addRedaction]);

    const handleClearAnalysis = useCallback(() => {
        clearResults();
        setSelectedPiiType(null);
        setFilterMode('all');
    }, [clearResults]);

    const handleClearAutoRedactions = useCallback(() => {
        if (!doc?.redactions) return;

        const autoRedactions = doc.redactions.filter(r => r.type === 'auto');
        if (autoRedactions.length === 0) {
            alert('No auto-generated redactions to clear.');
            return;
        }

        if (!confirm(`Remove ${autoRedactions.length} auto-generated redactions?`)) {
            return;
        }

        // Keep only manual redactions
        clearRedactions();
        console.log('[AnalysisPanel] Cleared auto-redactions');
    }, [doc?.redactions, clearRedactions]);

    const toggleSection = useCallback((section: 'ocr' | 'pii') => {
        setExpandedSection(prev => prev === section ? null : section);
    }, []);

    // ============================================
    // RENDER
    // ============================================

    return (
        <div className={`analysis-panel ${className}`}>
            {/* Header */}
            <div className="panel-header">
                <h3>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    Document Analysis
                </h3>
                <span className={`status-badge ${isReady ? 'ready' : 'loading'}`}>
                    {isReady ? 'Ready' : 'Loading...'}
                </span>
            </div>

            {/* Controls */}
            <div className="panel-controls">
                {/* Language Selector */}
                <div className="control-group">
                    <label htmlFor="analysis-language">OCR Language:</label>
                    <select
                        id="analysis-language"
                        value={language}
                        onChange={handleLanguageChange}
                        disabled={isAnalyzing}
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
                    {!isAnalyzing ? (
                        <button
                            className="btn primary"
                            onClick={handleRunAnalysis}
                            disabled={!isReady || !hasImage}
                            title="Run OCR and detect PII"
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polygon points="5 3 19 12 5 21 5 3" />
                            </svg>
                            Analyze Document
                        </button>
                    ) : (
                        <button
                            className="btn danger"
                            onClick={cancel}
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect x="6" y="6" width="12" height="12" />
                            </svg>
                            Cancel
                        </button>
                    )}

                    {(textRegions.length > 0 || piiRegions.length > 0) && (
                        <button
                            className="btn secondary"
                            onClick={handleClearAnalysis}
                            disabled={isAnalyzing}
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
            {(isAnalyzing || progress) && (
                <div className="panel-progress">
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
                <div className="panel-error">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <span>{error}</span>
                </div>
            )}

            {/* OCR Results Section */}
            {textRegions.length > 0 && (
                <div className={`panel-section ${expandedSection === 'ocr' ? 'expanded' : ''}`}>
                    <div
                        className="section-header"
                        onClick={() => toggleSection('ocr')}
                    >
                        <h4>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                <polyline points="14 2 14 8 20 8" />
                            </svg>
                            OCR Results
                        </h4>
                        <div className="section-stats">
                            <span className="stat">{textRegions.length} text regions</span>
                            <span className="stat">{Math.round(confidence)}% confidence</span>
                            <svg
                                className={`chevron ${expandedSection === 'ocr' ? 'rotated' : ''}`}
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                            >
                                <polyline points="6 9 12 15 18 9" />
                            </svg>
                        </div>
                    </div>

                    {expandedSection === 'ocr' && (
                        <div className="section-content">
                            <div className="ocr-summary">
                                <div className="summary-item">
                                    <span className="label">Words Found:</span>
                                    <span className="value">{fullText.split(/\s+/).filter(w => w).length}</span>
                                </div>
                                <div className="summary-item">
                                    <span className="label">Avg Confidence:</span>
                                    <span className="value">{Math.round(confidence)}%</span>
                                </div>
                            </div>
                            <div className="extracted-text">
                                <h5>Extracted Text Preview:</h5>
                                <div className="text-preview">
                                    {fullText.slice(0, 500)}
                                    {fullText.length > 500 && '...'}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* PII Detection Results Section */}
            {piiRegions.length > 0 && (
                <div className={`panel-section pii-section ${expandedSection === 'pii' ? 'expanded' : ''}`}>
                    <div
                        className="section-header"
                        onClick={() => toggleSection('pii')}
                    >
                        <h4>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                            </svg>
                            PII Detection
                        </h4>
                        <div className="section-stats">
                            <span className="stat high">{piiStats.high} high</span>
                            <span className="stat medium">{piiStats.medium} medium</span>
                            <span className="stat low">{piiStats.low} low</span>
                            <svg
                                className={`chevron ${expandedSection === 'pii' ? 'rotated' : ''}`}
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                            >
                                <polyline points="6 9 12 15 18 9" />
                            </svg>
                        </div>
                    </div>

                    {expandedSection === 'pii' && (
                        <div className="section-content">
                            {/* Filter Controls */}
                            <div className="pii-filters">
                                <div className="filter-group">
                                    <label>Severity:</label>
                                    <div className="filter-buttons">
                                        <button
                                            className={`filter-btn ${filterMode === 'all' ? 'active' : ''}`}
                                            onClick={() => setFilterMode('all')}
                                        >
                                            All ({piiStats.total})
                                        </button>
                                        <button
                                            className={`filter-btn high ${filterMode === 'high' ? 'active' : ''}`}
                                            onClick={() => setFilterMode('high')}
                                        >
                                            High ({piiStats.high})
                                        </button>
                                        <button
                                            className={`filter-btn medium ${filterMode === 'medium' ? 'active' : ''}`}
                                            onClick={() => setFilterMode('medium')}
                                        >
                                            Medium ({piiStats.medium})
                                        </button>
                                        <button
                                            className={`filter-btn low ${filterMode === 'low' ? 'active' : ''}`}
                                            onClick={() => setFilterMode('low')}
                                        >
                                            Low ({piiStats.low})
                                        </button>
                                    </div>
                                </div>

                                {uniquePiiTypes.length > 1 && (
                                    <div className="filter-group">
                                        <label>PII Type:</label>
                                        <select
                                            value={selectedPiiType || ''}
                                            onChange={(e) => setSelectedPiiType(e.target.value || null)}
                                        >
                                            <option value="">All Types</option>
                                            {uniquePiiTypes.map(type => (
                                                <option key={type} value={type}>{type}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}
                            </div>

                            {/* PII List */}
                            <div className="pii-list">
                                {filteredPiiRegions.map((region) => (
                                    <div
                                        key={region.id}
                                        className={`pii-item severity-${region.severity}`}
                                        style={{
                                            borderLeftColor: SEVERITY_COLORS[region.severity],
                                            backgroundColor: SEVERITY_BG_COLORS[region.severity],
                                        }}
                                    >
                                        <div className="pii-header">
                                            <span className="pii-type">{region.piiTypeName}</span>
                                            <span className="pii-confidence">{Math.round(region.confidence)}%</span>
                                        </div>
                                        <div className="pii-value">
                                            <code>{region.text}</code>
                                        </div>
                                        <div className="pii-meta">
                                            <span>Position: ({region.x}, {region.y})</span>
                                            <span className={`severity-badge ${region.severity}`}>
                                                {region.severity}
                                            </span>
                                        </div>
                                    </div>
                                ))}

                                {filteredPiiRegions.length === 0 && (
                                    <div className="no-results">
                                        No PII matches the current filter.
                                    </div>
                                )}
                            </div>

                            {/* Auto-Redact Actions */}
                            <div className="pii-actions">
                                <button
                                    className="btn primary auto-redact"
                                    onClick={handleAutoRedact}
                                    disabled={filteredPiiRegions.length === 0}
                                    title="Create redaction boxes for detected PII"
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <rect x="3" y="3" width="18" height="18" rx="2" />
                                    </svg>
                                    Auto-Redact ({filteredPiiRegions.length})
                                </button>

                                <button
                                    className="btn secondary"
                                    onClick={handleClearAutoRedactions}
                                    title="Remove all auto-generated redactions"
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <polyline points="3 6 5 6 21 6" />
                                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                    </svg>
                                    Clear Auto-Redactions
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Empty State */}
            {!isAnalyzing && !error && textRegions.length === 0 && piiRegions.length === 0 && (
                <div className="panel-empty">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    <p>Load a document and click "Analyze Document" to extract text and detect PII</p>
                </div>
            )}
        </div>
    );
};

export default AnalysisPanel;
