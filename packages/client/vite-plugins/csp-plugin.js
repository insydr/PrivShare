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
// HTML INTEGRITY INJECTOR
// ============================================
function injectIntegrityIntoHtml(htmlPath, hashes) {
    var htmlContent = fs.readFileSync(htmlPath, 'utf-8');
    var errors = [];
    var injected = 0;
    for (var _i = 0, hashes_1 = hashes; _i < hashes_1.length; _i++) {
        var _a = hashes_1[_i], file = _a.file, hash = _a.hash;
        // Skip source maps
        if (file.endsWith('.map') || file.endsWith('.wasm')) {
            continue;
        }
        var fileName = path.basename(file);
        // Pattern to match script tags for this file
        // Examples:
        // <script type="module" crossorigin src="./assets/index-abc123.js"></script>
        // <script type="module" src="/assets/index-abc123.js"></script>
        var patterns = [
            // With crossorigin already present
            new RegExp("(<script[^>]*?crossorigin[^>]*?src=[\"'][^\"']*?".concat(fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "[\"'][^>]*?>)"), 'g'),
            // Without crossorigin
            new RegExp("(<script[^>]*?src=[\"'][^\"']*?".concat(fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "[\"'][^>]*?>)"), 'g'),
        ];
        var matched = false;
        for (var _b = 0, patterns_1 = patterns; _b < patterns_1.length; _b++) {
            var pattern = patterns_1[_b];
            var matches = htmlContent.match(pattern);
            if (matches) {
                var originalTag = matches[1];
                // Check if integrity already exists
                if (originalTag.includes('integrity=')) {
                    // Verify existing integrity matches
                    var existingIntegrityMatch = originalTag.match(/integrity="([^"]+)"/);
                    if (existingIntegrityMatch && existingIntegrityMatch[1] === hash) {
                        console.log("[vite-csp-plugin] SRI already correct for: ".concat(fileName));
                    }
                    else {
                        errors.push("Integrity mismatch for ".concat(fileName));
                    }
                    matched = true;
                    continue;
                }
                // Inject integrity and crossorigin
                var newTag = void 0;
                if (originalTag.includes('crossorigin')) {
                    // Add integrity after crossorigin
                    newTag = originalTag.replace(/(crossorigin=["']anonymous["'])/, "$1 integrity=\"".concat(hash, "\" "));
                }
                else {
                    // Add both crossorigin and integrity
                    newTag = originalTag.replace(/(<script[^>]*?src=["'][^"']*?)(["'][^>]*?>)/, "$1 crossorigin=\"anonymous\" integrity=\"".concat(hash, "\"$2"));
                }
                if (newTag !== originalTag) {
                    htmlContent = htmlContent.replace(originalTag, newTag);
                    console.log("[vite-csp-plugin] Injected SRI for: ".concat(fileName));
                    injected++;
                }
                matched = true;
                break;
            }
        }
        if (!matched && !file.includes('.wasm')) {
            // Try to find script tag with different path formats
            var altPatterns = [
                new RegExp("(<script[^>]*?src=[\"']\\.?/?assets/".concat(fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "[\"'])"), 'g'),
                new RegExp("(<script[^>]*?src=[\"']\\.?/?".concat(fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "[\"'])"), 'g'),
            ];
            for (var _c = 0, altPatterns_1 = altPatterns; _c < altPatterns_1.length; _c++) {
                var pattern = altPatterns_1[_c];
                var matches = htmlContent.match(pattern);
                if (matches) {
                    var originalTag = matches[1];
                    var newTag = originalTag.replace(/(<script[^>]*?src=["'][^"']*?)(["'][^>]*?>)/, "$1 crossorigin=\"anonymous\" integrity=\"".concat(hash, "\"$2"));
                    htmlContent = htmlContent.replace(originalTag, newTag);
                    console.log("[vite-csp-plugin] Injected SRI for: ".concat(fileName, " (alt pattern)"));
                    injected++;
                    break;
                }
            }
        }
    }
    // Write updated HTML
    fs.writeFileSync(htmlPath, htmlContent);
    return { modified: true, injected: injected, errors: errors };
}
function validateSRIInDist(distDir, hashes) {
    var result = {
        valid: true,
        totalScripts: 0,
        scriptsWithIntegrity: 0,
        missingIntegrity: [],
        errors: []
    };
    // Check index.html for integrity attributes
    var indexHtmlPath = path.join(distDir, 'index.html');
    if (fs.existsSync(indexHtmlPath)) {
        var htmlContent = fs.readFileSync(indexHtmlPath, 'utf-8');
        // Count script tags
        var scriptTags = htmlContent.match(/<script[^>]*?src=/g) || [];
        result.totalScripts = scriptTags.length;
        // Count script tags with integrity
        var scriptsWithSRI = htmlContent.match(/<script[^>]*?integrity=/g) || [];
        result.scriptsWithIntegrity = scriptsWithSRI ? scriptsWithSRI.length : 0;
        // Find script tags without integrity
        var scriptTagMatches = htmlContent.matchAll(/<script[^>]*?src=["']([^"']+)["'][^>]*?>/g);
        for (var _i = 0, scriptTagMatches_1 = scriptTagMatches; _i < scriptTagMatches_1.length; _i++) {
            var match = scriptTagMatches_1[_i];
            var src = match[1];
            if (!src.includes('integrity=')) {
                result.missingIntegrity.push(src);
                result.valid = false;
            }
        }
    }
    // Verify hashes match actual file contents
    for (var _a = 0, hashes_2 = hashes; _a < hashes_2.length; _a++) {
        var _b = hashes_2[_a], file = _b.file, hash = _b.hash;
        if (file.endsWith('.js') && !file.endsWith('.map')) {
            var filePath = path.join(distDir, file);
            if (fs.existsSync(filePath)) {
                var actualHash = generateSRIHash(filePath);
                if (actualHash !== hash) {
                    result.errors.push("Hash mismatch for ".concat(file));
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
                    // Inject integrity into HTML
                    var indexHtmlPath = path.join(distDir, 'index.html');
                    if (fs.existsSync(indexHtmlPath)) {
                        var result = injectIntegrityIntoHtml(indexHtmlPath, hashes);
                        if (result.injected > 0) {
                            console.log('[vite-csp-plugin] Injected SRI into ' + result.injected + ' script tags');
                        }
                        if (result.errors.length > 0) {
                            console.error('[vite-csp-plugin] SRI errors:', result.errors);
                        }
                    }
                    // Validate SRI
                    var validation = validateSRIInDist(distDir, hashes);
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
                    }
                    else {
                        console.log('[vite-csp-plugin] ✅ All scripts have valid SRI integrity');
                    }
                    // Write integrity.json
                    var integrityPath = path.join(distDir, 'integrity.json');
                    var integrityData = {
                        generated: new Date().toISOString(),
                        environment: process.env.NODE_ENV || config.mode,
                        buildHash: crypto.createHash('sha256').update(JSON.stringify(hashes)).digest('hex').substring(0, 16),
                        hashes: hashes.reduce(function (acc, _a) {
                            var file = _a.file, hash = _a.hash;
                            acc[file] = hash;
                            return acc;
                        }, {}),
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
                    for (var _i = 0, hashes_3 = hashes; _i < hashes_3.length; _i++) {
                        var _a = hashes_3[_i], file = _a.file, hash = _a.hash;
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
            var headersContent = "# Content Security Policy Header for PrivShare\n# Add this to your Nginx or Apache configuration\n#\n# Nginx:\n# add_header Content-Security-Policy \"".concat(csp, "\" always;\n#\n# Apache (.htaccess):\n# Header set Content-Security-Policy \"").concat(csp, "\"\n#\n# Additional Security Headers:\n# X-Frame-Options: DENY\n# X-Content-Type-Options: nosniff\n# X-XSS-Protection: 1; mode=block\n# Referrer-Policy: strict-origin-when-cross-origin\n# Permissions-Policy: accelerometer=(), camera=(), geolocation=(), microphone=()\n# Strict-Transport-Security: max-age=31536000; includeSubDomains; preload\n");
            fs.writeFileSync(cspHeadersPath, headersContent);
            console.log('[vite-csp-plugin] Generated csp-headers.txt');
        }
    };
}
export default viteCSPPlugin;
