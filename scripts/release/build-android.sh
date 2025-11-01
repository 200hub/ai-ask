#!/bin/bash

# Android Build Script
# Builds Android APK/AAB with signing

set -e  # Exit on error

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}📱 Building Android application...${NC}\n"

# Check prerequisites
echo "📋 Checking prerequisites..."

if ! command -v java &> /dev/null; then
    echo -e "${RED}❌ Java not found. Please install JDK 17+${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Java: $(java -version 2>&1 | head -n 1)${NC}"

if ! command -v rustc &> /dev/null; then
    echo -e "${RED}❌ Rust not found${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Rust: $(rustc --version)${NC}"

# Check Android SDK
if [ -z "$ANDROID_HOME" ] && [ -z "$ANDROID_SDK_ROOT" ]; then
    echo -e "${RED}❌ Android SDK not found. Set ANDROID_HOME or ANDROID_SDK_ROOT${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Android SDK: ${ANDROID_HOME:-$ANDROID_SDK_ROOT}${NC}"

# Add Android Rust targets
echo -e "\n📦 Adding Android Rust targets..."
rustup target add aarch64-linux-android
rustup target add armv7-linux-androideabi

# Install dependencies
echo -e "\n📦 Installing dependencies..."
pnpm install

# Initialize Tauri Android project (if not already done)
if [ ! -d "src-tauri/gen/android" ]; then
    echo -e "\n🔧 Initializing Tauri Android project..."
    pnpm tauri android init
fi

# Build
echo -e "\n🔨 Building Android application..."

if [ -n "$KEYSTORE_PATH" ]; then
    echo -e "${YELLOW}Using keystore: $KEYSTORE_PATH${NC}"
    export TAURI_SIGNING_PRIVATE_KEY="$KEYSTORE_PATH"
    export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$KEYSTORE_PASSWORD"
fi

pnpm tauri android build --release

echo -e "\n${GREEN}✅ Build complete!${NC}"

# Show outputs
echo -e "\n📦 Build outputs:"
echo "  APKs:"
find src-tauri/gen/android/app/build/outputs/apk -name "*.apk" 2>/dev/null || echo "    (none)"
echo "  AABs:"
find src-tauri/gen/android/app/build/outputs/bundle -name "*.aab" 2>/dev/null || echo "    (none)"

echo -e "\n${GREEN}✨ Android build completed successfully!${NC}\n"
