/** Keep in sync with `shared/actionItemOwnership.ts`. */

export const ACTION_ITEM_OWNERSHIP_VERSION = 1;

export type ActionItemOwnershipPrimarySource =
  | 'job_order'
  | 'account'
  | 'user_group'
  | 'tenant_default'
  | 'unassigned'
  | 'manual';

export type ActionItemOwnershipHistoryEntry = {
  at: string;
  actorUid: string | 'system';
  action:
    | 'assigned'
    | 'reassigned'
    | 'claimed'
    | 'released'
    | 'rederived_visibility';
  from?: string | null;
  to?: string | null;
  reason?: string;
};

export type ActionItemOwnership = {
  primaryRecruiterId: string | null;
  visibleRecruiterIds: string[];
  primarySource: ActionItemOwnershipPrimarySource;
  history: ActionItemOwnershipHistoryEntry[];
  staleSince?: string;
};

export type ActionItemOwnershipAssociation = {
  recruiterId: string;
  isPrimary?: boolean;
};

export type ResolveOwnershipInput = {
  tenantId: string;
  workerUid: string;
  jobOrder?: {
    id: string;
    assignedRecruiters: string[];
    accountId?: string;
    recruiterAssociations?: ActionItemOwnershipAssociation[];
  };
  account?: {
    id: string;
    recruiterIds: string[];
    recruiterAssociations?: ActionItemOwnershipAssociation[];
  };
  userGroups?: Array<{
    id: string;
    groupManagerIds: string[];
    recruiterAssociations?: ActionItemOwnershipAssociation[];
  }>;
  tenantDefaults?: {
    defaultRecruiterId?: string | null;
    unassignedPoolEnabled?: boolean;
  };
  tieBreakers?: {
    stableSeed?: string;
  };
};

export type ResolveOwnershipResult = {
  primaryRecruiterId: string | null;
  visibleRecruiterIds: string[];
  primarySource: ActionItemOwnershipPrimarySource;
};
