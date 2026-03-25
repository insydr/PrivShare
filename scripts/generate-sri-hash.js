#!/usr/bin/env node
/**
 * SRI Hash Generation Script
 * Generates SHA-384 hashes for .wasm and .js bundles
 * Output: JSON file with hashes for build-time integrity
 * Also supports watching for file changes in development
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Configuration
const clientPath = path.resolve(__dirname, '../packages/client');
const distPath = path.join(clientPath, 'dist');
const assetsDir = path.join(distPath, 'assets');
const buildDir = clientPath;
const indexHtmlPath = path.join(distPath, 'index.html');

// Colors for console output
const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m\x1b[0m',
    green: '\x1b[32m\x1b[0m',
    yellow: '\x1b[33m\x1b[0m',
    cyan: '\x1b[36m\x1b[0m',
    blue: '\x1b[34m\x1b[0m',
    magenta: '\x1b[35m\x1b[0m',
    gray: '\x1b[37m\x1b[0m',
};

/**
 * Generate SHA-384 hash for a file
 * @param {string} filePath - File path
 * @returns {Promise<string>} SHA-384 hash in base64 format with sha384- prefix
 */
function generateSRIHash(filePath) {
    return new Promise((resolve, reject) => {
        const algorithm = 'sha384';
        const hash = crypto.createHash(algorithm);
        const stream = fs.createReadStream(filePath);
        
        stream.on('data', (data) => {
            hash.update(data);
        });
        
        stream.on('end', () => {
            const digest = hash.digest('base64');
            resolve(`sha384-${digest}`);
        });
        
        stream.on('error', (err) => {
            reject(err);
        });
    });
}

/**
 * Recursively find files with specific extensions
 * @param {string} dir - Directory to search
 * @param {Object} options - Options for matching
 * @returns {Promise<string[]>} Array of file paths
 */
async function findFiles(dir, options) {
    const { withFileTypes, withFileNames } = options;
    
    return new Promise((resolve, reject) => {
        fs.readdir(dir, { withFileTypes: true, recursive: true }, (err, files) => {
            if (err) {
                reject(err);
                return;
            }
            
            const matchedFiles = [];
            
            for (const file of files) {
                const filePath = path.join(dir, file.name);
                
                if (file.isDirectory()) {
                    // Recurse into subdirectory
                    const subFiles = await findFiles(filePath, options).catch(() => []);
                    matchedFiles.push(...subFiles);
                } else if (file.isFile()) {
                    // Check file extension
                    const ext = path.extname(file.name).toLowerCase();
                    const name = file.name;
                    
                    if (withFileTypes.includes(ext) || (withFileNames && withFileNames(name))) {
                        matchedFiles.push(filePath);
                    }
                }
            }
            
            resolve(matchedFiles);
        });
    });
}

/**
 * Generate SRI hashes for all files in a directory
 * @param {string} dir - Directory path
 * @returns {Promise<Object>} Object with file paths as keys and hashes as values
 */
async function generateSRIHashes(dir) {
    const hashes = {};
    
    // Find all .js and .wasm files
    const files = await findFiles(dir, { 
        withFileTypes: ['.js', '.wasm'],
        withFileNames: (name) => name.endsWith('.js') || name.endsWith('.wasm')
    }).catch(() => []);
    
    for (const file of files) {
        const relativePath = path.relative(dir, file).replace(/\\/g, '/');
        const integrity = await generateSRIHash(file);
        hashes[relativePath] = integrity;
        console.log(`${colors.cyan}Hashed: ${relativePath} -> ${integrity.substring(0, 30)}...`);
    }
    
    return hashes;
}

/**
 * Update HTML file with SRI integrity attributes
 * @param {string} htmlPath - Path to HTML file
 * @param {Object} hashes - Object with integrity values
 */
function updateHtmlWithIntegrity(htmlPath, hashes) {
    let htmlContent = fs.readFileSync(htmlPath, 'utf-8');
    
    // Track replacements made
    const replacements = [];
    
    // Update script tags with integrity
    Object.entries(hashes).forEach(([file, integrity]) => {
        // Skip source maps
        if (file.endsWith('.map')) {
            return;
        }
        
        // For bundled JS files in assets directory
        const fileName = path.basename(file);
        
        // Match script tags - handle various formats
        const scriptPatterns = [
            // Standard pattern: <script type="module" src="./assets/index-abc123.js"></script>
            new RegExp(`(<script[^>]*?src=["'][^"']*?assets/${fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*?>)`, 'g'),
            // Without ./ prefix
            new RegExp(`(<script[^>]*?src=["']assets/${fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*?>)`, 'g'),
        ];
        
        for (const pattern of scriptPatterns) {
            const match = htmlContent.match(pattern);
            if (match) {
                const originalTag = match[1];
                
                // Check if integrity already exists
                if (originalTag.includes('integrity=')) {
                    console.log(`${colors.yellow}Integrity already exists for: ${fileName}`);
                    continue;
                }
                
                // Add integrity and crossorigin attributes
                const newTag = originalTag.replace(
                    /(<script[^>]*?src=["'][^"']*?)(["'][^>]*?>)/,
                    `$1" integrity="${integrity}" crossorigin="anonymous"$2`
                );
                
                if (newTag !== originalTag) {
                    htmlContent = htmlContent.replace(originalTag, newTag);
                    console.log(`${colors.green}Updated script tag for: ${fileName}`);
                }
            }
        }
    });
    
    // Write updated HTML
    fs.writeFileSync(htmlPath, htmlContent);
    console.log(`${colors.green}Updated ${htmlPath} with integrity attributes`);
}

/**
 * Generate CSP configuration content based on environment
 */
function generateCSP() {
    const productionDomain = process.env.PRODUCTION_DOMAIN || 'api.privshare.app';
    const wsDomain = process.env.WS_DOMAIN || `wss://${productionDomain}`;
    
    return {
        development: [
            "default-src 'self';",
            "script-src 'self' 'wasm-unsafe-eval' blob:;",
            "worker-src 'self' blob:;",
            "style-src 'self' 'unsafe-inline';",
            "img-src 'self' data: blob:;",
            "font-src 'self';",
            "connect-src 'self' ws://localhost:3001;",
            "object-src 'none';",
            "base-uri 'self';"
        ].join(' '),
        production: [
            "default-src 'self';",
            "script-src 'self' 'wasm-unsafe-eval';",
            "worker-src 'self' blob:;",
            "style-src 'self' 'unsafe-inline';",
            "img-src 'self' data: blob:;",
            "font-src 'self';",
            `connect-src 'self' https://${productionDomain} ${wsDomain};`,
            "object-src 'none';",
            "frame-src 'none';",
            "base-uri 'self';",
            "form-action 'self';",
            "frame-ancestors 'none';",
            "upgrade-insecure-requests;"
        ].join(' ')
    };
}

/**
 * Generate Nginx configuration
 */
function generateNginxConfig() {
    const csp = generateCSP();
    
    return `# Nginx Security Headers Configuration for PrivShare
# Place this in /etc/nginx/conf.d/privshare-security.conf
# or include in your main nginx.conf server block

server {
    listen 443 ssl http2;
    server_name privshare.app www.privshare.app;
    
    # Enable HSTS (HTTP Strict Transport Security)
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
    
    # Prevent MIME type sniffing
    add_header X-Content-Type-Options "nosniff" always;
    
    # Enable XSS Protection
    add_header X-XSS-Protection "1; mode=block" always;
    
    # Prevent clickjacking
    add_header X-Frame-Options "DENY" always;
    
    # Referrer Policy
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    
    # Permissions Policy (Feature Policy)
    add_header Permissions-Policy "accelerometer=(), camera=(), geolocation=(), microphone=()" always;
    
    # Content Security Policy - Production
    add_header Content-Security-Policy "${csp.production}" always;
    
    # Disable client caching of sensitive pages
    add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate" always;
    add_header Pragma "no-cache" always;
    
    root /var/www/privshare;
    
    # Security headers for static assets
    location ~*\\.(js|css|wasm)$ {
        add_header Cache-Control "public, max-age=31536000, immutable";
        add_header X-Content-Type-Options "nosniff";
    }
    
    # Security headers for HTML files
    location ~*\\.html$ {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        add_header X-Content-Type-Options "nosniff";
    }
    
    # Disable access to hidden files
    location ~*(^\\\\.|\\\\.) {
        deny all;
    }
}`;
}

/**
 * Run the script
 */
async function run() {
    console.log(`${colors.cyan}\\n==============================================`);
    console.log(`${colors.cyan}SRI Hash Generation for PrivShare`);
    console.log(`${colors.cyan}==============================================`);
    console.log(`${colors.gray}Build directory: ${buildDir}`);
    console.log(`${colors.gray}Dist directory: ${distPath}`);
    console.log(`${colors.gray}Assets directory: ${assetsDir}`);
    console.log(`${colors.gray}Index.html: ${indexHtmlPath}`);
    console.log('');
    
    // Check if dist exists
    if (!fs.existsSync(distPath)) {
        console.log(`${colors.red}Dist directory not found. Please run 'npm run build' first.`);
        console.log(`${colors.yellow}Running build...`);
        
        // Run build
        const { execSync } = require('child_process');
        try {
            execSync('npm run build', { cwd: buildDir, stdio: 'inherit' });
        } catch (err) {
            console.log(`${colors.red}Build failed`);
            process.exit(1);
        }
    }
    
    // Check again
    if (!fs.existsSync(distPath)) {
        console.log(`${colors.red}Dist directory not found after build.`);
        process.exit(1);
    }
    
    // Generate hashes
    console.log(`${colors.cyan}Generating SRI hashes...`);
    const hashes = await generateSRIHashes(distPath);
    
    if (Object.keys(hashes).length === 0) {
        console.log(`${colors.yellow}No .js or .wasm files found in dist directory`);
    } else {
        // Update HTML with integrity
        if (fs.existsSync(indexHtmlPath)) {
            updateHtmlWithIntegrity(indexHtmlPath, hashes);
        }
        
        // Write integrity.json
        const integrityJson = {
            generated: new Date().toISOString(),
            environment: process.env.NODE_ENV || 'development',
            hashes,
            csp: generateCSP()
        };
        
        const outputPath = path.join(assetsDir, 'integrity.json');
        fs.writeFileSync(outputPath, JSON.stringify(integrityJson, null, 2));
        console.log(`${colors.green}Integrity data written to ${outputPath}`);
        
        // Generate Nginx config
        const nginxConfig = generateNginxConfig();
        const nginxPath = path.join(distPath, 'nginx-security.conf');
        fs.writeFileSync(nginxPath, nginxConfig);
        console.log(`${colors.green}Nginx config written to ${nginxPath}`);
    }
    
    console.log(`${colors.green}\\n✅ SRI hash generation complete!`);
    console.log(`${colors.gray}\\nRun "npm run build:tri" to generate hashes before deployment`);
}

// Run
run().catch(console.error);
