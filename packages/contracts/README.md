# HRX Contracts Package

A single source of truth for schemas, rules, indexes, fixtures, events, and codegen so Web and Flutter share the same backend contract without copy/paste.

## 🎯 Overview

This package provides:
- **JSON Schemas** - Single source of truth for data structures
- **Firestore Rules** - Security rules for all collections
- **Firestore Indexes** - Performance optimization indexes
- **TypeScript Types** - Auto-generated from schemas
- **Event Bus Schema** - System-wide event management
- **Fixtures** - Sample data for testing and development

## 📁 Structure

```
packages/contracts/
├── firestore/
│   ├── schemas/           # JSON Schemas (truth)
│   │   ├── candidates.schema.json
│   │   ├── applications.schema.json
│   │   ├── jobs_board_posts.schema.json
│   │   ├── messageThreads.schema.json
│   │   ├── messages.schema.json
│   │   └── features.schema.json
│   ├── rules/
│   │   └── firestore.rules
│   └── indexes/
│       └── firestore.indexes.json
├── events/
│   └── bus.schema.json
├── fixtures/              # Sample data
│   ├── tenants.json
│   ├── candidates.json
│   └── jobs_board_posts.json
├── codegen/
│   └── ts/               # Generated TypeScript types
└── scripts/
    └── gen.ts            # Code generation orchestrator
```

## 🚀 Quick Start

### 1. Generate Types

```bash
npm run generate
```

This generates TypeScript interfaces from JSON schemas in `codegen/ts/`.

### 2. Use in Web App

```bash
# In your web app
npm install ../packages/contracts
```

```typescript
import type { Candidate, Application, JobsBoardPost } from '@hrx/contracts/codegen/ts';
import { COLLECTIONS, CANDIDATE_STATUSES } from '@hrx/contracts/codegen/ts';

// Use generated types
const candidate: Candidate = {
  tenantId: 'tenant_1',
  firstName: 'John',
  lastName: 'Doe',
  email: 'john@example.com',
  // ... other required fields
};
```

### 3. Use in Flutter App

```bash
# In your Flutter app (when ready)
# Copy schemas and generate Dart models
```

## 📋 Schemas

### Core Entities

- **`candidates.schema.json`** - Candidate profiles and management
- **`applications.schema.json`** - Job applications and workflow
- **`jobs_board_posts.schema.json`** - Public job postings
- **`messageThreads.schema.json`** - Chat thread management
- **`messages.schema.json`** - Individual messages
- **`features.schema.json`** - Feature flags and configuration

### Key Features

- **Tenant Isolation**: All schemas include `tenantId` for multi-tenant support
- **Validation**: Comprehensive field validation and constraints
- **Enums**: Type-safe status and enum values
- **Timestamps**: Consistent timestamp handling
- **Metadata**: Extensible metadata fields

## 🔒 Security Rules

Firestore rules enforce:
- **Tenant Isolation**: Users can only access their tenant's data
- **Role-Based Access**: Different permissions for different roles
- **Public Access**: Controlled public access for job boards
- **HRX Admin**: Special privileges for HRX administrators

## 📊 Indexes

Optimized indexes for common query patterns:
- Tenant-scoped queries
- Status-based filtering
- Time-based sorting
- Multi-field combinations

## 🎯 Events

Event bus schema for system-wide integration:
- **Event Envelope**: Standard event structure
- **Deduplication**: Prevent double processing
- **Metadata**: Rich event context
- **Source Tracking**: Identify event origin

## 🧪 Testing

### Fixtures

Sample data for development and testing:
- **Tenants**: Test tenant configurations
- **Candidates**: Sample candidate profiles
- **Job Posts**: Example job board posts
- **Applications**: Sample applications

### Emulator Setup

```bash
# Start emulator with fixtures
firebase emulators:start --import=packages/contracts/fixtures --export-on-exit
```

## 🔄 Versioning

- **Semantic Versioning**: Follows semver.org
- **Changelog**: Documented in CHANGELOG.md
- **Breaking Changes**: Require major version bump
- **Migration Notes**: Documented for breaking changes

## 📝 Development

### Adding New Schemas

1. Create `firestore/schemas/newEntity.schema.json`
2. Add to `scripts/gen.ts` INPUTS array
3. Run `npm run generate`
4. Update `codegen/ts/index.d.ts`
5. Add fixtures in `fixtures/newEntity.json`
6. Update Firestore rules and indexes
7. Bump version and update changelog

### Schema Guidelines

- Use descriptive field names
- Include comprehensive descriptions
- Set appropriate defaults
- Use enums for constrained values
- Include validation rules
- Consider backward compatibility

## 🤝 Integration

### Web App Integration

```typescript
// Typed Firestore helpers
import { collection, doc } from 'firebase/firestore';
import type { Candidate } from '@hrx/contracts/codegen/ts';
import { COLLECTIONS } from '@hrx/contracts/codegen/ts';

export const candidatesCol = (tenantId: string) =>
  collection(db, COLLECTIONS.CANDIDATES) as any as FirebaseFirestore.CollectionReference<Candidate>;
```

### Flutter App Integration

```dart
// When ready, generate Dart models from schemas
// Use same JSON schemas for consistency
```

## 🚨 Important Notes

- **No Magic Strings**: Always import collection names and types from contracts
- **Validate at Edges**: Use Zod validation before writes
- **Tenant All Things**: Every document includes tenantId
- **Idempotent Events**: Include dedupeKey on bus events
- **Logging**: Write key transitions to audit logs

## 📞 Support

For questions or issues:
1. Check the changelog for recent changes
2. Review the schema documentation
3. Test with emulator fixtures
4. Contact the development team

---

**Version**: 0.1.0  
**Last Updated**: 2025-08-27
