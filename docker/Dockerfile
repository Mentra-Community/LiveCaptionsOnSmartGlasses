FROM oven/bun:1.0

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