#!/bin/bash
set -e

# Colors for better output
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Setting up Live-Captions development environment...${NC}"

# Check if local SDK is available
if [ -d "/app/node_modules/@augmentos/sdk" ] && [ -f "/app/node_modules/@augmentos/sdk/package.json" ]; then
  echo -e "${YELLOW}Local SDK found. Using local version...${NC}"
  # Local SDK will be mounted via volume
else
  echo -e "${YELLOW}Local SDK not found. Using published version...${NC}"
fi

# Install dependencies
echo "Installing dependencies..."
bun install

echo -e "${GREEN}✅ Setup complete!${NC}"
echo -e "${YELLOW}To start development:${NC}"
echo "  bun run dev        # Local development"
echo "  bun run docker:dev # Docker development"