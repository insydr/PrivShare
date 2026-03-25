/**
 * PolicyEngine
 * =============
 * 
 * Service for enforcing document redaction policies before export.
 * Administrators can define rules that must be satisfied before a document
 * can be exported or shared.
 * 
 * Policy Types:
 * - must_redact_pii_type: Require redaction of specific PII types
 * - must_redact_all_detected: Require all detected PII to be redacted
 * - min_redaction_count: Minimum number of redactions required
 * - required_redaction_areas: Specific areas that must be redacted
 * - no_empty_export: Prevent exporting document with no redactions
 */

// ============================================
// TYPES
// ============================================

export type PolicySeverity = 'blocking' | 'warning';

export interface PolicyRuleBase {
    id: string;
    name: string;
    description: string;
    severity: PolicySeverity;
    message: string;
}

export interface MustRedactPiiTypeRule extends PolicyRuleBase {
    type: 'must_redact_pii_type';
    piiTypes: string[]; // e.g., ['ssn', 'email', 'phone']
    minConfidence?: number;
}

export interface MustRedactAllDetectedRule extends PolicyRuleBase {
    type: 'must_redact_all_detected';
    piiTypes?: string[]; // If specified, only these types; otherwise all
    minConfidence?: number;
}

export interface MinRedactionCountRule extends PolicyRuleBase {
    type: 'min_redaction_count';
    minCount: number;
}

export interface RequiredRedactionAreasRule extends PolicyRuleBase {
    type: 'required_redaction_areas';
    areas: Array<{
        x: number;
        y: number;
        width: number;
        height: number;
        label?: string;
    }>;
    tolerance?: number; // Allow slight variations in position
}

export interface NoEmptyExportRule extends PolicyRuleBase {
    type: 'no_empty_export';
    allowOverride?: boolean;
}

export interface MaxFileSizeRule extends PolicyRuleBase {
    type: 'max_file_size';
    maxSizeMB: number;
}

export interface RequiredMetadataRule extends PolicyRuleBase {
    type: 'required_metadata';
    fields: string[]; // e.g., ['documentName', 'originalHash', 'redactedHash']
}

export type PolicyRule = 
    | MustRedactPiiTypeRule
    | MustRedactAllDetectedRule
    | MinRedactionCountRule
    | RequiredRedactionAreasRule
    | NoEmptyExportRule
    | MaxFileSizeRule
    | RequiredMetadataRule;

export interface Policy {
    id: string;
    name: string;
    description: string;
    version: string;
    enabled: boolean;
    rules: PolicyRule[];
    createdAt: Date;
    updatedAt: Date;
}

export interface ValidationResult {
    ruleId: string;
    ruleName: string;
    passed: boolean;
    severity: PolicySeverity;
    message: string;
    details?: string;
    affectedItems?: string[];
}

export interface PolicyValidationResult {
    policyId: string;
    policyName: string;
    passed: boolean;
    blockingErrors: ValidationResult[];
    warnings: ValidationResult[];
    canOverride: boolean;
    overrideReason?: string;
}

export interface ValidationContext {
    redactions: Array<{
        id: string;
        x: number;
        y: number;
        width: number;
        height: number;
        type: 'auto' | 'manual';
        piiType?: string;
        confidence?: number;
    }>;
    piiDetections: Array<{
        id: string;
        type: string;
        value: string;
        confidence: number;
        regionIndex?: number;
        severity: 'high' | 'medium' | 'low';
    }>;
    textRegions: Array<{
        id: string;
        text: string;
        x: number;
        y: number;
        width: number;
        height: number;
        confidence: number;
    }>;
    documentSize: number;
    metadata: Record<string, unknown>;
}

// ============================================
// DEFAULT POLICIES
// ============================================

export const DEFAULT_POLICIES: Policy[] = [
    {
        id: 'default-basic-security',
        name: 'Basic Security Policy',
        description: 'Ensures all high-severity PII is redacted before export',
        version: '1.0.0',
        enabled: true,
        rules: [
            {
                id: 'rule-ssn',
                type: 'must_redact_pii_type',
                name: 'SSN Redaction Required',
                description: 'Social Security Numbers must be redacted',
                severity: 'blocking',
                message: 'All Social Security Numbers must be redacted before export',
                piiTypes: ['ssn'],
                minConfidence: 70,
            },
            {
                id: 'rule-credit-card',
                type: 'must_redact_pii_type',
                name: 'Credit Card Redaction Required',
                description: 'Credit card numbers must be redacted',
                severity: 'blocking',
                message: 'All credit card numbers must be redacted before export',
                piiTypes: ['credit_card'],
                minConfidence: 70,
            },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
    },
    {
        id: 'default-minimum-redactions',
        name: 'Minimum Redaction Policy',
        description: 'Ensures at least some redaction has been performed',
        version: '1.0.0',
        enabled: true,
        rules: [
            {
                id: 'rule-no-empty',
                type: 'no_empty_export',
                name: 'No Empty Export',
                description: 'Document must have at least one redaction',
                severity: 'warning',
                message: 'Document has no redactions. Are you sure you want to export?',
                allowOverride: true,
            },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
    },
];

// ============================================
// POLICY ENGINE CLASS
// ============================================

export class PolicyEngine {
    private policies: Map<string, Policy> = new Map();
    private debug: boolean;

    constructor(debug: boolean = false) {
        this.debug = debug;
        
        // Load default policies
        for (const policy of DEFAULT_POLICIES) {
            if (policy.enabled) {
                this.policies.set(policy.id, policy);
            }
        }
    }

    // ============================================
    // POLICY MANAGEMENT
    // ============================================

    /**
     * Add or update a policy
     */
    setPolicy(policy: Policy): void {
        this.policies.set(policy.id, {
            ...policy,
            updatedAt: new Date(),
        });
        this.log('Policy set:', policy.id, policy.name);
    }

    /**
     * Remove a policy
     */
    removePolicy(policyId: string): boolean {
        const result = this.policies.delete(policyId);
        this.log('Policy removed:', policyId, result);
        return result;
    }

    /**
     * Get a policy by ID
     */
    getPolicy(policyId: string): Policy | undefined {
        return this.policies.get(policyId);
    }

    /**
     * Get all policies
     */
    getAllPolicies(): Policy[] {
        return Array.from(this.policies.values());
    }

    /**
     * Enable or disable a policy
     */
    setPolicyEnabled(policyId: string, enabled: boolean): boolean {
        const policy = this.policies.get(policyId);
        if (policy) {
            policy.enabled = enabled;
            policy.updatedAt = new Date();
            if (!enabled) {
                this.policies.delete(policyId);
            }
            return true;
        }
        return false;
    }

    // ============================================
    // VALIDATION
    // ============================================

    /**
     * Validate document against all active policies
     */
    validate(context: ValidationContext): PolicyValidationResult[] {
        const results: PolicyValidationResult[] = [];

        for (const policy of this.policies.values()) {
            const result = this.validatePolicy(policy, context);
            results.push(result);
        }

        return results;
    }

    /**
     * Validate document against a specific policy
     */
    validatePolicy(policy: Policy, context: ValidationContext): PolicyValidationResult {
        const results: ValidationResult[] = [];

        for (const rule of policy.rules) {
            const result = this.validateRule(rule, context);
            results.push(result);
        }

        const blockingErrors = results.filter(r => !r.passed && r.severity === 'blocking');
        const warnings = results.filter(r => !r.passed && r.severity === 'warning');

        const canOverride = warnings.length > 0 && blockingErrors.length === 0;

        return {
            policyId: policy.id,
            policyName: policy.name,
            passed: blockingErrors.length === 0,
            blockingErrors,
            warnings,
            canOverride,
            overrideReason: canOverride 
                ? 'Only warnings present, export can proceed with acknowledgment'
                : undefined,
        };
    }

    /**
     * Validate a single rule
     */
    private validateRule(rule: PolicyRule, context: ValidationContext): ValidationResult {
        let result: ValidationResult;

        switch (rule.type) {
            case 'must_redact_pii_type':
                result = this.validateMustRedactPiiType(rule, context);
                break;
            case 'must_redact_all_detected':
                result = this.validateMustRedactAllDetected(rule, context);
                break;
            case 'min_redaction_count':
                result = this.validateMinRedactionCount(rule, context);
                break;
            case 'required_redaction_areas':
                result = this.validateRequiredRedactionAreas(rule, context);
                break;
            case 'no_empty_export':
                result = this.validateNoEmptyExport(rule, context);
                break;
            case 'max_file_size':
                result = this.validateMaxFileSize(rule, context);
                break;
            case 'required_metadata':
                result = this.validateRequiredMetadata(rule, context);
                break;
            default:
                result = {
                    ruleId: rule.id,
                    ruleName: rule.name,
                    passed: true,
                    severity: rule.severity,
                    message: 'Unknown rule type - skipping',
                };
        }

        return result;
    }

    // ============================================
    // RULE VALIDATORS
    // ============================================

    private validateMustRedactPiiType(
        rule: MustRedactPiiTypeRule, 
        context: ValidationContext
    ): ValidationResult {
        const minConfidence = rule.minConfidence ?? 50;
        
        // Find all PII detections of the specified types
        const unredactedPii = context.piiDetections.filter(detection => 
            rule.piiTypes.includes(detection.type) &&
            detection.confidence >= minConfidence
        );

        // Check which are NOT redacted
        const redactedPiiTypes = new Set(
            context.redactions
                .filter(r => r.type === 'auto' && r.piiType)
                .map(r => r.piiType)
        );

        const notRedacted = unredactedPii.filter(d => !redactedPiiTypes.has(d.type));

        if (notRedacted.length === 0) {
            return {
                ruleId: rule.id,
                ruleName: rule.name,
                passed: true,
                severity: rule.severity,
                message: `All ${rule.piiTypes.join(', ')} have been redacted`,
            };
        }

        const affectedItems = notRedacted.map(d => d.value);
        return {
            ruleId: rule.id,
            ruleName: rule.name,
            passed: false,
            severity: rule.severity,
            message: rule.message,
            details: `Found ${notRedacted.length} unredacted PII items of types: ${rule.piiTypes.join(', ')}`,
            affectedItems,
        };
    }

    private validateMustRedactAllDetected(
        rule: MustRedactAllDetectedRule,
        context: ValidationContext
    ): ValidationResult {
        const minConfidence = rule.minConfidence ?? 50;
        const piiTypes = rule.piiTypes;

        // Filter detections by type and confidence
        let relevantDetections = context.piiDetections.filter(d => 
            d.confidence >= minConfidence
        );

        if (piiTypes && piiTypes.length > 0) {
            relevantDetections = relevantDetections.filter(d => 
                piiTypes.includes(d.type)
            );
        }

        // Check if all detections have corresponding redactions
        const redactionPiiTypes = new Set(
            context.redactions
                .filter(r => r.type === 'auto')
                .map(r => r.piiType)
        );

        const notRedacted = relevantDetections.filter(d => 
            !redactionPiiTypes.has(d.type)
        );

        if (notRedacted.length === 0) {
            return {
                ruleId: rule.id,
                ruleName: rule.name,
                passed: true,
                severity: rule.severity,
                message: 'All detected PII has been redacted',
            };
        }

        return {
            ruleId: rule.id,
            ruleName: rule.name,
            passed: false,
            severity: rule.severity,
            message: rule.message,
            details: `${notRedacted.length} PII items remain unredacted`,
            affectedItems: notRedacted.map(d => `${d.type}: ${d.value}`),
        };
    }

    private validateMinRedactionCount(
        rule: MinRedactionCountRule,
        context: ValidationContext
    ): ValidationResult {
        const count = context.redactions.length;

        if (count >= rule.minCount) {
            return {
                ruleId: rule.id,
                ruleName: rule.name,
                passed: true,
                severity: rule.severity,
                message: `Document has ${count} redactions (minimum: ${rule.minCount})`,
            };
        }

        return {
            ruleId: rule.id,
            ruleName: rule.name,
            passed: false,
            severity: rule.severity,
            message: rule.message,
            details: `Document has ${count} redactions, but ${rule.minCount} are required`,
        };
    }

    private validateRequiredRedactionAreas(
        rule: RequiredRedactionAreasRule,
        context: ValidationContext
    ): ValidationResult {
        const tolerance = rule.tolerance ?? 10;
        const missingAreas: string[] = [];

        for (const area of rule.areas) {
            const hasRedaction = context.redactions.some(redaction => {
                const xMatch = Math.abs(redaction.x - area.x) <= tolerance;
                const yMatch = Math.abs(redaction.y - area.y) <= tolerance;
                const widthMatch = Math.abs(redaction.width - area.width) <= tolerance;
                const heightMatch = Math.abs(redaction.height - area.height) <= tolerance;
                return xMatch && yMatch && widthMatch && heightMatch;
            });

            if (!hasRedaction) {
                missingAreas.push(area.label || `(${area.x}, ${area.y})`);
            }
        }

        if (missingAreas.length === 0) {
            return {
                ruleId: rule.id,
                ruleName: rule.name,
                passed: true,
                severity: rule.severity,
                message: 'All required areas have been redacted',
            };
        }

        return {
            ruleId: rule.id,
            ruleName: rule.name,
            passed: false,
            severity: rule.severity,
            message: rule.message,
            details: `Missing redactions for areas: ${missingAreas.join(', ')}`,
        };
    }

    private validateNoEmptyExport(
        rule: NoEmptyExportRule,
        context: ValidationContext
    ): ValidationResult {
        if (context.redactions.length > 0) {
            return {
                ruleId: rule.id,
                ruleName: rule.name,
                passed: true,
                severity: rule.severity,
                message: `Document has ${context.redactions.length} redactions`,
            };
        }

        return {
            ruleId: rule.id,
            ruleName: rule.name,
            passed: false,
            severity: rule.severity,
            message: rule.message,
            details: 'No redactions applied to document',
        };
    }

    private validateMaxFileSize(
        rule: MaxFileSizeRule,
        context: ValidationContext
    ): ValidationResult {
        const sizeMB = context.documentSize / (1024 * 1024);

        if (sizeMB <= rule.maxSizeMB) {
            return {
                ruleId: rule.id,
                ruleName: rule.name,
                passed: true,
                severity: rule.severity,
                message: `File size (${sizeMB.toFixed(2)}MB) is within limit`,
            };
        }

        return {
            ruleId: rule.id,
            ruleName: rule.name,
            passed: false,
            severity: rule.severity,
            message: rule.message,
            details: `File size (${sizeMB.toFixed(2)}MB) exceeds limit (${rule.maxSizeMB}MB)`,
        };
    }

    private validateRequiredMetadata(
        rule: RequiredMetadataRule,
        context: ValidationContext
    ): ValidationResult {
        const missingFields = rule.fields.filter(field => 
            !context.metadata[field]
        );

        if (missingFields.length === 0) {
            return {
                ruleId: rule.id,
                ruleName: rule.name,
                passed: true,
                severity: rule.severity,
                message: 'All required metadata present',
            };
        }

        return {
            ruleId: rule.id,
            ruleName: rule.name,
            passed: false,
            severity: rule.severity,
            message: rule.message,
            details: `Missing metadata fields: ${missingFields.join(', ')}`,
        };
    }

    // ============================================
    // UTILITY
    // ============================================

    /**
     * Check if export is allowed given validation results
     */
    canExport(results: PolicyValidationResult[]): { 
        allowed: boolean; 
        requiresAcknowledgment: boolean;
        blockingPolicies: string[];
        warningPolicies: string[];
    } {
        const blockingPolicies: string[] = [];
        const warningPolicies: string[] = [];

        for (const result of results) {
            if (!result.passed) {
                if (result.blockingErrors.length > 0) {
                    blockingPolicies.push(result.policyName);
                } else if (result.warnings.length > 0) {
                    warningPolicies.push(result.policyName);
                }
            }
        }

        const allowed = blockingPolicies.length === 0;
        const requiresAcknowledgment = warningPolicies.length > 0 && blockingPolicies.length === 0;

        return {
            allowed,
            requiresAcknowledgment,
            blockingPolicies,
            warningPolicies,
        };
    }

    /**
     * Generate a summary report of validation results
     */
    generateReport(results: PolicyValidationResult[]): string {
        const lines: string[] = [
            '# Policy Validation Report',
            `Generated: ${new Date().toISOString()}`,
            '',
        ];

        for (const result of results) {
            lines.push(`## Policy: ${result.policyName}`);
            lines.push(`Status: ${result.passed ? '✅ PASSED' : '❌ FAILED'}`);
            lines.push('');

            if (result.blockingErrors.length > 0) {
                lines.push('### Blocking Errors');
                for (const error of result.blockingErrors) {
                    lines.push(`- **${error.ruleName}**: ${error.message}`);
                    if (error.details) {
                        lines.push(`  - ${error.details}`);
                    }
                }
                lines.push('');
            }

            if (result.warnings.length > 0) {
                lines.push('### Warnings');
                for (const warning of result.warnings) {
                    lines.push(`- **${warning.ruleName}**: ${warning.message}`);
                    if (warning.details) {
                        lines.push(`  - ${warning.details}`);
                    }
                }
                lines.push('');
            }
        }

        return lines.join('\n');
    }

    private log(message: string, ...args: unknown[]): void {
        if (this.debug) {
            console.log(`[PolicyEngine] ${message}`, ...args);
        }
    }
}

// ============================================
// SINGLETON INSTANCE
// ============================================

let engineInstance: PolicyEngine | null = null;

export function getPolicyEngine(debug?: boolean): PolicyEngine {
    if (!engineInstance) {
        engineInstance = new PolicyEngine(debug);
    }
    return engineInstance;
}

export function destroyPolicyEngine(): void {
    engineInstance = null;
}

export default PolicyEngine;
