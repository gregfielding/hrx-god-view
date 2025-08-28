# Changelog

All notable changes to the HRX Contracts package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-08-27

### Added
- Initial contracts package setup
- JSON schemas for core entities:
  - `messageThreads.schema.json` - Message thread management
  - `messages.schema.json` - Individual message structure
  - `jobs_board_posts.schema.json` - Job board post management
  - `applications.schema.json` - Job application structure
  - `candidates.schema.json` - Candidate profile management
  - `features.schema.json` - Feature flags and configuration
- Firestore security rules with tenant-scoped access
- Firestore indexes for optimal query performance
- Event bus schema for system-wide event management
- Code generation script for TypeScript types
- Sample fixtures for testing and development
- Comprehensive collection names and status enums

### Features
- **Tenant Isolation**: All schemas include tenantId for multi-tenant support
- **Type Safety**: Generated TypeScript interfaces from JSON schemas
- **Security**: Comprehensive Firestore rules with role-based access
- **Performance**: Optimized indexes for common query patterns
- **Testing**: Sample data fixtures for development and testing
- **Events**: Event bus schema for system integration

### Technical Details
- JSON Schema Draft 2020-12 compliance
- Firestore Rules v2 syntax
- TypeScript interface generation
- Zod validation ready
- Emulator-compatible fixtures
