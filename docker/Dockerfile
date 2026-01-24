FROM oven/bun:latest

WORKDIR /app

# Copy package files first (for better layer caching)
COPY package.json bun.lock* ./

# Copy the bundled display-utils package
COPY packages/display-utils/package.json packages/display-utils/tsconfig.json ./packages/display-utils/
COPY packages/display-utils/src ./packages/display-utils/src

# Install dependencies (including dev dependencies for build)
RUN bun install

# Build the bundled display-utils package
WORKDIR /app/packages/display-utils
RUN bunx tsc -p tsconfig.json

# Return to app directory
WORKDIR /app

# Re-install to refresh bun's module resolution after display-utils is built
# This ensures bun can properly resolve @mentra/display-utils with its dist/ folder
RUN bun install

# Copy the rest of the application code
COPY . .

# Build webview for production
RUN bun run build:webview

# Set production environment
ENV NODE_ENV=production

# Expose the port
EXPOSE 80

# dont' Start the application, the porter.yaml file has cmd to start it.
# CMD ["bun", "src/index.ts"]
