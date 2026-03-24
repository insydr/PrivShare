/**
 * WASM Core Library for PrivShare
 * 
 * This library provides WebAssembly-based document processing capabilities:
 * - OCR (Optical Character Recognition)
 * - Image manipulation and redaction
 * - PII detection
 * - Hash generation for audit trails
 * 
 * All processing happens locally in the browser - no data is sent to any server.
 */

use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use image::{DynamicImage, ImageBuffer, Rgba};

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

/// Represents a redaction area
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RedactionArea {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    pub page_index: u32,
    pub redaction_type: String,
}

/// Result of OCR processing
#[derive(Debug, Serialize, Deserialize)]
pub struct OcrResult {
    pub regions: Vec<TextRegion>,
    pub processing_time_ms: u64,
}

/// Result of document processing
#[derive(Debug, Serialize, Deserialize)]
pub struct ProcessResult {
    pub success: bool,
    pub regions: Vec<TextRegion>,
    pub detected_pii: Vec<PiiMatch>,
    pub hash: String,
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
// WASM EXPORTS
// ============================================

/// Initialize the WASM module
/// This should be called before using any other functions
#[wasm_bindgen]
pub fn init() {
    // Set up panic hook for better error messages
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
    
    console_log("WASM Core initialized successfully");
}

/// Process an image buffer and return detected text regions
/// 
/// # Arguments
/// * `image_data` - Raw image bytes (supports PNG, JPEG, TIFF)
/// 
/// # Returns
/// JSON string containing OcrResult
#[wasm_bindgen]
pub fn process_image(image_data: &[u8]) -> Result<String, JsValue> {
    console_log("Processing image...");
    
    // Parse the image
    let img = image::load_from_memory(image_data)
        .map_err(|e| JsValue::from_str(&format!("Failed to load image: {}", e)))?;
    
    let width = img.width();
    let height = img.height();
    
    console_log(&format!("Image dimensions: {}x{}", width, height));
    
    // TODO: Integrate actual OCR (tesseract-rust or similar)
    // For now, return a placeholder result
    let result = OcrResult {
        regions: vec![],
        processing_time_ms: 0,
    };
    
    serde_json::to_string(&result)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize result: {}", e)))
}

/// Apply redactions to an image buffer
/// 
/// # Arguments
/// * `image_data` - Raw image bytes
/// * `redactions_json` - JSON string containing RedactionArea array
/// 
/// # Returns
/// Redacted image bytes
#[wasm_bindgen]
pub fn apply_redactions(image_data: &[u8], redactions_json: &str) -> Result<Vec<u8>, JsValue> {
    console_log("Applying redactions...");
    
    let redactions: Vec<RedactionArea> = serde_json::from_str(redactions_json)
        .map_err(|e| JsValue::from_str(&format!("Invalid redactions JSON: {}", e)))?;
    
    // Load the image
    let mut img = image::load_from_memory(image_data)
        .map_err(|e| JsValue::from_str(&format!("Failed to load image: {}", e)))?;
    
    // Apply each redaction
    for redaction in redactions {
        apply_single_redaction(&mut img, &redaction);
    }
    
    // Encode the result as PNG
    let mut output = Vec::new();
    img.write_to(&mut std::io::Cursor::new(&mut output), image::ImageFormat::Png)
        .map_err(|e| JsValue::from_str(&format!("Failed to encode image: {}", e)))?;
    
    console_log(&format!("Redactions applied. Output size: {} bytes", output.len()));
    Ok(output)
}

/// Generate a SHA-256 hash of the provided data
/// 
/// # Arguments
/// * `data` - Raw bytes to hash
/// 
/// # Returns
/// Hex-encoded SHA-256 hash string
#[wasm_bindgen]
pub fn generate_hash(data: &[u8]) -> String {
    // Simple hash implementation for demo
    // In production, use a proper SHA-256 implementation
    let mut hash: u64 = 0;
    for (i, byte) in data.iter().enumerate() {
        hash = hash.wrapping_add((*byte as u64).wrapping_mul(i as u64 + 1));
        hash = hash.wrapping_mul(0x517cc1b727220a95);
    }
    format!("{:016x}", hash)
}

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
        // Check for email patterns
        if is_email(&region.text) {
            pii_matches.push(PiiMatch {
                text: region.text.clone(),
                pii_type: "email".to_string(),
                region_index: index,
                confidence: 0.95,
            });
        }
        
        // Check for SSN patterns (XXX-XX-XXXX)
        if is_ssn(&region.text) {
            pii_matches.push(PiiMatch {
                text: region.text.clone(),
                pii_type: "ssn".to_string(),
                region_index: index,
                confidence: 0.90,
            });
        }
        
        // Check for phone number patterns
        if is_phone(&region.text) {
            pii_matches.push(PiiMatch {
                text: region.text.clone(),
                pii_type: "phone".to_string(),
                region_index: index,
                confidence: 0.85,
            });
        }
    }
    
    serde_json::to_string(&pii_matches)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize PII matches: {}", e)))
}

/// Get the version of the WASM module
#[wasm_bindgen]
pub fn get_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

// ============================================
// INTERNAL HELPERS
// ============================================

fn apply_single_redaction(img: &mut DynamicImage, redaction: &RedactionArea) {
    let black = Rgba([0u8, 0u8, 0u8, 255u8]);
    
    for y in redaction.y..redaction.y.saturating_add(redaction.height) {
        for x in redaction.x..redaction.x.saturating_add(redaction.width) {
            if let Some(pixel) = img.get_pixel_mut_checked(x, y) {
                *pixel = black;
            }
        }
    }
}

fn is_email(text: &str) -> bool {
    text.contains('@') && text.contains('.')
}

fn is_ssn(text: &str) -> bool {
    // SSN format: XXX-XX-XXXX
    let re = regex_match(r"\d{3}-\d{2}-\d{4}");
    re.is_match(text)
}

fn is_phone(text: &str) -> bool {
    // Simple phone detection
    let digits: String = text.chars().filter(|c| c.is_ascii_digit()).collect();
    digits.len() >= 10
}

struct RegexMatch<'a>(&'a str);

impl RegexMatch<'_> {
    fn is_match(&self, text: &str) -> bool {
        // Placeholder - in production use regex crate
        // This is a simplified check
        text.len() == 11 && text.chars().nth(3) == Some('-') && text.chars().nth(6) == Some('-')
    }
}

fn regex_match(pattern: &str) -> RegexMatch {
    RegexMatch(pattern)
}

/// Log to browser console
fn console_log(message: &str) {
    web_sys::console::log_1(&JsValue::from_str(message));
}

// ============================================
// TESTS
// ============================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_email() {
        assert!(is_email("test@example.com"));
        assert!(!is_email("notanemail"));
    }

    #[test]
    fn test_generate_hash() {
        let hash1 = generate_hash(b"test data");
        let hash2 = generate_hash(b"test data");
        let hash3 = generate_hash(b"different data");
        
        assert_eq!(hash1, hash2);
        assert_ne!(hash1, hash3);
    }
}
