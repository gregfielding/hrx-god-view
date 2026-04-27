/**
 * Gen2 Cloud Functions default memory is 256 MiB. Firestore triggers that load full
 * user/application documents (or cold-start with a large bundle) often OOM at 256 MiB.
 * Use this for new document triggers unless the handler is trivial or measured at 256 MiB.
 */
export const DEFAULT_FIRESTORE_TRIGGER_MEMORY = '512MiB' as const;
