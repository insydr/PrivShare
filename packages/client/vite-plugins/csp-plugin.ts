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

import type { Plugin, ResolvedConfig } from 'vite';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// ============================================
// TYPES
// ============================================

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

interface SRIHash {
    file: string;
    hash: string;
}

// ============================================
// CSP GENERATOR
// ============================================

function generateCSP(options: CSPPluginOptions, isDev: boolean): string {
    const productionDomain = options.productionDomain || 'api.privshare.app';
    const wsDomain = options.wsDomain || 'wss://' + productionDomain;
    
    const directives: string[] = [];
    
    // default-src
    directives.push("default-src 'self'");
    
    // script-src
    const scriptSrc: string[] = ["'self'"];
    if (isDev) {
        scriptSrc.push("'wasm-unsafe-eval'", 'blob:');
    } else {
        scriptSrc.push("'wasm-unsafe-eval'");
    }
    if (options.additionalScriptDomains) {
        scriptSrc.push(...options.additionalScriptDomains);
    }
    directives.push('script-src ' + scriptSrc.join(' '));
    
    // worker-src
    directives.push("worker-src 'self' blob:");
    
    // style-src
    const styleSrc: string[] = ["'self'", "'unsafe-inline'"];
    if (options.additionalStyleDomains) {
        styleSrc.push(...options.additionalStyleDomains);
    }
    directives.push('style-src ' + styleSrc.join(' '));
    
    // img-src
    directives.push("img-src 'self' data: blob:");
    
    // font-src
    directives.push("font-src 'self'");
    
    // connect-src
    const connectSrc: string[] = ["'self'"];
    if (isDev) {
        connectSrc.push('ws://localhost:3001', 'ws://localhost:3000');
    } else {
        connectSrc.push('https://' + productionDomain, wsDomain);
    }
    if (options.additionalConnectDomains) {
        connectSrc.push(...options.additionalConnectDomains);
    }
    directives.push('connect-src ' + connectSrc.join(' '));
    
    // object-src - completely disabled
    directives.push("object-src 'none'");
    
    // base-uri
    directives.push("base-uri 'self'");
    
    // Production-only directives
    if (!isDev) {
        directives.push("frame-src 'none'");
        directives.push("form-action 'self'");
        directives.push("frame-ancestors 'none'");
        directives.push("upgrade-insecure-requests");
    }
    
    return directives.join('; ');
}

// ============================================
// SRI HASH GENERATOR
// ============================================

function generateSRIHash(filePath: string): string {
    const content = fs.readFileSync(filePath);
    const hash = crypto.createHash('sha384').update(content).digest('base64');
    return 'sha384-' + hash;
}

function findJsAndWasmFiles(dir: string): string[] {
    const files: string[] = [];
    
    function traverse(currentDir: string) {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);
            
            if (entry.isDirectory()) {
                traverse(fullPath);
            } else if (entry.isFile()) {
                if ((entry.name.endsWith('.js') || entry.name.endsWith('.wasm')) && !entry.name.endsWith('.map')) {
                files.push(fullPath);
            }
        }
    }
    }
    
    traverse(dir);
    return files;
}

function generateSRIHashes(distDir: string): SRIHash[] {
    const hashes: SRIHash[] = [];
    const files = findJsAndWasmFiles(distDir);
    
    for (const file of files) {
        const relativePath = path.relative(distDir, file).replace(/\\/g, '/');
        const hash = generateSRIHash(file);
        hashes.push({ file: relativePath, hash });
    }
    
    return hashes;
}

// ============================================
// HTML INTEGRITY INJECTOR
// ============================================

function injectIntegrityIntoHtml(
    htmlPath: string,
    hashes: SRIHash[]
): { modified: boolean; injected: number; errors: string[] } {
    let htmlContent = fs.readFileSync(htmlPath, 'utf-8');
    const errors: string[] = [];
    let injected = 0;
    
    for (const { file, hash } of hashes) {
        // Skip source maps
        if (file.endsWith('.map') || file.endsWith('.wasm')) {
            continue;
        }
        
        const fileName = path.basename(file);
        
        // Pattern to match script tags for this file
        // Examples:
        // <script type="module" crossorigin src="./assets/index-abc123.js"></script>
        // <script type="module" src="/assets/index-abc123.js"></script>
        const patterns = [
            // With crossorigin already present
            new RegExp(`(<script[^>]*?crossorigin[^>]*?src=["'][^"']*?${fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*?>)`, 'g'),
            // Without crossorigin
            new RegExp(`(<script[^>]*?src=["'][^"']*?${fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*?>)`, 'g'),
        ];
        
        let matched = false;
        for (const pattern of patterns) {
            const matches = htmlContent.match(pattern);
            if (matches) {
                const originalTag = matches[1];
                
                // Check if integrity already exists
                if (originalTag.includes('integrity=')) {
                    // Verify existing integrity matches
                    const existingIntegrityMatch = originalTag.match(/integrity="([^"]+)"/);
                    if (existingIntegrityMatch && existingIntegrityMatch[1] === hash) {
                        console.log(`[vite-csp-plugin] SRI already correct for: ${fileName}`);
                    } else {
                        errors.push(`Integrity mismatch for ${fileName}`);
                    }
                    matched = true;
                    continue;
                }
                
                // Inject integrity and crossorigin
                let newTag: string;
                if (originalTag.includes('crossorigin')) {
                    // Add integrity after crossorigin
                    newTag = originalTag.replace(
                        /(crossorigin=["']anonymous["'])/,
                        `$1 integrity="${hash}" `
                    );
                } else {
                    // Add both crossorigin and integrity
                    newTag = originalTag.replace(
                        /(<script[^>]*?src=["'][^"']*?)(["'][^>]*?>)/,
                        `$1 crossorigin="anonymous" integrity="${hash}"$2`
                    );
                }
                
                if (newTag !== originalTag) {
                    htmlContent = htmlContent.replace(originalTag, newTag);
                    console.log(`[vite-csp-plugin] Injected SRI for: ${fileName}`);
                    injected++;
                }
                
                matched = true;
                break;
            }
        }
        
        if (!matched && !file.includes('.wasm')) {
            // Try to find script tag with different path formats
            const altPatterns = [
                new RegExp(`(<script[^>]*?src=["']\\.?/?assets/${fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'])`, 'g'),
                new RegExp(`(<script[^>]*?src=["']\\.?/?${fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'])`, 'g'),
            ];
            
            for (const pattern of altPatterns) {
                const matches = htmlContent.match(pattern);
                if (matches) {
                    const originalTag = matches[1];
                    const newTag = originalTag.replace(
                        /(<script[^>]*?src=["'][^"']*?)(["'][^>]*?>)/,
                        `$1 crossorigin="anonymous" integrity="${hash}"$2`
                    );
                    htmlContent = htmlContent.replace(originalTag, newTag);
                    console.log(`[vite-csp-plugin] Injected SRI for: ${fileName} (alt pattern)`);
                    injected++;
                    break;
                }
            }
        }
    }
    
    // Write updated HTML
    fs.writeFileSync(htmlPath, htmlContent);
    
    return { modified: true, injected, errors };
}

// ============================================
// SRI VALIDATION
// ============================================

interface SRIValidationResult {
    valid: boolean;
    totalScripts: number;
    scriptsWithIntegrity: number;
    missingIntegrity: string[];
    errors: string[];
}

function validateSRIInDist(distDir: string, hashes: SRIHash[]): SRIValidationResult {
    const result: SRIValidationResult = {
        valid: true,
        totalScripts: 0,
        scriptsWithIntegrity: 0,
        missingIntegrity: [],
        errors: []
    };
    
    // Check index.html for integrity attributes
    const indexHtmlPath = path.join(distDir, 'index.html');
    if (fs.existsSync(indexHtmlPath)) {
        const htmlContent = fs.readFileSync(indexHtmlPath, 'utf-8');
        
        // Count script tags
        const scriptTags = htmlContent.match(/<script[^>]*?src=/g) || [];
        result.totalScripts = scriptTags.length;
        
        // Count script tags with integrity
        const scriptsWithSRI = htmlContent.match(/<script[^>]*?integrity=/g) || [];
        result.scriptsWithIntegrity = scriptsWithSRI ? scriptsWithSRI.length : 0;
        
        // Find script tags without integrity
        const scriptTagMatches = htmlContent.matchAll(/<script[^>]*?src=["']([^"']+)["'][^>]*?>/g);
        for (const match of scriptTagMatches) {
            const src = match[1];
            if (!src.includes('integrity=')) {
                result.missingIntegrity.push(src);
                result.valid = false;
            }
        }
    }
    
    // Verify hashes match actual file contents
    for (const { file, hash } of hashes) {
        if (file.endsWith('.js') && !file.endsWith('.map')) {
            const filePath = path.join(distDir, file);
            if (fs.existsSync(filePath)) {
                const actualHash = generateSRIHash(filePath);
                if (actualHash !== hash) {
                    result.errors.push(`Hash mismatch for ${file}`);
                    result.valid = false;
                }
            }
        }
    }
    
    return result;
}

// ============================================
// PLUGIN EXPORT
// ============================================

export function viteCSPPlugin(options: CSPPluginOptions = {}): Plugin {
    let config: ResolvedConfig;
    const sriHashes: SRIHash[] = [];
    
    return {
        name: 'vite-csp-plugin',
        
        configResolved(resolvedConfig: ResolvedConfig) {
            config = resolvedConfig;
        },
        
        transformIndexHtml(html: string): string {
            // Add CSP meta tag if not already present
            if (!html.includes('Content-Security-Policy')) {
                const isDev = config.mode === 'development';
                const csp = generateCSP(options, isDev);
                
                // Insert CSP meta tag in head
                const cspMeta = '    <meta http-equiv="Content-Security-Policy" content="' + csp + '" />';
                
                if (html.includes('<head>')) {
                    html = html.replace('<head>', '<head>\n' + cspMeta);
                } else {
                    html = '<!DOCTYPE html><html><head>\n' + cspMeta + '</head><body></body></html>';
                }
            }
            
            return html;
        },
        
        writeBundle() {
            // Generate SRI hashes after bundle is written
            if (options.generateSRI !== false) {
                const distDir = config.build.outDir;
                
                try {
                    const hashes = generateSRIHashes(distDir);
                    sriHashes.push(...hashes);
                    
                    // Inject integrity into HTML
                    const indexHtmlPath = path.join(distDir, 'index.html');
                    if (fs.existsSync(indexHtmlPath)) {
                        const result = injectIntegrityIntoHtml(indexHtmlPath, hashes);
                        
                        if (result.injected > 0) {
                            console.log('[vite-csp-plugin] Injected SRI into ' + result.injected + ' script tags');
                        }
                        
                        if (result.errors.length > 0) {
                            console.error('[vite-csp-plugin] SRI errors:', result.errors);
                        }
                    }
                    
                    // Validate SRI
                    const validation = validateSRIInDist(distDir, hashes);
                    console.log('[vite-csp-plugin] SRI Validation:');
                    console.log('  Total scripts: ' + validation.totalScripts);
                    console.log('  Scripts with SRI: ' + validation.scriptsWithIntegrity);
                    
                    if (!validation.valid) {
                        console.warn('[vite-csp-plugin] SRI validation warnings:');
                        if (validation.missingIntegrity.length > 0) {
                            console.warn('  Missing integrity:', validation.missingIntegrity);
                        }
                        if (validation.errors.length > 0) {
                            console.error('  Errors:', validation.errors);
                        }
                    } else {
                        console.log('[vite-csp-plugin] ✅ All scripts have valid SRI integrity');
                    }
                    
                    // Write integrity.json
                    const integrityPath = path.join(distDir, 'integrity.json');
                    const integrityData = {
                        generated: new Date().toISOString(),
                        environment: process.env.NODE_ENV || config.mode,
                        buildHash: crypto.createHash('sha256').update(JSON.stringify(hashes)).digest('hex').substring(0, 16),
                        hashes: hashes.reduce((acc, { file, hash }) => {
                            acc[file] = hash;
                            return acc;
                        }, {} as Record<string, string>),
                        validation: {
                            totalScripts: validation.totalScripts,
                            scriptsWithIntegrity: validation.scriptsWithIntegrity,
                            valid: validation.valid
                        },
                        csp: {
                            development: generateCSP(options, true),
                            production: generateCSP(options, false)
                        }
                    };
                    
                    fs.writeFileSync(integrityPath, JSON.stringify(integrityData, null, 2));
                    console.log('[vite-csp-plugin] Generated integrity.json');
                    
                    // Log SRI hashes
                    for (const { file, hash } of hashes) {
                        console.log('[vite-csp-plugin] SRI: ' + file + ' -> ' + hash.substring(0, 30) + '...');
                    }
                } catch (error) {
                    console.error('[vite-csp-plugin] Error generating SRI hashes:', error);
                }
            }
        },
        
        closeBundle() {
            // Generate CSP headers file for server config
            const distDir = config.build.outDir;
            const cspHeadersPath = path.join(distDir, 'csp-headers.txt');
            
            const csp = generateCSP(options, false);
            
            const headersContent = `# Content Security Policy Header for PrivShare
# Add this to your Nginx or Apache configuration
#
# Nginx:
# add_header Content-Security-Policy "${csp}" always;
#
# Apache (.htaccess):
# Header set Content-Security-Policy "${csp}"
#
# Additional Security Headers:
# X-Frame-Options: DENY
# X-Content-Type-Options: nosniff
# X-XSS-Protection: 1; mode=block
# Referrer-Policy: strict-origin-when-cross-origin
# Permissions-Policy: accelerometer=(), camera=(), geolocation=(), microphone=()
# Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
`;
            
            fs.writeFileSync(cspHeadersPath, headersContent);
            console.log('[vite-csp-plugin] Generated csp-headers.txt');
        }
    };
}

export default viteCSPPlugin;
