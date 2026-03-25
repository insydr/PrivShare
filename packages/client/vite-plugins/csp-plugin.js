/**
 * Vite CSP Plugin
 * =================
 *
 * Generates and injects Content Security Policy headers during build.
 * Also handles SRI (Subresource Integrity) hash generation for scripts.
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
// ============================================
// CSP GENERATOR
// ============================================
function generateCSP(options, isDev) {
    var productionDomain = options.productionDomain || 'api.privshare.app';
    var wsDomain = options.wsDomain || 'wss://' + productionDomain;
    var directives = [];
    // default-src
    directives.push("default-src 'self'");
    // script-src
    var scriptSrc = ["'self'"];
    if (isDev) {
        scriptSrc.push("'wasm-unsafe-eval'", 'blob:');
    }
    else {
        scriptSrc.push("'wasm-unsafe-eval'");
    }
    if (options.additionalScriptDomains) {
        scriptSrc.push.apply(scriptSrc, options.additionalScriptDomains);
    }
    directives.push('script-src ' + scriptSrc.join(' '));
    // worker-src
    directives.push("worker-src 'self' blob:");
    // style-src
    var styleSrc = ["'self'", "'unsafe-inline'"];
    if (options.additionalStyleDomains) {
        styleSrc.push.apply(styleSrc, options.additionalStyleDomains);
    }
    directives.push('style-src ' + styleSrc.join(' '));
    // img-src
    directives.push("img-src 'self' data: blob:");
    // font-src
    directives.push("font-src 'self'");
    // connect-src
    var connectSrc = ["'self'"];
    if (isDev) {
        connectSrc.push('ws://localhost:3001', 'ws://localhost:3000');
    }
    else {
        connectSrc.push('https://' + productionDomain, wsDomain);
    }
    if (options.additionalConnectDomains) {
        connectSrc.push.apply(connectSrc, options.additionalConnectDomains);
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
function generateSRIHash(filePath) {
    var content = fs.readFileSync(filePath);
    var hash = crypto.createHash('sha384').update(content).digest('base64');
    return 'sha384-' + hash;
}
function findJsAndWasmFiles(dir) {
    var files = [];
    function traverse(currentDir) {
        var entries = fs.readdirSync(currentDir, { withFileTypes: true });
        for (var _i = 0, entries_1 = entries; _i < entries_1.length; _i++) {
            var entry = entries_1[_i];
            var fullPath = path.join(currentDir, entry.name);
            if (entry.isDirectory()) {
                traverse(fullPath);
            }
            else if (entry.isFile()) {
                if ((entry.name.endsWith('.js') || entry.name.endsWith('.wasm')) && !entry.name.endsWith('.map')) {
                    files.push(fullPath);
                }
            }
        }
    }
    traverse(dir);
    return files;
}
function generateSRIHashes(distDir) {
    var hashes = [];
    var files = findJsAndWasmFiles(distDir);
    for (var _i = 0, files_1 = files; _i < files_1.length; _i++) {
        var file = files_1[_i];
        var relativePath = path.relative(distDir, file).replace(/\\/g, '/');
        var hash = generateSRIHash(file);
        hashes.push({ file: relativePath, hash: hash });
    }
    return hashes;
}
// ============================================
// PLUGIN EXPORT
// ============================================
export function viteCSPPlugin(options) {
    if (options === void 0) { options = {}; }
    var config;
    var sriHashes = [];
    return {
        name: 'vite-csp-plugin',
        configResolved: function (resolvedConfig) {
            config = resolvedConfig;
        },
        transformIndexHtml: function (html) {
            // Add CSP meta tag if not already present
            if (!html.includes('Content-Security-Policy')) {
                var isDev = config.mode === 'development';
                var csp = generateCSP(options, isDev);
                // Insert CSP meta tag in head
                var cspMeta = '    <meta http-equiv="Content-Security-Policy" content="' + csp + '" />';
                if (html.includes('<head>')) {
                    html = html.replace('<head>', '<head>\n' + cspMeta);
                }
                else {
                    html = '<!DOCTYPE html><html><head>\n' + cspMeta + '</head><body></body></html>';
                }
            }
            return html;
        },
        writeBundle: function () {
            // Generate SRI hashes after bundle is written
            if (options.generateSRI !== false) {
                var distDir = config.build.outDir;
                try {
                    var hashes = generateSRIHashes(distDir);
                    sriHashes.push.apply(sriHashes, hashes);
                    // Write integrity.json
                    var integrityPath = path.join(distDir, 'integrity.json');
                    var integrityData = {
                        generated: new Date().toISOString(),
                        hashes: hashes.reduce(function (acc, _a) {
                            var file = _a.file, hash = _a.hash;
                            acc[file] = hash;
                            return acc;
                        }, {}),
                        csp: {
                            development: generateCSP(options, true),
                            production: generateCSP(options, false)
                        }
                    };
                    fs.writeFileSync(integrityPath, JSON.stringify(integrityData, null, 2));
                    console.log('[vite-csp-plugin] Generated integrity.json');
                    // Log SRI hashes
                    for (var _i = 0, hashes_1 = hashes; _i < hashes_1.length; _i++) {
                        var _a = hashes_1[_i], file = _a.file, hash = _a.hash;
                        console.log('[vite-csp-plugin] SRI: ' + file + ' -> ' + hash.substring(0, 30) + '...');
                    }
                }
                catch (error) {
                    console.error('[vite-csp-plugin] Error generating SRI hashes:', error);
                }
            }
        },
        closeBundle: function () {
            // Generate CSP headers file for server config
            var distDir = config.build.outDir;
            var cspHeadersPath = path.join(distDir, 'csp-headers.txt');
            var csp = generateCSP(options, false);
            var headersContent = '# Content Security Policy Header for PrivShare\n# Add this to your Nginx or Apache configuration\n#\n# Nginx:\n# add_header Content-Security-Policy "' + csp + '" always;\n#\n# Apache (.htaccess):\n# Header set Content-Security-Policy "' + csp + '"\n#\n# Additional Security Headers:\n# X-Frame-Options: DENY\n# X-Content-Type-Options: nosniff\n# X-XSS-Protection: 1; mode=block\n# Referrer-Policy: strict-origin-when-cross-origin\n# Permissions-Policy: accelerometer=(), camera=(), geolocation=(), microphone=()\n# Strict-Transport-Security: max-age=31536000; includeSubDomains; preload\n';
            fs.writeFileSync(cspHeadersPath, headersContent);
            console.log('[vite-csp-plugin] Generated csp-headers.txt');
        }
    };
}
export default viteCSPPlugin;
