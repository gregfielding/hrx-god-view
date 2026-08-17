# shared mirror

> The repo keeps two copies of the shared/ tree because CRA's ModuleScopePlugin blocks ../shared imports from src/ — any edit to one must be mirrored to the other in the same commit

Two real copies of shared types must be kept **byte-for-byte identical**:

- **`shared/`** at repo root — the canonical location.
- **`src/shared/`** — frontend's mirror.
- **`functions/src/shared`** is a **symlink** to `../../shared` (the repo-root location). So edits to `shared/` automatically propagate to `functions/src/shared/` — they're the same files.

**Why:** CRA's `ModuleScopePlugin` blocks imports outside `src/`, so the frontend can't `import { x } from '../shared/x'`. Functions can reach the repo-root `shared/` via the symlink. Frontend gets its own copy under `src/shared/`. The two real copies must stay synchronized; the functions copy is free for nothing via the symlink.

**How to apply:**
- After editing `shared/foo.ts`, also write the same content to `src/shared/foo.ts` (or vice versa) before committing. Functions side is taken care of automatically by the symlink.
- For new files, create both `shared/X` and `src/shared/X` in the same commit.
- For renames (`git mv`), do both sides in the same commit so history is preserved on both paths.
- **Functions code imports from shared via the symlink path**: `import {...} from '../shared/...'` or `'../../shared/...'` (relative to file's location under `functions/src/`). Do NOT import via repo-root paths like `'../../../../shared/...'` — that goes outside `functions/src/` rootDir and fails `tsc` with TS6059, even though the file content is identical (TS canonicalizes symlinks before the rootDir check). Burned by this in Slice 1 of the Indeed Flex work.
- The codebase has a `check-cascade-mirror.sh` script for some subtrees that enforces the byte-identity.
- Don't try to "consolidate" by deleting one copy — the structural CRA reason still applies. A future migration off CRA could fix this.
