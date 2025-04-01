# Live Captions App for AugmentOS

This app provides live captions functionality for AugmentOS smart glasses.

## Development

### Prerequisites

- [Docker](https://www.docker.com/products/docker-desktop)
- [Bun](https://bun.sh/) (optional for local development)

### Setup and Development

#### Docker Development (Recommended)

The quickest way to get started is using Docker:

```bash
# Start the development environment
bun run docker:dev

# Start in detached mode
bun run docker:dev:detach

# View logs
bun run logs

# Stop the container
bun run docker:stop

# Rebuild the container
bun run docker:build
```

##### Using Local SDK (Optional)

If you're working on both the app and SDK simultaneously, the development environment will automatically detect and use a local SDK if it's available in one of these paths:
- ../../../AugmentOS/augmentos_cloud/packages/sdk
- ../../AugmentOS/augmentos_cloud/packages/sdk
- ../../../augmentos_cloud/packages/sdk
- ../../augmentos_cloud/packages/sdk

#### Local Development (Without Docker)

If you prefer to develop without Docker:

```bash
# Install dependencies
bun install

# Start development server
bun run dev
```

### Common Tasks

```bash
# Add a new package
bun run add <package-name>

# Add a dev dependency
bun run add:dev <package-name>

# Remove a package
bun run remove <package-name>

# Run tests
bun run test

# Run linter
bun run lint

# Start a shell in the container
bun run sh
```

## Production

### Building and Running for Production

```bash
# Build the production Docker image
bun run image:build

# Start the production container
bun run prod

# Start in detached mode
bun run prod:detach

# Stop the production container
bun run prod:stop
```

### Container Registry

You can push images to Docker Hub or GitHub Container Registry:

```bash
# Docker Hub
bun run image:release

# GitHub Container Registry
bun run ghcr:release
```

## Project Structure

```
.
├── docker/               # Docker configuration files
│   ├── Dockerfile        # Production Dockerfile
│   ├── Dockerfile.dev    # Development Dockerfile
│   └── docker-compose.*  # Docker Compose files
├── scripts/              # Development and utility scripts
├── src/                  # Source code
│   └── index.ts          # Application entry point
└── tsconfig.json         # TypeScript configuration
```

## License

See the [LICENSE](LICENSE) file for details.