import type { Timestamp } from 'firebase/firestore';

/** Mirrors `functions/src/integrations/accusource/catalogNormalize.ts` — client read model. */
export interface AccusourceCatalogPackage {
  id: string;
  name: string;
  isActive?: boolean;
  fee?: number;
  serviceIds: string[];
  services: Array<{ id: string; name: string; type?: string }>;
}

export interface AccusourceCatalogService {
  id: string;
  name: string;
  type?: string;
}

/** Doc: `integrations_accusource/catalog` */
export interface AccusourceCatalogDocument {
  packages?: AccusourceCatalogPackage[];
  services?: AccusourceCatalogService[];
  syncStatus?: 'ok' | 'error' | 'pending' | string;
  lastSyncedAt?: Timestamp | null;
  lastError?: string | null;
  providerEnvironment?: string;
  companyCount?: number;
  syncedByUid?: string;
  updatedAt?: Timestamp | null;
}
