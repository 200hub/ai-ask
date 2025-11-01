#!/bin/bash

# Local Build Test Script
# Tests the Tauri build process locally before pushing to CI/CD

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}🔨 Starting local build test...${NC}\n"

# Check prerequisites
echo "📋 Checking prerequisites..."

# Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js not found. Please install Node.js 20+${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Node.js: $(node --version)${NC}"

# Check pnpm
if ! command -v pnpm &> /dev/null; then
    echo -e "${RED}❌ pnpm not found. Please install pnpm${NC}"
    exit 1
fi
echo -e "${GREEN}✓ pnpm: $(pnpm --version)${NC}"

# Check Rust
if ! command -v rustc &> /dev/null; then
    echo -e "${RED}❌ Rust not found. Please install Rust${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Rust: $(rustc --version)${NC}"

# Check Cargo
if ! command -v cargo &> /dev/null; then
    echo -e "${RED}❌ Cargo not found. Please install Rust${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Cargo: $(cargo --version)${NC}"

# Install frontend dependencies
echo -e "\n📦 Installing frontend dependencies..."
pnpm install

# Build frontend
echo -e "\n🏗️  Building frontend..."
pnpm build

# Test Tauri build for current platform
echo -e "\n🚀 Testing Tauri build..."

# Detect platform
OS="$(uname -s)"
case "${OS}" in
    Linux*)     PLATFORM=linux;;
    Darwin*)    PLATFORM=macos;;
    MINGW*|MSYS*|CYGWIN*) PLATFORM=windows;;
    *)          PLATFORM="unknown";;
esac

echo -e "${YELLOW}Platform detected: ${PLATFORM}${NC}\n"

# Run build
if pnpm tauri build; then
    echo -e "\n${GREEN}✅ Build successful!${NC}"
    
    # Show build artifacts
    echo -e "\n📦 Build artifacts:"
    case "${PLATFORM}" in
        linux)
            echo "  DEB packages:"
            find src-tauri/target/release/bundle/deb -name "*.deb" 2>/dev/null || echo "    (none)"
            echo "  AppImages:"
            find src-tauri/target/release/bundle/appimage -name "*.AppImage" 2>/dev/null || echo "    (none)"
            ;;
        macos)
            echo "  DMG files:"
            find src-tauri/target/release/bundle/dmg -name "*.dmg" 2>/dev/null || echo "    (none)"
            echo "  App bundles:"
            find src-tauri/target/release/bundle/macos -name "*.app" 2>/dev/null || echo "    (none)"
            ;;
        windows)
            echo "  MSI installers:"
            find src-tauri/target/release/bundle/msi -name "*.msi" 2>/dev/null || echo "    (none)"
            echo "  NSIS installers:"
            find src-tauri/target/release/bundle/nsis -name "*.exe" 2>/dev/null || echo "    (none)"
            ;;
    esac
    
    echo -e "\n${GREEN}✨ Test build completed successfully!${NC}"
    echo -e "${YELLOW}💡 You can now safely push your changes.${NC}\n"
else
    echo -e "\n${RED}❌ Build failed!${NC}"
    echo -e "${YELLOW}Please fix the errors before pushing.${NC}\n"
    exit 1
fi
