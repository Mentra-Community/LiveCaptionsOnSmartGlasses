FROM oven/bun:latest

WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./

# Install dependencies (including dev dependencies for build)
RUN bun install

# Copy the application code
COPY . .

# Expose the port
EXPOSE 80
