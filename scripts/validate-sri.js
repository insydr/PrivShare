#!/usr/bin/env node
/**
 * SRI Validation Script
 * =====================
 * 
 * Validates that SRI (Subresource Integrity) hashes are correctly
 * injected into the built HTML files and that all scripts have
 * valid integrity attributes.
 * 
 * This script is designed to run as part of CI/CD pipelines to
 * ensure SRI is properly configured before deployment.
 * 
 * Usage:
 *   node scripts/validate-sri.js [--fix] [--strict]
 * 
 * Options:
 *   --fix    Automatically fix missing integrity attributes
 *   --strict Exit with error code if validation fails
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Configuration
const clientPath = path.resolve(__dirname, '../packages/client');
const distPath = path.join(clientPath, 'dist');
const indexHtmlPath = path.join(distPath, 'index.html');
const integrityJsonPath = path.join(distPath, 'integrity.json');

// Parse command line arguments
const args = process.argv.slice(2);
const shouldFix = args.includes('--fix');
const isStrict = args.includes('--strict');

// Colors for console output
const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    gray: '\x1b[90m',
};

/**
 * Generate SHA-384 hash for a file
 */
function generateSRIHash(filePath) {
    const content = fs.readFileSync(filePath);
    const hash = crypto.createHash('sha384').update(content).digest('base64');
    return `sha384-${hash}`;
}

/**
 * Find all JS files in dist
 */
function findJsFiles(dir) {
    const files = [];
    
    function traverse(currentDir) {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);
            
            if (entry.isDirectory()) {
                traverse(fullPath);
            } else if (entry.isFile() && entry.name.endsWith('.js') && !entry.name.endsWith('.map')) {
                files.push(fullPath);
            }
        }
    }
    
    traverse(dir);
    return files;
}

/**
 * Validation result type
 */
/**
 * @typedef {Object} ValidationResult
 * @property {boolean} valid - Whether validation passed
 * @property {number} totalScripts - Total number of script tags
 * @property {number} scriptsWithIntegrity - Number of scripts with integrity
 * @property {string[]} missingIntegrity - Scripts missing integrity
 * @property {string[]} mismatchedIntegrity - Scripts with wrong integrity
 * @property {string[]} errors - Validation errors
 */

/**
 * Validate SRI in dist folder
 */
function validateSRI() {
    console.log(`\n${colors.cyan}==============================================`);
    console.log(`${colors.cyan}SRI Validation for PrivShare`);
    console.log(`${colors.cyan}==============================================`);
    console.log(`${colors.gray}Dist directory: ${distPath}`);
    console.log('');
    
    const result = {
        valid: true,
        totalScripts: 0,
        scriptsWithIntegrity: 0,
        missingIntegrity: [],
        mismatchedIntegrity: [],
        errors: [],
        warnings: [],
    };
    
    // Check if dist exists
    if (!fs.existsSync(distPath)) {
        console.log(`${colors.red}✗ Dist directory not found. Please run 'npm run build' first.`);
        result.valid = false;
        result.errors.push('Dist directory not found');
        return result;
    }
    
    // Check if index.html exists
    if (!fs.existsSync(indexHtmlPath)) {
        console.log(`${colors.red}✗ index.html not found in dist directory`);
        result.valid = false;
        result.errors.push('index.html not found');
        return result;
    }
    
    // Read index.html
    let htmlContent = fs.readFileSync(indexHtmlPath, 'utf-8');
    
    // Find all script tags
    const scriptTagRegex = /<script[^>]*?src=["']([^"']+\.js)["'][^>]*>/g;
    const scriptTags = htmlContent.match(scriptTagRegex) || [];
    
    result.totalScripts = scriptTags.length;
    console.log(`${colors.blue}Found ${result.totalScripts} script tags`);
    
    // Generate expected hashes for all JS files
    const jsFiles = findJsFiles(distPath);
    const expectedHashes = {};
    
    for (const file of jsFiles) {
        const fileName = path.basename(file);
        expectedHashes[fileName] = generateSRIHash(file);
    }
    
    console.log(`${colors.blue}Generated ${Object.keys(expectedHashes).length} SRI hashes for JS files`);
    
    // Check each script tag
    for (const tag of scriptTags) {
        const srcMatch = tag.match(/src=["']([^"']+)["']/);
        if (!srcMatch) continue;
        
        const src = srcMatch[1];
        const fileName = path.basename(src);
        
        // Check if integrity exists
        const integrityMatch = tag.match(/integrity=["'](sha384-[^"']+)["']/);
        
        if (!integrityMatch) {
            console.log(`${colors.yellow}⚠ Missing integrity for: ${fileName}`);
            result.missingIntegrity.push(fileName);
            result.valid = false;
            
            // Fix if requested
            if (shouldFix) {
                const expectedHash = expectedHashes[fileName];
                if (expectedHash) {
                    const crossoriginAttr = tag.includes('crossorigin=') ? '' : ' crossorigin="anonymous"';
                    const newTag = tag.replace(
                        /(<script[^>]*?src=["'][^"']+["'])/,
                        `$1${crossoriginAttr} integrity="${expectedHash}"`
                    );
                    htmlContent = htmlContent.replace(tag, newTag);
                    console.log(`${colors.green}  ✓ Fixed integrity for: ${fileName}`);
                }
            }
        } else {
            const actualIntegrity = integrityMatch[1];
            const expectedHash = expectedHashes[fileName];
            
            if (expectedHash && actualIntegrity !== expectedHash) {
                console.log(`${colors.red}✗ Integrity mismatch for: ${fileName}`);
                console.log(`  Expected: ${expectedHash.substring(0, 40)}...`);
                console.log(`  Actual:   ${actualIntegrity.substring(0, 40)}...`);
                result.mismatchedIntegrity.push(fileName);
                result.valid = false;
                
                // Fix if requested
                if (shouldFix) {
                    const newTag = tag.replace(
                        /integrity=["']sha384-[^"']+["']/,
                        `integrity="${expectedHash}"`
                    );
                    htmlContent = htmlContent.replace(tag, newTag);
                    console.log(`${colors.green}  ✓ Fixed integrity for: ${fileName}`);
                }
            } else {
                console.log(`${colors.green}✓ Valid integrity for: ${fileName}`);
                result.scriptsWithIntegrity++;
            }
        }
    }
    
    // Check for crossorigin attribute
    const scriptsWithoutCrossorigin = scriptTags.filter(tag => 
        tag.includes('integrity=') && !tag.includes('crossorigin=')
    );
    
    if (scriptsWithoutCrossorigin.length > 0) {
        console.log(`${colors.yellow}⚠ Found ${scriptsWithoutCrossorigin.length} scripts with integrity but no crossorigin`);
        result.warnings.push('Some scripts have integrity but no crossorigin attribute');
        
        if (shouldFix) {
            for (const tag of scriptsWithoutCrossorigin) {
                const newTag = tag.replace(/(<script[^>]*?)(integrity=)/, '$1crossorigin="anonymous" $2');
                htmlContent = htmlContent.replace(tag, newTag);
            }
            console.log(`${colors.green}  ✓ Added crossorigin attributes`);
        }
    }
    
    // Write fixed HTML if changes were made
    if (shouldFix && (result.missingIntegrity.length > 0 || result.mismatchedIntegrity.length > 0)) {
        fs.writeFileSync(indexHtmlPath, htmlContent);
        console.log(`${colors.green}✓ Updated index.html with fixed integrity attributes`);
    }
    
    // Update integrity.json if it exists
    if (fs.existsSync(integrityJsonPath) && shouldFix) {
        const integrityData = JSON.parse(fs.readFileSync(integrityJsonPath, 'utf-8'));
        integrityData.hashes = expectedHashes;
        integrityData.validation = {
            totalScripts: result.totalScripts,
            scriptsWithIntegrity: result.scriptsWithIntegrity,
            valid: result.valid,
            lastValidated: new Date().toISOString(),
        };
        fs.writeFileSync(integrityJsonPath, JSON.stringify(integrityData, null, 2));
        console.log(`${colors.green}✓ Updated integrity.json`);
    }
    
    return result;
}

/**
 * Main function
 */
function main() {
    const result = validateSRI();
    
    console.log(`\n${colors.cyan}==============================================`);
    console.log(`${colors.cyan}SRI Validation Summary`);
    console.log(`${colors.cyan}==============================================`);
    console.log(`Total scripts:         ${result.totalScripts}`);
    console.log(`Scripts with SRI:      ${result.scriptsWithIntegrity}`);
    console.log(`Missing integrity:     ${result.missingIntegrity.length}`);
    console.log(`Mismatched integrity:  ${result.mismatchedIntegrity.length}`);
    console.log(`Errors:                ${result.errors.length}`);
    
    if (result.valid) {
        console.log(`\n${colors.green}✅ SRI validation passed!`);
        console.log(`${colors.green}All scripts have valid integrity attributes.`);
        process.exit(0);
    } else {
        console.log(`\n${colors.red}✗ SRI validation failed!`);
        
        if (result.missingIntegrity.length > 0) {
            console.log(`${colors.yellow}Missing integrity for: ${result.missingIntegrity.join(', ')}`);
        }
        
        if (result.mismatchedIntegrity.length > 0) {
            console.log(`${colors.yellow}Mismatched integrity for: ${result.mismatchedIntegrity.join(', ')}`);
        }
        
        if (shouldFix) {
            console.log(`${colors.green}Issues were automatically fixed.`);
            process.exit(0);
        } else {
            console.log(`${colors.gray}Run with --fix to automatically fix issues.`);
            
            if (isStrict) {
                process.exit(1);
            }
        }
    }
}

// Run
main();
