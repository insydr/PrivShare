/**
 * PiiDetectionService
 * ====================
 * 
 * Service for detecting PII (Personally Identifiable Information) in text.
 * Uses multiple detection strategies including regex patterns, context analysis,
 * and confidence scoring.
 * 
 * Supported PII Types:
 * - Email addresses
 * - Social Security Numbers (SSN)
 * - Phone numbers (various formats)
 * - Credit card numbers
 * - Dates of birth
 * - Addresses (partial)
 * - Medical record numbers (MRN)
 * - IP addresses
 * - Bank account numbers
 */

// ============================================
// TYPES
// ============================================

export interface PiiType {
    id: string;
    name: string;
    category: 'personal' | 'financial' | 'medical' | 'contact' | 'location' | 'identifier';
    severity: 'high' | 'medium' | 'low';
    patterns: RegExp[];
    contextKeywords?: string[];
    validationFn?: (value: string) => boolean;
}

export interface PiiDetection {
    id: string;
    type: string;
    typeName: string;
    value: string;
    maskedValue: string;
    confidence: number;
    startOffset: number;
    endOffset: number;
    context?: string;
    regionIndex?: number;
    severity: 'high' | 'medium' | 'low';
}

export interface PiiDetectionResult {
    detections: PiiDetection[];
    totalCount: number;
    highSeverityCount: number;
    mediumSeverityCount: number;
    lowSeverityCount: number;
    uniqueTypes: string[];
    processingTimeMs: number;
}

export interface PiiDetectionOptions {
    minConfidence?: number; // 0-100, default 50
    includeContext?: boolean; // Include surrounding text, default true
    maskValues?: boolean; // Mask sensitive values in results, default true
    contextWindow?: number; // Characters to include as context, default 50
    customPatterns?: Map<string, RegExp[]>; // Custom patterns to add
}

// ============================================
// PII TYPE DEFINITIONS
// ============================================

const PII_TYPES: PiiType[] = [
    // ============================================
    // PERSONAL IDENTIFIERS
    // ============================================
    {
        id: 'ssn',
        name: 'Social Security Number',
        category: 'personal',
        severity: 'high',
        patterns: [
            /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g, // US SSN: 123-45-6789
            /\b\d{9}\b/g, // Plain 9 digits (with context)
        ],
        contextKeywords: ['ssn', 'social security', 'social', 'security number', 'ss#'],
        validationFn: (value) => {
            const digits = value.replace(/\D/g, '');
            // SSN validation rules
            if (digits.length !== 9) return false;
            const area = parseInt(digits.substring(0, 3));
            const group = parseInt(digits.substring(3, 5));
            const serial = parseInt(digits.substring(5, 9));
            // Invalid area numbers
            if (area === 0 || area === 666 || area >= 900) return false;
            // Invalid group
            if (group === 0) return false;
            // Invalid serial
            if (serial === 0) return false;
            return true;
        },
    },
    {
        id: 'itin',
        name: 'Individual Taxpayer Identification Number',
        category: 'personal',
        severity: 'high',
        patterns: [
            /\b9\d{2}[-\s]?(?:7[0-9]|8[0-8]|9[0-2]|9[4-9])[-\s]?\d{4}\b/g,
        ],
        contextKeywords: ['itin', 'tax', 'taxpayer'],
    },
    
    // ============================================
    // CONTACT INFORMATION
    // ============================================
    {
        id: 'email',
        name: 'Email Address',
        category: 'contact',
        severity: 'medium',
        patterns: [
            /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
        ],
        validationFn: (value) => {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            return emailRegex.test(value) && value.length <= 254;
        },
    },
    {
        id: 'phone',
        name: 'Phone Number',
        category: 'contact',
        severity: 'medium',
        patterns: [
            // US formats
            /\b(?:\+?1[-.\s]?)?\(?[2-9]\d{2}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
            // International format
            /\b\+(?:[1-9]\d{0,2})[-.\s]?\d{1,14}\b/g,
            // Plain 10 digits with context
            /\b\d{10}\b/g,
        ],
        contextKeywords: ['phone', 'tel', 'telephone', 'mobile', 'cell', 'fax', 'contact'],
    },
    
    // ============================================
    // FINANCIAL INFORMATION
    // ============================================
    {
        id: 'credit_card',
        name: 'Credit Card Number',
        category: 'financial',
        severity: 'high',
        patterns: [
            // Visa
            /\b4\d{3}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
            // MasterCard
            /\b(?:5[1-5]\d{2}|2[2-7]\d{2})[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
            // Amex
            /\b3[47]\d{2}[-\s]?\d{6}[-\s]?\d{5}\b/g,
            // Discover
            /\b6(?:011|5\d{2})[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
            // Generic 13-19 digit card number
            /\b(?:\d{4}[-\s]?){3,4}\d{1,4}\b/g,
        ],
        contextKeywords: ['card', 'credit', 'debit', 'visa', 'mastercard', 'amex', 'payment'],
        validationFn: (value) => {
            // Luhn algorithm validation
            const digits = value.replace(/\D/g, '');
            if (digits.length < 13 || digits.length > 19) return false;
            
            let sum = 0;
            let isEven = false;
            for (let i = digits.length - 1; i >= 0; i--) {
                let digit = parseInt(digits[i], 10);
                if (isEven) {
                    digit *= 2;
                    if (digit > 9) digit -= 9;
                }
                sum += digit;
                isEven = !isEven;
            }
            return sum % 10 === 0;
        },
    },
    {
        id: 'bank_account',
        name: 'Bank Account Number',
        category: 'financial',
        severity: 'high',
        patterns: [
            /\b\d{8,17}\b/g, // 8-17 digit account numbers
        ],
        contextKeywords: ['account', 'bank', 'routing', 'aba', 'swift', 'iban', 'bic'],
    },
    {
        id: 'routing_number',
        name: 'Bank Routing Number',
        category: 'financial',
        severity: 'high',
        patterns: [
            /\b\d{9}\b/g, // 9-digit routing number
        ],
        contextKeywords: ['routing', 'aba', 'rt', 'routing transit'],
        validationFn: (value) => {
            // Routing number checksum validation
            if (!/^\d{9}$/.test(value)) return false;
            const digits = value.split('').map(Number);
            const checksum = 
                3 * (digits[0] + digits[3] + digits[6]) +
                7 * (digits[1] + digits[4] + digits[7]) +
                (digits[2] + digits[5] + digits[8]);
            return checksum % 10 === 0;
        },
    },
    
    // ============================================
    // MEDICAL INFORMATION
    // ============================================
    {
        id: 'mrn',
        name: 'Medical Record Number',
        category: 'medical',
        severity: 'high',
        patterns: [
            /\bMRN[-:\s]*\d{6,10}\b/gi,
            /\b(?:MR|Medical Record)[-:\s]*[#\s]*\d{6,10}\b/gi,
        ],
        contextKeywords: ['mrn', 'medical record', 'patient id', 'patient number'],
    },
    {
        id: 'npi',
        name: 'National Provider Identifier',
        category: 'medical',
        severity: 'medium',
        patterns: [
            /\b\d{10}\b/g, // 10-digit NPI
        ],
        contextKeywords: ['npi', 'provider', 'physician', 'doctor id'],
        validationFn: (value) => {
            if (!/^\d{10}$/.test(value)) return false;
            // Luhn check for NPI (prefix with 80840)
            const digits = '80840' + value;
            let sum = 0;
            let isEven = false;
            for (let i = digits.length - 1; i >= 0; i--) {
                let digit = parseInt(digits[i], 10);
                if (isEven) {
                    digit *= 2;
                    if (digit > 9) digit -= 9;
                }
                sum += digit;
                isEven = !isEven;
            }
            return sum % 10 === 0;
        },
    },
    {
        id: 'hipaa_id',
        name: 'HIPAA Identifier',
        category: 'medical',
        severity: 'high',
        patterns: [
            /\b[A-Z]{2,3}\d{6,12}\b/g, // Generic medical ID format
        ],
        contextKeywords: ['patient', 'medical', 'health', 'hipaa', 'treatment'],
    },
    
    // ============================================
    // LOCATION INFORMATION
    // ============================================
    {
        id: 'address',
        name: 'Street Address',
        category: 'location',
        severity: 'medium',
        patterns: [
            /\b\d+\s+[A-Za-z0-9\s]+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Boulevard|Blvd|Lane|Ln|Way|Court|Ct|Place|Pl|Circle|Cir)\.?\b/gi,
        ],
        contextKeywords: ['address', 'street', 'residence', 'home', 'live'],
    },
    {
        id: 'zip_code',
        name: 'ZIP Code',
        category: 'location',
        severity: 'low',
        patterns: [
            /\b\d{5}(?:[-\s]?\d{4})?\b/g, // US ZIP code
        ],
        contextKeywords: ['zip', 'postal', 'code'],
    },
    {
        id: 'ip_address',
        name: 'IP Address',
        category: 'identifier',
        severity: 'medium',
        patterns: [
            // IPv4
            /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
            // IPv6 (simplified)
            /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g,
        ],
    },
    
    // ============================================
    // DATE/TIME INFORMATION
    // ============================================
    {
        id: 'dob',
        name: 'Date of Birth',
        category: 'personal',
        severity: 'high',
        patterns: [
            /\b(?:DOB|D\.O\.B\.|Date of Birth|Birth Date|Birthday)[-:\s]*\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}\b/gi,
            /\b\d{1,2}[-\/]\d{1,2}[-\/](?:19|20)\d{2}\b/g, // MM/DD/YYYY or DD/MM/YYYY
        ],
        contextKeywords: ['birth', 'born', 'dob', 'birthday', 'age'],
    },
    
    // ============================================
    // GOVERNMENT IDS
    // ============================================
    {
        id: 'passport',
        name: 'Passport Number',
        category: 'identifier',
        severity: 'high',
        patterns: [
            /\b[A-Z]{1,2}\d{6,9}\b/g, // Common passport formats
        ],
        contextKeywords: ['passport', 'travel document', 'nationality'],
    },
    {
        id: 'drivers_license',
        name: 'Driver\'s License Number',
        category: 'identifier',
        severity: 'high',
        patterns: [
            // Various state formats (US)
            /\b[A-Z]{1,2}\d{6,8}\b/g,
            /\b\d{6,10}[A-Z]\d{2,4}\b/g,
        ],
        contextKeywords: ['license', 'driver', 'driving', 'dl', 'dmv'],
    },
];

// ============================================
// PII DETECTION SERVICE CLASS
// ============================================

export class PiiDetectionService {
    private piiTypes: Map<string, PiiType>;
    private options: Required<PiiDetectionOptions>;
    private detectionIdCounter = 0;

    constructor(options: PiiDetectionOptions = {}) {
        this.options = {
            minConfidence: options.minConfidence ?? 50,
            includeContext: options.includeContext ?? true,
            maskValues: options.maskValues ?? true,
            contextWindow: options.contextWindow ?? 50,
            customPatterns: options.customPatterns ?? new Map(),
        };

        this.piiTypes = new Map(PII_TYPES.map(type => [type.id, type]));

        // Add custom patterns
        if (this.options.customPatterns) {
            for (const [typeId, patterns] of this.options.customPatterns) {
                const existing = this.piiTypes.get(typeId);
                if (existing) {
                    existing.patterns = [...existing.patterns, ...patterns];
                }
            }
        }
    }

    // ============================================
    // MAIN DETECTION METHOD
    // ============================================

    detect(text: string, textRegions?: Array<{ text: string; x: number; y: number; width: number; height: number }>): PiiDetectionResult {
        const startTime = performance.now();
        const detections: PiiDetection[] = [];
        let offset = 0;

        // Process text line by line to maintain offset tracking
        const lines = text.split('\n');

        for (const line of lines) {
            const lineDetections = this.detectInLine(line, offset, textRegions);
            detections.push(...lineDetections);
            offset += line.length + 1; // +1 for newline
        }

        // Filter by minimum confidence
        const filteredDetections = detections.filter(d => d.confidence >= this.options.minConfidence);

        // Calculate statistics
        const highSeverityCount = filteredDetections.filter(d => d.severity === 'high').length;
        const mediumSeverityCount = filteredDetections.filter(d => d.severity === 'medium').length;
        const lowSeverityCount = filteredDetections.filter(d => d.severity === 'low').length;
        const uniqueTypes = [...new Set(filteredDetections.map(d => d.type))];

        const processingTimeMs = performance.now() - startTime;

        return {
            detections: filteredDetections,
            totalCount: filteredDetections.length,
            highSeverityCount,
            mediumSeverityCount,
            lowSeverityCount,
            uniqueTypes,
            processingTimeMs,
        };
    }

    // ============================================
    // DETECT IN LINE
    // ============================================

    private detectInLine(line: string, baseOffset: number, textRegions?: Array<{ text: string; x: number; y: number; width: number; height: number }>): PiiDetection[] {
        const detections: PiiDetection[] = [];

        for (const piiType of this.piiTypes.values()) {
            for (const pattern of piiType.patterns) {
                // Reset regex lastIndex
                pattern.lastIndex = 0;

                let match: RegExpExecArray | null;
                while ((match = pattern.exec(line)) !== null) {
                    const value = match[0];
                    const startOffset = baseOffset + match.index;
                    const endOffset = startOffset + value.length;

                    // Calculate confidence
                    let confidence = this.calculateConfidence(value, piiType, line, match.index);

                    // Skip if below minimum confidence
                    if (confidence < this.options.minConfidence) {
                        continue;
                    }

                    // Find corresponding text region if available
                    let regionIndex: number | undefined;
                    if (textRegions) {
                        const region = textRegions.findIndex(r => 
                            line.includes(r.text) || r.text.includes(value)
                        );
                        if (region !== -1) {
                            regionIndex = region;
                        }
                    }

                    // Get context
                    const context = this.options.includeContext
                        ? this.getContext(text, startOffset)
                        : undefined;

                    // Create detection
                    const detection: PiiDetection = {
                        id: `pii-${++this.detectionIdCounter}`,
                        type: piiType.id,
                        typeName: piiType.name,
                        value: value,
                        maskedValue: this.options.maskValues ? this.maskValue(value, piiType.id) : value,
                        confidence,
                        startOffset,
                        endOffset,
                        context,
                        regionIndex,
                        severity: piiType.severity,
                    };

                    detections.push(detection);
                }
            }
        }

        return detections;
    }

    // ============================================
    // CONFIDENCE CALCULATION
    // ============================================

    private calculateConfidence(value: string, piiType: PiiType, line: string, matchIndex: number): number {
        let confidence = 70; // Base confidence for pattern match

        // Boost if context keywords are present
        if (piiType.contextKeywords) {
            const contextWindow = line.slice(Math.max(0, matchIndex - 50), matchIndex + value.length + 50).toLowerCase();
            for (const keyword of piiType.contextKeywords) {
                if (contextWindow.includes(keyword.toLowerCase())) {
                    confidence += 10;
                    break;
                }
            }
        }

        // Validate with type-specific validation function
        if (piiType.validationFn) {
            if (piiType.validationFn(value)) {
                confidence += 20;
            } else {
                confidence -= 30;
            }
        }

        // Pattern-specific adjustments
        switch (piiType.id) {
            case 'email':
                // Higher confidence for well-formed emails
                if (value.includes('.') && !value.includes('..')) {
                    confidence += 5;
                }
                break;
            case 'ssn':
                // Higher confidence for formatted SSN
                if (/^\d{3}-\d{2}-\d{4}$/.test(value)) {
                    confidence += 15;
                }
                break;
            case 'phone':
                // Higher confidence for formatted phone
                if (/[-()\s]/.test(value)) {
                    confidence += 10;
                }
                break;
            case 'credit_card':
                // Check for common test numbers
                const testCards = ['4111111111111111', '5555555555554444', '378282246310005'];
                if (testCards.some(tc => value.includes(tc.replace(/\D/g, '')))) {
                    confidence -= 50; // Likely a test card
                }
                break;
        }

        return Math.min(100, Math.max(0, confidence));
    }

    // ============================================
    // VALUE MASKING
    // ============================================

    private maskValue(value: string, typeId: string): string {
        switch (typeId) {
            case 'email':
                const [local, domain] = value.split('@');
                return `${local.slice(0, 2)}***@${domain}`;
            case 'ssn':
                return `***-**-${value.slice(-4).replace(/\D/g, '')}`;
            case 'phone':
                return `***-***-${value.slice(-4).replace(/\D/g, '')}`;
            case 'credit_card':
                return `****-****-****-${value.slice(-4).replace(/\D/g, '')}`;
            case 'dob':
                return '**/**/****';
            case 'address':
                return value.slice(0, 10) + '...';
            default:
                return value.slice(0, 3) + '*'.repeat(Math.min(value.length - 3, 5));
        }
    }

    // ============================================
    // CONTEXT EXTRACTION
    // ============================================

    private getContext(text: string, offset: number): string {
        const start = Math.max(0, offset - this.options.contextWindow);
        const end = Math.min(text.length, offset + this.options.contextWindow);
        return text.slice(start, end);
    }

    // ============================================
    // UTILITY METHODS
    // ============================================

    /**
     * Get all supported PII types
     */
    getSupportedTypes(): PiiType[] {
        return Array.from(this.piiTypes.values());
    }

    /**
     * Get PII type by ID
     */
    getType(id: string): PiiType | undefined {
        return this.piiTypes.get(id);
    }

    /**
     * Add custom PII type
     */
    addCustomType(type: PiiType): void {
        this.piiTypes.set(type.id, type);
    }

    /**
     * Redact PII from text
     */
    redactText(text: string, replacement: string = '[REDACTED]'): string {
        const result = this.detect(text);
        let redactedText = text;

        // Sort by offset descending to not affect earlier offsets
        const sortedDetections = [...result.detections].sort((a, b) => b.startOffset - a.startOffset);

        for (const detection of sortedDetections) {
            redactedText =
                redactedText.slice(0, detection.startOffset) +
                replacement +
                redactedText.slice(detection.endOffset);
        }

        return redactedText;
    }

    /**
     * Generate redaction boxes from detections and text regions
     */
    generateRedactionBoxes(
        detections: PiiDetection[],
        textRegions: Array<{ text: string; x: number; y: number; width: number; height: number }>
    ): Array<{ x: number; y: number; width: number; height: number; piiType: string; confidence: number }> {
        const boxes: Array<{ x: number; y: number; width: number; height: number; piiType: string; confidence: number }> = [];

        for (const detection of detections) {
            if (detection.regionIndex !== undefined && textRegions[detection.regionIndex]) {
                const region = textRegions[detection.regionIndex];
                boxes.push({
                    x: region.x,
                    y: region.y,
                    width: region.width,
                    height: region.height,
                    piiType: detection.type,
                    confidence: detection.confidence,
                });
            }
        }

        return boxes;
    }
}

// ============================================
// SINGLETON INSTANCE
// ============================================

let serviceInstance: PiiDetectionService | null = null;

export function getPiiDetectionService(options?: PiiDetectionOptions): PiiDetectionService {
    if (!serviceInstance) {
        serviceInstance = new PiiDetectionService(options);
    }
    return serviceInstance;
}

export function destroyPiiDetectionService(): void {
    serviceInstance = null;
}

export default PiiDetectionService;
