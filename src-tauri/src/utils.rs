//! 通用工具函数模块
//!
//! 提供项目中常用的编码/解码、数据转换等工具函数

/// Base64 解码器
///
/// 支持标准 Base64 字符集，使用查找表实现高效解码
///
/// # Arguments
/// * `input` - Base64 编码的字符串（支持标准 padding）
///
/// # Returns
/// * `Ok(Vec<u8>)` - 解码后的字节数组
/// * `Err(String)` - 解码失败时的错误信息
///
/// # Examples
/// ```
/// let decoded = decode_base64("SGVsbG8gV29ybGQ=").unwrap();
/// assert_eq!(decoded, b"Hello World");
/// ```
pub fn decode_base64(input: &str) -> Result<Vec<u8>, String> {
    const CHARSET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    // Build decode lookup table
    let mut decode_map = [255u8; 256];
    for (i, &ch) in CHARSET.iter().enumerate() {
        decode_map[ch as usize] = i as u8;
    }
    decode_map[b'=' as usize] = 0; // Padding character

    let bytes: Vec<u8> = input.bytes().collect();
    let mut result = Vec::with_capacity((bytes.len() * 3) / 4);

    let mut i = 0;
    while i < bytes.len() {
        let mut buf = 0u32;
        let mut count = 0;

        // Process 4-byte groups
        for j in 0..4 {
            if i + j >= bytes.len() {
                break;
            }
            let ch = bytes[i + j];
            if ch == b'=' {
                break; // Stop at padding
            }
            let val = decode_map[ch as usize];
            if val == 255 {
                return Err(format!("invalid base64 character: '{}'", ch as char));
            }
            buf = (buf << 6) | (val as u32);
            count += 1;
        }

        i += 4;

        // Decode based on actual byte count (handles padding)
        match count {
            4 => {
                result.push((buf >> 16) as u8);
                result.push((buf >> 8) as u8);
                result.push(buf as u8);
            }
            3 => {
                result.push((buf >> 10) as u8);
                result.push((buf >> 2) as u8);
            }
            2 => {
                result.push((buf >> 4) as u8);
            }
            _ => {}
        }
    }

    Ok(result)
}

/// Base64url 解码器
///
/// Base64url 是 URL 安全的 Base64 变体：
/// - 使用 `-` 替代 `+`
/// - 使用 `_` 替代 `/`
/// - 省略 padding `=`
///
/// # Arguments
/// * `base64url` - Base64url 编码的字符串
///
/// # Returns
/// * `Ok(Vec<u8>)` - 解码后的字节数组
/// * `Err(String)` - 解码失败时的错误信息
///
/// # Examples
/// ```
/// let decoded = decode_base64url("SGVsbG8gV29ybGQ").unwrap();
/// assert_eq!(decoded, b"Hello World");
/// ```
pub fn decode_base64url(base64url: &str) -> Result<Vec<u8>, String> {
    // Convert base64url to standard base64
    let mut base64 = base64url.replace('-', "+").replace('_', "/");

    // Add padding if needed
    let padding_len = match base64.len() % 4 {
        0 => 0,
        n => 4 - n,
    };
    for _ in 0..padding_len {
        base64.push('=');
    }

    decode_base64(&base64)
}

/// Base64url 字符串解码为 JSON
///
/// 一站式将 base64url 编码的 JSON 字符串解码为 `serde_json::Value`
///
/// # Arguments
/// * `base64url` - Base64url 编码的 JSON 字符串
///
/// # Returns
/// * `Ok(serde_json::Value)` - 解析后的 JSON 值
/// * `Err(String)` - 解码或解析失败时的错误信息
///
/// # Process Flow
/// 1. Base64url → Base64 (字符替换 + 补 padding)
/// 2. Base64 → bytes (解码)
/// 3. bytes → UTF-8 string (转码)
/// 4. UTF-8 string → JSON (解析)
pub fn decode_base64url_to_json(base64url: &str) -> Result<serde_json::Value, String> {
    // Decode base64url to bytes
    let bytes = decode_base64url(base64url)?;

    // Convert bytes to UTF-8 string
    let json_str = String::from_utf8(bytes).map_err(|e| format!("UTF-8 decode failed: {}", e))?;

    // Parse JSON
    serde_json::from_str(&json_str).map_err(|e| format!("JSON parse failed: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_decode_base64_standard() {
        let input = "SGVsbG8gV29ybGQ=";
        let result = decode_base64(input).unwrap();
        assert_eq!(result, b"Hello World");
    }

    #[test]
    fn test_decode_base64url() {
        // "Hello World" in base64url (no padding)
        let input = "SGVsbG8gV29ybGQ";
        let result = decode_base64url(input).unwrap();
        assert_eq!(result, b"Hello World");
    }

    #[test]
    fn test_decode_base64url_with_special_chars() {
        // Test URL-safe characters (- and _)
        let input = "PDw_Pz8-Pj4"; // "<<????>>" in base64url
        let result = decode_base64url(input).unwrap();
        assert_eq!(result, b"<<????>>");
    }

    #[test]
    fn test_decode_base64url_to_json() {
        // {"test":123} in base64url
        let input = "eyJ0ZXN0IjoxMjN9";
        let result = decode_base64url_to_json(input).unwrap();
        assert_eq!(result, serde_json::json!({"test": 123}));
    }

    #[test]
    fn test_decode_base64_invalid_char() {
        let input = "SGVsbG8g!!!";
        let result = decode_base64(input);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("invalid base64 character"));
    }
}
