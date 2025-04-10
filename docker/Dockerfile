FROM oven/bun:latest

# Install build dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./

# Install dependencies (including dev dependencies for build)
RUN bun install

# Copy the application code
COPY . .

# Build the application
RUN bun run build

# Expose the port
EXPOSE 80

# Start the application
CMD ["bun", "start"]