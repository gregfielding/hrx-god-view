/**
 * Cascading Order Data — barrel export.
 *
 * Consumers should import from `shared/cascade` (or
 * `src/shared/cascade` on the CRA side) rather than reaching into
 * the individual modules so we can rearrange internals without
 * breaking call sites.
 *
 * Mirrored to `src/shared/cascade/index.ts`.
 */

export type {
  AncestorLevel,
  CascadeFieldSpec,
  CascadeStrategy,
  ContributionKind,
  DayOfWeek,
  EditableLevel,
  ItemIdentity,
  LevelType,
  ProvenanceEntry,
  ResolvedCascadeValue,
  ShiftTemplate,
} from './types';

export {
  isCascadeStrategy,
  isEditableLevel,
  isItemIdentity,
  isLevelType,
} from './types';

export { CASCADE_REGISTRY } from './registry';
export type { CascadingFieldKey } from './registry';
