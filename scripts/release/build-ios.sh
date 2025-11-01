#!/bin/bash

# iOS Build Script
# Builds iOS IPA with signing

set -e  # Exit on error

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}📱 Building iOS application...${NC}\n"

# Check prerequisites
echo "📋 Checking prerequisites..."

# Check macOS
if [ "$(uname)" != "Darwin" ]; then
    echo -e "${RED}❌ iOS builds require macOS${NC}"
    exit 1
fi

if ! command -v xcodebuild &> /dev/null; then
    echo -e "${RED}❌ Xcode not found. Please install Xcode${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Xcode: $(xcodebuild -version | head -n 1)${NC}"

if ! command -v rustc &> /dev/null; then
    echo -e "${RED}❌ Rust not found${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Rust: $(rustc --version)${NC}"

# Add iOS Rust targets
echo -e "\n📦 Adding iOS Rust targets..."
rustup target add aarch64-apple-ios
rustup target add x86_64-apple-ios

# Install dependencies
echo -e "\n📦 Installing dependencies..."
pnpm install

# Initialize Tauri iOS project (if not already done)
if [ ! -d "src-tauri/gen/apple" ]; then
    echo -e "\n🔧 Initializing Tauri iOS project..."
    pnpm tauri ios init
fi

# Build
echo -e "\n🔨 Building iOS application..."

pnpm tauri ios build --release

echo -e "\n${GREEN}✅ Build complete!${NC}"

# Show outputs
echo -e "\n📦 Build outputs:"
echo "  IPAs:"
find src-tauri/gen/apple/build -name "*.ipa" 2>/dev/null || echo "    (none)"

echo -e "\n${GREEN}✨ iOS build completed successfully!${NC}"
echo -e "${YELLOW}💡 Note: For App Store distribution, you'll need to sign with a distribution certificate${NC}\n"
