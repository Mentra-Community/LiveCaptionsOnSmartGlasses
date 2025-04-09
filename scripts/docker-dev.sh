#!/bin/bash
set -e

# Colors for better output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Setting up Docker development environment...${NC}"

# Define the possible SDK location patterns
POSSIBLE_SDK_PATHS=(
  "../../../AugmentOS/augmentos_cloud/packages/sdk"  # Current path used
  "../../AugmentOS/augmentos_cloud/packages/sdk"     # For different folder structure
  "../../../augmentos_cloud/packages/sdk"            # Alternative structure
  "../../augmentos_cloud/packages/sdk"               # Yet another alternative
)

SDK_FOUND=false
SDK_PATH=""

# Check if any SDK path exists
for PATH_PATTERN in "${POSSIBLE_SDK_PATHS[@]}"; do
  FULL_PATH=$(realpath --relative-to=. "$PATH_PATTERN" 2>/dev/null || echo "$PATH_PATTERN")
  
  if [ -d "$FULL_PATH" ] && [ -f "$FULL_PATH/package.json" ]; then
    echo -e "${GREEN}Found SDK at: $FULL_PATH${NC}"
    SDK_FOUND=true
    SDK_PATH=$(realpath "$FULL_PATH")
    break
  fi
done

# Export SDK path if found
if [ "$SDK_FOUND" = true ]; then
  echo -e "${GREEN}Using local SDK for Docker development at: $SDK_PATH${NC}"
  export SDK_PATH
else
  echo -e "${YELLOW}No local SDK found. Docker will use the published version.${NC}"
fi

# Run docker-compose
echo "Starting Docker container..."
docker compose -f docker/docker-compose.dev.yml -p dev up "$@"