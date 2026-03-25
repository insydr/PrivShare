/**
 * PolicyValidationModal Component
 * ==================================
 *
 * Modal dialog for validating document against security policies before export.
 * Shows blocking errors and warnings that must be addressed or acknowledged.
 *
 * Features:
 * - Policy validation using PolicyEngine
 * - Blocking errors prevent export
 * - Warnings can be acknowledged to proceed
 * - Detailed policy rule results display
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    PolicyEngine,
    getPolicyEngine,
    type Policy,
    type PolicyValidationResult,
    type ValidationResult,
    type ValidationContext,
} from '../services/PolicyEngine';
import { useDocumentStore, type RedactionArea } from '../store/documentStore';
import type { PiiDetection } from '../services/PiiDetectionService';
import './PolicyValidationModal.css';

// ============================================
// TYPES
// ============================================

interface PolicyValidationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onExport: () => void;
    onExportWithWarnings?: () => void;
}

type ExportState = 'idle' | 'validating' | 'blocked' | 'warnings' | 'ready';

// ============================================
// SEVERITY ICONS
// ============================================

const BlockingIcon: React.FC = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </svg>
);

const WarningIcon: React.FC = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
);

const SuccessIcon: React.FC = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
);

// ============================================
// COMPONENT
// ============================================

export const PolicyValidationModal: React.FC<PolicyValidationModalProps> = ({
    isOpen,
    onClose,
    onExport,
    onExportWithWarnings,
}) => {
    // ============================================
    // STATE
    // ============================================

    const [validationResults, setValidationResults] = useState<PolicyValidationResult[]>([]);
    const [exportState, setExportState] = useState<ExportState>('idle');
    const [acknowledgedWarnings, setAcknowledgedWarnings] = useState(false);
    const [selectedPolicy, setSelectedPolicy] = useState<string | null>(null);

    // Store
    const { document: doc, currentBuffer } = useDocumentStore();

    // Policy Engine
    const policyEngine = useMemo(() => getPolicyEngine(true), []);

    // ============================================
    // VALIDATION
    // ============================================

    const runValidation = useCallback(() => {
        if (!doc || !currentBuffer) {
            return;
        }

        setExportState('validating');

        // Build validation context
        const context: ValidationContext = {
            redactions: doc.redactions.map((r: RedactionArea) => ({
                id: r.id,
                x: r.x,
                y: r.y,
                width: r.width,
                height: r.height,
                type: r.type,
                piiType: r.piiType,
                confidence: r.confidence,
            })),
            piiDetections: (doc.piiMatches || []).map((match, index) => ({
                id: `pii-${index}`,
                type: match.piiType,
                value: match.text,
                confidence: match.confidence,
                regionIndex: match.regionIndex,
                severity: match.confidence >= 80 ? 'high' as const :
                         match.confidence >= 50 ? 'medium' as const : 'low' as const,
            })),
            textRegions: (doc.textRegions || []).map(region => ({
                id: region.id,
                text: region.text,
                x: region.x,
                y: region.y,
                width: region.width,
                height: region.height,
                confidence: region.confidence,
            })),
            documentSize: currentBuffer.byteLength,
            metadata: {
                documentName: doc.name,
                originalHash: doc.originalHash,
                redactedHash: doc.redactedHash,
                pageCount: doc.pageCount,
            },
        };

        // Run validation
        const results = policyEngine.validate(context);
        setValidationResults(results);

        // Determine export state
        const { allowed, requiresAcknowledgment } = policyEngine.canExport(results);

        if (allowed && !requiresAcknowledgment) {
            setExportState('ready');
        } else if (allowed && requiresAcknowledgment) {
            setExportState('warnings');
        } else {
            setExportState('blocked');
        }

        console.log('[PolicyValidationModal] Validation complete:', {
            results: results.length,
            allowed,
            requiresAcknowledgment,
        });
    }, [doc, currentBuffer, policyEngine]);

    // Run validation when modal opens
    useEffect(() => {
        if (isOpen) {
            setAcknowledgedWarnings(false);
            setSelectedPolicy(null);
            runValidation();
        }
    }, [isOpen, runValidation]);

    // ============================================
    // HANDLERS
    // ============================================

    const handleExport = useCallback(() => {
        if (exportState === 'ready') {
            onExport();
            onClose();
        } else if (exportState === 'warnings' && acknowledgedWarnings) {
            onExportWithWarnings?.();
            onExport();
            onClose();
        }
    }, [exportState, acknowledgedWarnings, onExport, onExportWithWarnings, onClose]);

    const handleAcknowledgeWarnings = useCallback(() => {
        setAcknowledgedWarnings(true);
    }, []);

    const handleCancel = useCallback(() => {
        onClose();
    }, [onClose]);

    // ============================================
    // DERIVED VALUES
    // ============================================

    const totalBlockingErrors = validationResults.reduce(
        (sum, r) => sum + r.blockingErrors.length,
        0
    );
    const totalWarnings = validationResults.reduce(
        (sum, r) => sum + r.warnings.length,
        0
    );

    const canExport = exportState === 'ready' || (exportState === 'warnings' && acknowledgedWarnings);

    const allPolicies = policyEngine.getAllPolicies();

    // ============================================
    // RENDER
    // ============================================

    if (!isOpen) return null;

    return (
        <div className="policy-modal-overlay">
            <div className="policy-modal">
                {/* Header */}
                <div className="policy-modal-header">
                    <h2>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                        </svg>
                        Export Policy Validation
                    </h2>
                    <button className="close-btn" onClick={handleCancel}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </div>

                {/* Content */}
                <div className="policy-modal-content">
                    {/* Validation Status */}
                    {exportState === 'validating' && (
                        <div className="validation-status validating">
                            <div className="spinner-small"></div>
                            <span>Validating document against security policies...</span>
                        </div>
                    )}

                    {exportState === 'ready' && (
                        <div className="validation-status success">
                            <SuccessIcon />
                            <span>All policy checks passed. Document is ready for export.</span>
                        </div>
                    )}

                    {exportState === 'blocked' && (
                        <div className="validation-status blocked">
                            <BlockingIcon />
                            <span>
                                Export blocked: {totalBlockingErrors} policy violation{totalBlockingErrors !== 1 ? 's' : ''} must be resolved.
                            </span>
                        </div>
                    )}

                    {exportState === 'warnings' && (
                        <div className="validation-status warnings">
                            <WarningIcon />
                            <span>
                                {totalWarnings} warning{totalWarnings !== 1 ? 's' : ''} found.
                                {!acknowledgedWarnings && ' Please review and acknowledge to proceed.'}
                            </span>
                        </div>
                    )}

                    {/* Policy Results */}
                    {validationResults.length > 0 && (
                        <div className="policy-results">
                            <h3>Policy Validation Results</h3>

                            {validationResults.map((result) => (
                                <div
                                    key={result.policyId}
                                    className={`policy-result-card ${result.passed ? 'passed' : 'failed'}`}
                                >
                                    <div
                                        className="policy-result-header"
                                        onClick={() => setSelectedPolicy(
                                            selectedPolicy === result.policyId ? null : result.policyId
                                        )}
                                    >
                                        <div className="policy-info">
                                            <span className="policy-name">{result.policyName}</span>
                                            <span className={`policy-status ${result.passed ? 'passed' : 'failed'}`}>
                                                {result.passed ? 'PASSED' : 'FAILED'}
                                            </span>
                                        </div>
                                        <div className="policy-flags">
                                            {result.blockingErrors.length > 0 && (
                                                <span className="flag blocking">
                                                    {result.blockingErrors.length} blocking
                                                </span>
                                            )}
                                            {result.warnings.length > 0 && (
                                                <span className="flag warning">
                                                    {result.warnings.length} warning{result.warnings.length !== 1 ? 's' : ''}
                                                </span>
                                            )}
                                            {result.passed && (
                                                <span className="flag success">
                                                    <SuccessIcon /> OK
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    {selectedPolicy === result.policyId && (
                                        <div className="policy-result-details">
                                            {/* Blocking Errors */}
                                            {result.blockingErrors.length > 0 && (
                                                <div className="result-section blocking">
                                                    <h4>Blocking Errors</h4>
                                                    {result.blockingErrors.map((error, index) => (
                                                        <div key={index} className="validation-item blocking">
                                                            <div className="item-header">
                                                                <BlockingIcon />
                                                                <span className="rule-name">{error.ruleName}</span>
                                                            </div>
                                                            <p className="item-message">{error.message}</p>
                                                            {error.details && (
                                                                <p className="item-details">{error.details}</p>
                                                            )}
                                                            {error.affectedItems && error.affectedItems.length > 0 && (
                                                                <div className="affected-items">
                                                                    <span>Affected items:</span>
                                                                    <ul>
                                                                        {error.affectedItems.slice(0, 5).map((item, i) => (
                                                                            <li key={i}><code>{item}</code></li>
                                                                        ))}
                                                                        {error.affectedItems.length > 5 && (
                                                                            <li>...and {error.affectedItems.length - 5} more</li>
                                                                        )}
                                                                    </ul>
                                                                </div>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            {/* Warnings */}
                                            {result.warnings.length > 0 && (
                                                <div className="result-section warnings">
                                                    <h4>Warnings</h4>
                                                    {result.warnings.map((warning, index) => (
                                                        <div key={index} className="validation-item warning">
                                                            <div className="item-header">
                                                                <WarningIcon />
                                                                <span className="rule-name">{warning.ruleName}</span>
                                                            </div>
                                                            <p className="item-message">{warning.message}</p>
                                                            {warning.details && (
                                                                <p className="item-details">{warning.details}</p>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            {/* Passed Rules */}
                                            {result.passed && result.blockingErrors.length === 0 && result.warnings.length === 0 && (
                                                <div className="result-section passed">
                                                    <p>All rules in this policy passed successfully.</p>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Warning Acknowledgment */}
                    {exportState === 'warnings' && !acknowledgedWarnings && (
                        <div className="warning-acknowledgment">
                            <label>
                                <input
                                    type="checkbox"
                                    onChange={handleAcknowledgeWarnings}
                                />
                                <span>
                                    I acknowledge the warnings and understand the risks of exporting this document.
                                </span>
                            </label>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="policy-modal-footer">
                    <button className="btn secondary" onClick={handleCancel}>
                        Cancel
                    </button>

                    {exportState === 'blocked' && (
                        <button className="btn primary" onClick={handleCancel}>
                            Return to Editor
                        </button>
                    )}

                    {exportState === 'warnings' && !acknowledgedWarnings && (
                        <button className="btn primary" disabled>
                            Acknowledge Warnings to Export
                        </button>
                    )}

                    {canExport && (
                        <button className="btn primary success" onClick={handleExport}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="7 10 12 15 17 10" />
                                <line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                            Proceed with Export
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default PolicyValidationModal;
