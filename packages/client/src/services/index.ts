/**
 * Services Index
 * Export all client services
 */

// Collaboration & Signaling
export { CollaborationService, getCollaborationService, destroyCollaborationService } from './CollaborationService';

// OCR Processing
export { OcrService, getOcrService, destroyOcrService } from './OcrService';
export type { TextRegion as OcrTextRegion, OcrResult, OcrProgress, OcrServiceOptions, OcrServiceCallbacks } from './OcrService';

// PII Detection
export { PiiDetectionService, getPiiDetectionService, destroyPiiDetectionService } from './PiiDetectionService';
export type { 
    PiiType, 
    PiiDetection, 
    PiiDetectionResult, 
    PiiDetectionOptions 
} from './PiiDetectionService';

// P2P File Transfer
export { P2PService, getP2PService, destroyP2PService } from './P2PService';
export type {
    P2PTransferOptions,
    P2PTransferProgress,
    P2PTransferResult,
    P2PConnectionState,
    P2PCallbacks,
} from './P2PService';

// Policy Enforcement
export { PolicyEngine, getPolicyEngine, destroyPolicyEngine, DEFAULT_POLICIES } from './PolicyEngine';
export type {
    Policy,
    PolicyRule,
    PolicySeverity,
    ValidationResult,
    PolicyValidationResult,
    ValidationContext,
    MustRedactPiiTypeRule,
    MustRedactAllDetectedRule,
    MinRedactionCountRule,
    RequiredRedactionAreasRule,
    NoEmptyExportRule,
} from './PolicyEngine';

// Encryption
export { CryptoService, getCryptoService, destroyCryptoService } from './CryptoService';
export type {
    EncryptionResult,
    DecryptionOptions,
    KeyPair,
    WrappedKey,
    EncryptionProgress,
    ProgressCallback,
} from './CryptoService';
