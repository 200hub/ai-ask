//! 通用编码工具，使用标准 base64 库，不维护第二套解码算法。
use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};

pub fn decode_base64(input: &str) -> Result<Vec<u8>, String> {
    STANDARD.decode(input).map_err(|error| error.to_string())
}

pub fn decode_base64url(input: &str) -> Result<Vec<u8>, String> {
    URL_SAFE_NO_PAD
        .decode(input)
        .map_err(|error| error.to_string())
}

pub fn decode_base64url_to_json(input: &str) -> Result<serde_json::Value, String> {
    serde_json::from_slice(&decode_base64url(input)?).map_err(|error| error.to_string())
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
        assert_eq!(result, b"<<???>>>");
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
        assert!(!result.unwrap_err().is_empty());
    }
}
