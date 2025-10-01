Fields (Phase 1)

- FieldTypes.ts: shared types
- registry.ts: minimal single source of truth for labels/types/options and SCHEMA_VERSION
- validators.ts: names for validators (optional in Phase 1)

Consumers should read metadata from the registry rather than hardcoding.

