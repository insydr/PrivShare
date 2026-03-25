/**
 * Vite CSP Plugin
 * =================
 *
 * Generates and injects Content Security Policy headers during build.
 * Also handles SRI (Subresource Integrity) hash generation for scripts.
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
