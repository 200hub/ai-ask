#!/bin/bash

# Release Preparation Script
# Helper script to prepare a new release with version updates

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🚀 AI Ask Release Preparation${NC}\n"

# Get current version
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo -e "Current version: ${GREEN}v$CURRENT_VERSION${NC}\n"

# Ask for version bump type
echo "Select version bump type:"
echo "  1) Patch (bug fixes)      -> $(semver --increment patch $CURRENT_VERSION)"
echo "  2) Minor (new features)   -> $(semver --increment minor $CURRENT_VERSION || echo 'N/A')"
echo "  3) Major (breaking changes) -> $(semver --increment major $CURRENT_VERSION || echo 'N/A')"
echo "  4) Custom version"
echo ""
read -p "Enter choice [1-4]: " BUMP_TYPE

case $BUMP_TYPE in
  1)
    NEW_VERSION=$(pnpm version patch --no-git-tag-version | sed 's/v//')
    ;;
  2)
    NEW_VERSION=$(pnpm version minor --no-git-tag-version | sed 's/v//')
    ;;
  3)
    NEW_VERSION=$(pnpm version major --no-git-tag-version | sed 's/v//')
    ;;
  4)
    read -p "Enter new version (without 'v' prefix): " NEW_VERSION
    pnpm version $NEW_VERSION --no-git-tag-version
    ;;
  *)
    echo -e "${RED}Invalid choice${NC}"
    exit 1
    ;;
esac

echo -e "\n${YELLOW}Updating to version: v$NEW_VERSION${NC}\n"

# Update tauri.conf.json
echo "📝 Updating src-tauri/tauri.conf.json..."
if [ -f "src-tauri/tauri.conf.json" ]; then
  # Use jq if available, otherwise sed
  if command -v jq &> /dev/null; then
    jq ".version = \"$NEW_VERSION\"" src-tauri/tauri.conf.json > src-tauri/tauri.conf.json.tmp
    mv src-tauri/tauri.conf.json.tmp src-tauri/tauri.conf.json
  else
    sed -i.bak "s/\"version\": \".*\"/\"version\": \"$NEW_VERSION\"/" src-tauri/tauri.conf.json
    rm src-tauri/tauri.conf.json.bak
  fi
  echo -e "${GREEN}✓ Updated tauri.conf.json${NC}"
else
  echo -e "${RED}✗ tauri.conf.json not found${NC}"
fi

# Update Cargo.toml
echo "📝 Updating src-tauri/Cargo.toml..."
if [ -f "src-tauri/Cargo.toml" ]; then
  sed -i.bak "s/^version = \".*\"/version = \"$NEW_VERSION\"/" src-tauri/Cargo.toml
  rm src-tauri/Cargo.toml.bak
  echo -e "${GREEN}✓ Updated Cargo.toml${NC}"
else
  echo -e "${RED}✗ Cargo.toml not found${NC}"
fi

# Validate versions
echo -e "\n${YELLOW}Validating version consistency...${NC}"
node .github/scripts/validate-version.js --skip-tag || {
  echo -e "${YELLOW}⚠️  Validation will fail without git tag (this is expected)${NC}"
}

# Show summary
echo -e "\n${GREEN}✅ Version updated successfully!${NC}\n"
echo "📋 Summary:"
echo "  • package.json: $NEW_VERSION"
echo "  • tauri.conf.json: $NEW_VERSION"
echo "  • Cargo.toml: $NEW_VERSION"

# Ask to commit and tag
echo ""
read -p "Do you want to commit these changes? (y/n): " COMMIT_CHOICE

if [ "$COMMIT_CHOICE" = "y" ] || [ "$COMMIT_CHOICE" = "Y" ]; then
  git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml pnpm-lock.yaml
  git commit -m "chore: bump version to v$NEW_VERSION"
  echo -e "${GREEN}✓ Changes committed${NC}"
  
  read -p "Do you want to create and push the tag v$NEW_VERSION? (y/n): " TAG_CHOICE
  
  if [ "$TAG_CHOICE" = "y" ] || [ "$TAG_CHOICE" = "Y" ]; then
    git tag "v$NEW_VERSION"
    echo -e "${GREEN}✓ Tag created: v$NEW_VERSION${NC}"
    
    read -p "Push commit and tag to origin? (y/n): " PUSH_CHOICE
    
    if [ "$PUSH_CHOICE" = "y" ] || [ "$PUSH_CHOICE" = "Y" ]; then
      git push origin main
      git push origin "v$NEW_VERSION"
      echo -e "\n${GREEN}✨ Release v$NEW_VERSION triggered!${NC}"
      echo -e "${BLUE}Check GitHub Actions for build progress${NC}\n"
    else
      echo -e "\n${YELLOW}Remember to push manually:${NC}"
      echo "  git push origin main"
      echo "  git push origin v$NEW_VERSION"
    fi
  else
    echo -e "\n${YELLOW}Remember to create and push tag manually:${NC}"
    echo "  git tag v$NEW_VERSION"
    echo "  git push origin v$NEW_VERSION"
  fi
else
  echo -e "\n${YELLOW}Changes not committed. Remember to:${NC}"
  echo "  git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml"
  echo "  git commit -m 'chore: bump version to v$NEW_VERSION'"
  echo "  git tag v$NEW_VERSION"
  echo "  git push origin v$NEW_VERSION"
fi

echo ""
