/**
 * WASM Core Library for PrivShare
 * =================================
 * 
 * Zero-Trust Document Redaction - WebAssembly Core
 * 
 * This library provides high-performance image manipulation functions
 * that run entirely in the browser. All processing is local - no data
 * is ever sent to any server.
 * 
 * Memory Management:
 * - Uses wasm-bindgen for efficient Uint8Array passing
 * - Minimizes allocations where possible
 * - Returns Vec<u8> which becomes Uint8Array in JS
 * 
 * Security:
 * - SHA-256 hashing for audit trails
 * - No network access from WASM
 * - All processing is deterministic and local
 */

use wasm_bindgen::prelude::*;
use wasm_bindgen::Clamped;
use serde::{Deserialize, Serialize};
use image::{DynamicImage, ImageBuffer, Rgba, GenericImageView, GenericImage};
use sha2::{Sha256, Digest};
use std::io::Cursor;

// ============================================
// ERROR HANDLING & INITIALIZATION
// ============================================

/// Custom error type for WASM operations
#[derive(Debug)]
pub enum WasmError {
    ImageLoadError(String),
    ImageEncodeError(String),
    InvalidDimensions(String),
    OutOfBounds(String),
    JsonError(String),
}

impl From<WasmError> for JsValue {
    fn from(err: WasmError) -> Self {
        JsValue::from_str(&format!("{:?}", err))
    }
}

/// Initialize the WASM module
/// 
/// MUST be called before using any other functions.
/// Sets up panic hook for debugging in browser console.
/// 
/// # Example (JavaScript)
/// ```js
/// import init from 'wasm-core';
/// await init();
/// ```
#[wasm_bindgen]
pub fn init() {
    // Set up panic hook for better error messages in browser console
    // This allows Rust panic messages to appear in browser DevTools
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
    
    console_log("╔═══════════════════════════════════════════╗");
    console_log("║   PrivShare WASM Core v1.0.0             ║");
    console_log("║   Zero-Trust Document Processing         ║");
    console_log("╚═══════════════════════════════════════════╝");
}

/// Check if WASM module is initialized
#[wasm_bindgen]
pub fn is_initialized() -> bool {
    true
}

// ============================================
// DATA STRUCTURES
// ============================================

/// Represents a detected text region in a document
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextRegion {
    pub text: String,
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    pub confidence: f32,
}

/// Represents a redaction area for JSON input
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RedactionArea {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub page_index: u32,
    #[serde(default = "default_redaction_type")]
    pub redaction_type: String,
}

fn default_redaction_type() -> String {
    "manual".to_string()
}

/// Image metadata returned after processing
#[derive(Debug, Serialize, Deserialize)]
pub struct ImageInfo {
    pub width: u32,
    pub height: u32,
    pub channels: u8,
    pub format: String,
    pub size_bytes: usize,
}

/// Result of OCR processing
#[derive(Debug, Serialize, Deserialize)]
pub struct OcrResult {
    pub regions: Vec<TextRegion>,
    pub processing_time_ms: u64,
}

/// Detected PII match
#[derive(Debug, Serialize, Deserialize)]
pub struct PiiMatch {
    pub text: String,
    pub pii_type: String,
    pub region_index: usize,
    pub confidence: f32,
}

// ============================================
// CORE IMAGE PROCESSING FUNCTIONS
// ============================================

/// Load and process an image from a byte buffer
/// 
/// This function accepts raw image bytes and optional dimensions.
/// It loads the image into memory and returns the processed RGBA buffer.
/// 
/// # Arguments
/// * `buffer` - Raw image bytes (supports PNG, JPEG, TIFF, BMP, WebP)
/// * `width` - Optional expected width (0 = auto-detect from image)
/// * `height` - Optional expected height (0 = auto-detect from image)
/// 
/// # Returns
/// RGBA pixel data as Vec<u8> (4 bytes per pixel: R, G, B, A)
/// 
/// # Memory Efficiency
/// - Uses zero-copy where possible via wasm-bindgen
/// - Returns Vec<u8> which becomes Uint8Array in JS without extra copy
/// 
/// # Example (JavaScript)
/// ```js
/// const fileBuffer = await file.arrayBuffer();
/// const rgba = process_image(new Uint8Array(fileBuffer), 0, 0);
/// // rgba is Uint8Array with RGBA pixel data
/// ```
#[wasm_bindgen]
pub fn process_image(buffer: &[u8], width: u32, height: u32) -> Result<Vec<u8>, JsValue> {
    console_log(&format!("[process_image] Loading image, buffer size: {} bytes", buffer.len()));
    
    // Load image from memory buffer
    let img = image::load_from_memory(buffer)
        .map_err(|e| {
            let msg = format!("[process_image] Failed to decode image: {}", e);
            console_error(&msg);
            JsValue::from_str(&msg)
        })?;
    
    let img_width = img.width();
    let img_height = img.height();
    
    console_log(&format!("[process_image] Decoded image: {}x{} pixels", img_width, img_height));
    
    // Validate dimensions if specified
    if width > 0 && height > 0 {
        if img_width != width || img_height != height {
            return Err(JsValue::from_str(&format!(
                "[process_image] Dimension mismatch: expected {}x{}, got {}x{}",
                width, height, img_width, img_height
            )));
        }
    }
    
    // Convert to RGBA8 for consistent processing
    let rgba_img = img.to_rgba8();
    
    // Return raw pixel data (this becomes Uint8Array in JS)
    let pixel_data = rgba_img.into_raw();
    
    console_log(&format!("[process_image] Returning {} bytes of RGBA data", pixel_data.len()));
    
    Ok(pixel_data)
}

/// Load image and return metadata
/// 
/// # Arguments
/// * `buffer` - Raw image bytes
/// 
/// # Returns
/// JSON string with ImageInfo
#[wasm_bindgen]
pub fn get_image_info(buffer: &[u8]) -> Result<String, JsValue> {
    let img = image::load_from_memory(buffer)
        .map_err(|e| JsValue::from_str(&format!("Failed to decode image: {}", e)))?;
    
    // Detect format from buffer signature
    let format = detect_image_format(buffer);
    
    let info = ImageInfo {
        width: img.width(),
        height: img.height(),
        channels: 4, // Always RGBA after processing
        format,
        size_bytes: buffer.len(),
    };
    
    serde_json::to_string(&info)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize image info: {}", e)))
}

/// Redact (burn) a black rectangle onto image pixels
/// 
/// This function applies an irreversible redaction by setting all pixels
/// in the specified area to solid black (0, 0, 0, 255). This is a "burn"
/// operation - the original pixel data is permanently destroyed.
/// 
/// # Arguments
/// * `buffer` - Raw image bytes (will be loaded and modified)
/// * `x` - X coordinate of redaction rectangle (top-left)
/// * `y` - Y coordinate of redaction rectangle (top-left)
/// * `w` - Width of redaction rectangle
/// * `h` - Height of redaction rectangle
/// 
/// # Returns
/// Modified image as PNG bytes (Vec<u8> -> Uint8Array)
/// 
/// # Security Note
/// This operation is irreversible. The original pixel data is destroyed
/// and cannot be recovered. This ensures true redaction.
/// 
/// # Example (JavaScript)
/// ```js
/// const redacted = redact_area(imageBuffer, 100, 200, 150, 50);
/// // redacted is Uint8Array containing PNG with black rectangle
/// ```
#[wasm_bindgen]
pub fn redact_area(buffer: &[u8], x: u32, y: u32, w: u32, h: u32) -> Result<Vec<u8>, JsValue> {
    console_log(&format!(
        "[redact_area] Applying redaction at ({}, {}) size {}x{}",
        x, y, w, h
    ));
    
    // Load image from buffer
    let mut img = image::load_from_memory(buffer)
        .map_err(|e| {
            let msg = format!("[redact_area] Failed to load image: {}", e);
            console_error(&msg);
            JsValue::from_str(&msg)
        })?;
    
    let img_width = img.width();
    let img_height = img.height();
    
    // Validate bounds
    if x >= img_width || y >= img_height {
        return Err(JsValue::from_str(&format!(
            "[redact_area] Redaction area out of bounds: ({}, {}) outside {}x{}",
            x, y, img_width, img_height
        )));
    }
    
    // Calculate actual redaction bounds (clamp to image size)
    let x_end = (x + w).min(img_width);
    let y_end = (y + h).min(img_height);
    
    console_log(&format!(
        "[redact_area] Burning pixels from ({}, {}) to ({}, {})",
        x, y, x_end, y_end
    ));
    
    // Burn black rectangle - permanently destroy pixel data
    let black = Rgba([0u8, 0u8, 0u8, 255u8]);
    
    for py in y..y_end {
        for px in x..x_end {
            img.put_pixel(px, py, black);
        }
    }
    
    let pixels_burned = (x_end - x) * (y_end - y);
    console_log(&format!("[redact_area] Burned {} pixels", pixels_burned));
    
    // Encode as PNG and return
    encode_image_as_png(&img)
}

/// Apply multiple redactions from JSON
/// 
/// # Arguments
/// * `buffer` - Raw image bytes
/// * `redactions_json` - JSON array of RedactionArea objects
/// 
/// # Returns
/// Modified image as PNG bytes
#[wasm_bindgen]
pub fn apply_redactions(buffer: &[u8], redactions_json: &str) -> Result<Vec<u8>, JsValue> {
    console_log("[apply_redactions] Parsing redactions JSON...");
    
    let redactions: Vec<RedactionArea> = serde_json::from_str(redactions_json)
        .map_err(|e| JsValue::from_str(&format!("Invalid redactions JSON: {}", e)))?;
    
    console_log(&format!("[apply_redactions] Applying {} redactions", redactions.len()));
    
    // Load image once
    let mut img = image::load_from_memory(buffer)
        .map_err(|e| JsValue::from_str(&format!("Failed to load image: {}", e)))?;
    
    let img_width = img.width();
    let img_height = img.height();
    let black = Rgba([0u8, 0u8, 0u8, 255u8]);
    
    let mut total_pixels = 0u64;
    
    for (idx, redaction) in redactions.iter().enumerate() {
        // Validate bounds
        if redaction.x >= img_width || redaction.y >= img_height {
            console_log(&format!(
                "[apply_redactions] Skipping redaction {}: out of bounds",
                idx
            ));
            continue;
        }
        
        let x_end = (redaction.x + redaction.width).min(img_width);
        let y_end = (redaction.y + redaction.height).min(img_height);
        
        // Burn pixels
        for py in redaction.y..y_end {
            for px in redaction.x..x_end {
                img.put_pixel(px, py, black);
            }
        }
        
        total_pixels += (x_end - redaction.x) as u64 * (y_end - redaction.y) as u64;
    }
    
    console_log(&format!("[apply_redactions] Total pixels burned: {}", total_pixels));
    
    encode_image_as_png(&img)
}

// ============================================
// HASHING FUNCTIONS
// ============================================

/// Generate a SHA-256 hash of the provided data
/// 
/// This function computes a cryptographic SHA-256 hash of the input buffer.
/// Used for audit trails - generating fingerprints of original and redacted
/// documents for compliance verification.
/// 
/// # Arguments
/// * `buffer` - Raw bytes to hash
/// 
/// # Returns
/// Hex-encoded SHA-256 hash string (64 characters)
/// 
/// # Example (JavaScript)
/// ```js
/// const hash = get_hash(fileBuffer);
/// console.log(hash); // "e3b0c44298fc1c149afbf4c8996fb924..."
/// ```
#[wasm_bindgen]
pub fn get_hash(buffer: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(buffer);
    let result = hasher.finalize();
    
    // Convert to hex string
    let hex_string = format!("{:x}", result);
    
    console_log(&format!("[get_hash] Computed SHA-256: {}...", &hex_string[..16]));
    
    hex_string
}

/// Generate SHA-256 hash with prefix for audit logging
/// 
/// # Arguments
/// * `buffer` - Raw bytes to hash
/// * `label` - Label for logging (e.g., "original" or "redacted")
/// 
/// # Returns
/// Hex-encoded SHA-256 hash string
#[wasm_bindgen]
pub fn get_hash_with_label(buffer: &[u8], label: &str) -> String {
    let hash = get_hash(buffer);
    console_log(&format!("[audit] {} hash: {}", label, hash));
    hash
}

/// Verify if two buffers have the same hash
/// 
/// # Arguments
/// * `buffer1` - First buffer
/// * `buffer2` - Second buffer
/// 
/// # Returns
/// true if hashes match, false otherwise
#[wasm_bindgen]
pub fn verify_hash_match(buffer1: &[u8], buffer2: &[u8]) -> bool {
    let hash1 = get_hash(buffer1);
    let hash2 = get_hash(buffer2);
    
    let matches = hash1 == hash2;
    console_log(&format!("[verify_hash_match] Hashes match: {}", matches));
    
    matches
}

// ============================================
// IMAGE UTILITY FUNCTIONS
// ============================================

/// Create a blank image with specified dimensions
/// 
/// # Arguments
/// * `width` - Image width in pixels
/// * `height` - Image height in pixels
/// 
/// # Returns
/// RGBA pixel data (all transparent)
#[wasm_bindgen]
pub fn create_blank_image(width: u32, height: u32) -> Vec<u8> {
    console_log(&format!("[create_blank_image] Creating {}x{} blank image", width, height));
    
    // Create transparent RGBA image
    let buffer_size = (width * height * 4) as usize;
    vec![0u8; buffer_size]
}

/// Resize image to new dimensions
/// 
/// # Arguments
/// * `buffer` - Raw image bytes
/// * `new_width` - Target width
/// * `new_height` - Target height
/// 
/// # Returns
/// Resized image as PNG bytes
#[wasm_bindgen]
pub fn resize_image(buffer: &[u8], new_width: u32, new_height: u32) -> Result<Vec<u8>, JsValue> {
    console_log(&format!("[resize_image] Resizing to {}x{}", new_width, new_height));
    
    let img = image::load_from_memory(buffer)
        .map_err(|e| JsValue::from_str(&format!("Failed to load image: {}", e)))?;
    
    // Use nearest neighbor for pixel-perfect scaling (good for documents)
    let resized = img.resize_exact(
        new_width,
        new_height,
        image::imageops::FilterType::Nearest
    );
    
    encode_image_as_png(&resized)
}

/// Convert image to grayscale
/// 
/// # Arguments
/// * `buffer` - Raw image bytes
/// 
/// # Returns
/// Grayscale image as PNG bytes
#[wasm_bindgen]
pub fn to_grayscale(buffer: &[u8]) -> Result<Vec<u8>, JsValue> {
    console_log("[to_grayscale] Converting to grayscale");
    
    let img = image::load_from_memory(buffer)
        .map_err(|e| JsValue::from_str(&format!("Failed to load image: {}", e)))?;
    
    let grayscale = img.to_luma8();
    let rgba: ImageBuffer<Rgba<u8>, Vec<u8>> = ImageBuffer::from_fn(
        grayscale.width(),
        grayscale.height(),
        |x, y| {
            let luma = grayscale.get_pixel(x, y);
            Rgba([luma[0], luma[0], luma[0], 255])
        }
    );
    
    encode_image_as_png(&DynamicImage::ImageRgba8(rgba))
}

/// Get image dimensions without fully decoding
/// 
/// # Arguments
/// * `buffer` - Raw image bytes
/// 
/// # Returns
/// JSON string: {"width": number, "height": number}
#[wasm_bindgen]
pub fn get_dimensions(buffer: &[u8]) -> Result<String, JsValue> {
    let img = image::load_from_memory(buffer)
        .map_err(|e| JsValue::from_str(&format!("Failed to decode image: {}", e)))?;
    
    Ok(serde_json::json!({
        "width": img.width(),
        "height": img.height()
    }).to_string())
}

// ============================================
// PII DETECTION (PLACEHOLDER)
// ============================================

/// Detect PII in text regions
/// 
/// # Arguments
/// * `regions_json` - JSON string containing TextRegion array
/// 
/// # Returns
/// JSON string containing PiiMatch array
#[wasm_bindgen]
pub fn detect_pii(regions_json: &str) -> Result<String, JsValue> {
    let regions: Vec<TextRegion> = serde_json::from_str(regions_json)
        .map_err(|e| JsValue::from_str(&format!("Invalid regions JSON: {}", e)))?;
    
    let mut pii_matches = Vec::new();
    
    for (index, region) in regions.iter().enumerate() {
        // Email detection
        if is_email(&region.text) {
            pii_matches.push(PiiMatch {
                text: region.text.clone(),
                pii_type: "email".to_string(),
                region_index: index,
                confidence: 0.95,
            });
        }
        
        // SSN detection (XXX-XX-XXXX format)
        if is_ssn(&region.text) {
            pii_matches.push(PiiMatch {
                text: region.text.clone(),
                pii_type: "ssn".to_string(),
                region_index: index,
                confidence: 0.90,
            });
        }
        
        // Phone number detection
        if is_phone(&region.text) {
            pii_matches.push(PiiMatch {
                text: region.text.clone(),
                pii_type: "phone".to_string(),
                region_index: index,
                confidence: 0.85,
            });
        }
        
        // Credit card detection
        if is_credit_card(&region.text) {
            pii_matches.push(PiiMatch {
                text: region.text.clone(),
                pii_type: "credit_card".to_string(),
                region_index: index,
                confidence: 0.88,
            });
        }
    }
    
    console_log(&format!("[detect_pii] Found {} PII matches", pii_matches.len()));
    
    serde_json::to_string(&pii_matches)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize PII matches: {}", e)))
}

// ============================================
// VERSION & MODULE INFO
// ============================================

/// Get the version of the WASM module
#[wasm_bindgen]
pub fn get_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Get module information
#[wasm_bindgen]
pub fn get_module_info() -> String {
    serde_json::json!({
        "name": env!("CARGO_PKG_NAME"),
        "version": env!("CARGO_PKG_VERSION"),
        "description": env!("CARGO_PKG_DESCRIPTION"),
        "license": env!("CARGO_PKG_LICENSE"),
    }).to_string()
}

// ============================================
// INTERNAL HELPER FUNCTIONS
// ============================================

/// Encode a DynamicImage as PNG bytes
fn encode_image_as_png(img: &DynamicImage) -> Result<Vec<u8>, JsValue> {
    let mut output = Vec::new();
    
    img.write_to(&mut Cursor::new(&mut output), image::ImageFormat::Png)
        .map_err(|e| {
            let msg = format!("[encode] Failed to encode PNG: {}", e);
            console_error(&msg);
            JsValue::from_str(&msg)
        })?;
    
    console_log(&format!("[encode] Output PNG size: {} bytes", output.len()));
    Ok(output)
}

/// Detect image format from buffer signature (magic bytes)
fn detect_image_format(buffer: &[u8]) -> String {
    if buffer.len() < 8 {
        return "unknown".to_string();
    }
    
    // PNG: 89 50 4E 47
    if buffer[0..4] == [0x89, 0x50, 0x4E, 0x47] {
        return "png".to_string();
    }
    
    // JPEG: FF D8 FF
    if buffer[0..3] == [0xFF, 0xD8, 0xFF] {
        return "jpeg".to_string();
    }
    
    // GIF: 47 49 46
    if buffer[0..3] == [0x47, 0x49, 0x46] {
        return "gif".to_string();
    }
    
    // BMP: 42 4D
    if buffer[0..2] == [0x42, 0x4D] {
        return "bmp".to_string();
    }
    
    // WebP: 52 49 46 46 ... 57 45 42 50
    if buffer.len() >= 12 && &buffer[0..4] == b"RIFF" && &buffer[8..12] == b"WEBP" {
        return "webp".to_string();
    }
    
    // TIFF (little endian): 49 49 2A 00
    // TIFF (big endian): 4D 4D 00 2A
    if (buffer[0..4] == [0x49, 0x49, 0x2A, 0x00]) || 
       (buffer[0..4] == [0x4D, 0x4D, 0x00, 0x2A]) {
        return "tiff".to_string();
    }
    
    "unknown".to_string()
}

/// Check if text matches email pattern
fn is_email(text: &str) -> bool {
    let text = text.trim();
    text.contains('@') && 
    text.contains('.') && 
    text.len() > 5 &&
    text.chars().next() != Some('@') &&
    !text.ends_with('@') &&
    !text.ends_with('.')
}

/// Check if text matches SSN pattern (XXX-XX-XXXX)
fn is_ssn(text: &str) -> bool {
    let text = text.trim();
    if text.len() != 11 {
        return false;
    }
    
    let chars: Vec<char> = text.chars().collect();
    
    // Format: XXX-XX-XXXX
    chars[3] == '-' && 
    chars[6] == '-' &&
    chars[0..3].iter().all(|c| c.is_ascii_digit()) &&
    chars[4..6].iter().all(|c| c.is_ascii_digit()) &&
    chars[7..11].iter().all(|c| c.is_ascii_digit())
}

/// Check if text matches phone number pattern
fn is_phone(text: &str) -> bool {
    let digits: String = text.chars()
        .filter(|c| c.is_ascii_digit())
        .collect();
    
    // Valid phone lengths: 10 (US) or 11 (with country code)
    digits.len() == 10 || digits.len() == 11
}

/// Check if text matches credit card pattern
fn is_credit_card(text: &str) -> bool {
    let digits: String = text.chars()
        .filter(|c| c.is_ascii_digit())
        .collect();
    
    // Credit cards are 13-19 digits
    digits.len() >= 13 && digits.len() <= 19
}

/// Log to browser console (info level)
fn console_log(message: &str) {
    web_sys::console::log_1(&JsValue::from_str(message));
}

/// Log error to browser console
fn console_error(message: &str) {
    web_sys::console::error_1(&JsValue::from_str(message));
}

// ============================================
// UNIT TESTS
// ============================================

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_is_email() {
        assert!(is_email("test@example.com"));
        assert!(is_email("user.name@domain.co.uk"));
        assert!(!is_email("notanemail"));
        assert!(!is_email("@example.com"));
        assert!(!is_email("test@"));
    }
    
    #[test]
    fn test_is_ssn() {
        assert!(is_ssn("123-45-6789"));
        assert!(!is_ssn("123456789"));
        assert!(!is_ssn("12-345-6789"));
        assert!(!is_ssn("abc-de-fghi"));
    }
    
    #[test]
    fn test_is_phone() {
        assert!(is_phone("5551234567"));
        assert!(is_phone("555-123-4567"));
        assert!(is_phone("15551234567"));
        assert!(!is_phone("123"));
    }
    
    #[test]
    fn test_is_credit_card() {
        assert!(is_credit_card("4111111111111111")); // 16 digits
        assert!(is_credit_card("4111-1111-1111-1111"));
        assert!(!is_credit_card("123")); // Too short
    }
    
    #[test]
    fn test_get_hash_consistency() {
        let data = b"test data for hashing";
        let hash1 = get_hash(data);
        let hash2 = get_hash(data);
        
        // Same input should produce same hash
        assert_eq!(hash1, hash2);
        assert_eq!(hash1.len(), 64); // SHA-256 is 64 hex chars
    }
    
    #[test]
    fn test_get_hash_uniqueness() {
        let hash1 = get_hash(b"data one");
        let hash2 = get_hash(b"data two");
        
        // Different inputs should produce different hashes
        assert_ne!(hash1, hash2);
    }
    
    #[test]
    fn test_detect_image_format() {
        // PNG magic bytes
        assert_eq!(detect_image_format(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), "png");
        
        // JPEG magic bytes
        assert_eq!(detect_image_format(&[0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46]), "jpeg");
        
        // GIF magic bytes
        assert_eq!(detect_image_format(&[0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x00]), "gif");
    }
    
    #[test]
    fn test_verify_hash_match() {
        let data = b"same data";
        assert!(verify_hash_match(data, data));
        assert!(!verify_hash_match(data, b"different data"));
    }
}
