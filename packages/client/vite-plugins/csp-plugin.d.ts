/**
 * Enhanced Vite CSP Plugin with SRI Injection
 * ===================================
 *
 * Generates and injects Content Security Policy headers during build.
 * Also handles SRI (Subresource Integrity) hash generation for scripts.
 *
 * This enhanced version:
 * - Directly injects integrity attributes into HTML script tags
 * - Generate integrity.json with all file hashes
 * - Generate csp-headers.txt for server configuration
 * - Validate SRI hashes during build
 */
import type { Plugin } from 'vite';
interface CSPPluginOptions {
    /**
     * Production domain for connect-src
     */
    productionDomain?: string;
    /**
     * WebSocket domain for connect-src
     */
    wsDomain?: string;
    /**
     * Whether to generate SRI hashes
     */
    generateSRI?: boolean;
    /**
     * Additional script domains
     */
    additionalScriptDomains?: string[];
    /**
     * Additional style domains
     */
    additionalStyleDomains?: string[];
    /**
     * Additional connect domains
     */
    additionalConnectDomains?: string[];
    /**
     * Report-only mode (for testing)
     */
    reportOnly?: boolean;
}
export declare function viteCSPPlugin(options?: CSPPluginOptions): Plugin;
export default viteCSPPlugin;
