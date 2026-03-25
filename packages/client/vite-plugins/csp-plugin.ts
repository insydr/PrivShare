/**
 * Vite CSP Plugin
 * =================
 * 
 * Generates and injects Content Security Policy headers during build.
 * Also handles SRI (Subresource Integrity) hash generation for scripts.
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
                    
                    // Write integrity.json
                    const integrityPath = path.join(distDir, 'integrity.json');
                    const integrityData = {
                        generated: new Date().toISOString(),
                        hashes: hashes.reduce((acc, { file, hash }) => {
                            acc[file] = hash;
                            return acc;
                        }, {} as Record<string, string>),
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
            
            const headersContent = '# Content Security Policy Header for PrivShare\n# Add this to your Nginx or Apache configuration\n#\n# Nginx:\n# add_header Content-Security-Policy "' + csp + '" always;\n#\n# Apache (.htaccess):\n# Header set Content-Security-Policy "' + csp + '"\n#\n# Additional Security Headers:\n# X-Frame-Options: DENY\n# X-Content-Type-Options: nosniff\n# X-XSS-Protection: 1; mode=block\n# Referrer-Policy: strict-origin-when-cross-origin\n# Permissions-Policy: accelerometer=(), camera=(), geolocation=(), microphone=()\n# Strict-Transport-Security: max-age=31536000; includeSubDomains; preload\n';
            
            fs.writeFileSync(cspHeadersPath, headersContent);
            console.log('[vite-csp-plugin] Generated csp-headers.txt');
        }
    };
}

export default viteCSPPlugin;
