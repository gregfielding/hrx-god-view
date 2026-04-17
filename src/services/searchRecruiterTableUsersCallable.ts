/**
 * Server-side full-collection search for recruiter Users table (All users scope).
 */
import { httpsCallable, type Functions } from 'firebase/functions';

export type SearchRecruiterTableUsersInput = {
  tenantId: string;
  searchQuery: string;
};

export type SearchRecruiterTableUsersResult = {
  userIds: string[];
  scannedDocuments: number;
  batches: number;
  capped: boolean;
};

export function callSearchRecruiterTableUsers(functions: Functions, payload: SearchRecruiterTableUsersInput) {
  return httpsCallable<SearchRecruiterTableUsersInput, SearchRecruiterTableUsersResult>(
    functions,
    'searchRecruiterTableUsers',
  )(payload);
}
