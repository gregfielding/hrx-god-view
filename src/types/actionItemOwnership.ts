/** Client-side re-export of the canonical ownership type. Source of truth: `shared/actionItemOwnership.ts`. */

export type {
  ActionItemOwnership,
  ActionItemOwnershipAssociation,
  ActionItemOwnershipHistoryEntry,
  ActionItemOwnershipPrimarySource,
  ResolveOwnershipInput,
  ResolveOwnershipResult,
} from '../../shared/actionItemOwnership';

export { ACTION_ITEM_OWNERSHIP_VERSION } from '../../shared/actionItemOwnership';
