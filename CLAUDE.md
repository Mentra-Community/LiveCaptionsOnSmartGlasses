# AugmentApps Live-Captions Development Guide

## Commands
- **Build**: `bun run build` - Compiles TypeScript
- **Dev**: `bun run dev` - Watches files in development
- **Deploy**: `bun run deploy` - Builds and starts the app
- **Lint**: `npx eslint 'src/**/*.ts'` - Run ESLint
- **Format**: `npx prettier --write 'src/**/*.ts'` - Format code

## Code Style Guidelines
- **TypeScript**: Strict mode enabled, ES2020 target
- **Formatting**: 2-space tabs, trailing commas
- **Modules**: CommonJS module system
- **Imports**: Group imports by external/internal libraries
- **Naming**: camelCase for variables/functions, PascalCase for classes/interfaces
- **Types**: Always define return types and parameter types
- **Error Handling**: Use try/catch with typed errors
- **Comments**: Use JSDoc for functions and classes

## Dependencies
- Main: @augmentos/sdk, express, ws
- Dev: TypeScript, ESLint with TypeScript plugin, Prettier