/**
 * Wrapper for the `listTenantWorkerDirectory` callable. Returns the full
 * tenant worker directory (~1 MB for an 8k-worker tenant) in one shot;
 * the client caches it in IndexedDB with stale-while-revalidate.
 */
import { httpsCallable, type Functions } from 'firebase/functions';

export interface TenantWorkerDirectoryEntry {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  skills?: string[];
}

export interface ListTenantWorkerDirectoryInput {
  tenantId: string;
}

export interface ListTenantWorkerDirectoryResult {
  workers: TenantWorkerDirectoryEntry[];
  count: number;
  scannedDocuments: number;
  batches: number;
  fetchedAt: string;
}

export function callListTenantWorkerDirectory(
  functions: Functions,
  payload: ListTenantWorkerDirectoryInput,
) {
  return httpsCallable<ListTenantWorkerDirectoryInput, ListTenantWorkerDirectoryResult>(
    functions,
    'listTenantWorkerDirectory',
  )(payload);
}
