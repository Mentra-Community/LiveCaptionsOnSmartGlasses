FROM oven/bun:latest

WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./

# Install dependencies (including dev dependencies for build)
RUN bun install

# Copy the application code
COPY . .

# Build webview for production
RUN bun run build:webview

# Set production environment
ENV NODE_ENV=production

# Expose the port
EXPOSE 80

# dont' Start the application, the porter.yaml file has cmd to start it.
# CMD ["bun", "src/index.ts"]
