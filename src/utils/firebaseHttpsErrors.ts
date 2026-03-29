/**
 * Human-readable message from Firebase Callable / HTTPS errors (browser SDK).
 */
export function formatFirebaseHttpsError(e: unknown): string {
  if (e && typeof e === 'object') {
    const o = e as {
      message?: string;
      code?: string;
      details?: unknown;
      customData?: { message?: string; existingCaseId?: string };
    };
    const detailsObj =
      o.details && typeof o.details === 'object' && o.details !== null
        ? (o.details as { existingCaseId?: string; message?: string })
        : null;
    const existingCaseId =
      (detailsObj?.existingCaseId && String(detailsObj.existingCaseId)) ||
      (o.customData?.existingCaseId && String(o.customData.existingCaseId)) ||
      '';
    const isDuplicateEverify =
      o.message === 'EVERIFY_DUPLICATE_CASE' ||
      (typeof o.message === 'string' && o.message.includes('DUPLICATE_CASE')) ||
      (typeof o.code === 'string' && o.code.includes('already-exists'));
    if (isDuplicateEverify) {
      return existingCaseId
        ? `An E-Verify case already exists for this employment (case ${existingCaseId}). Use Refresh on the compliance panel to see it, or resolve the existing case before starting another.`
        : 'An E-Verify case already exists for this employment. Use Refresh on the compliance panel, or resolve the existing case before starting another.';
    }
    const nested =
      o.details && typeof o.details === 'object' && o.details !== null && 'message' in o.details
        ? String((o.details as { message?: string }).message || '')
        : '';
    if (nested.trim()) return nested.trim();
    const custom = o.customData && typeof o.customData.message === 'string' ? o.customData.message.trim() : '';
    if (custom) return custom;
    if (typeof o.message === 'string' && o.message.trim()) {
      const msg = o.message.trim();
      // Unhandled server throws become functions/internal with useless "INTERNAL" text.
      if (msg === 'INTERNAL' && typeof o.code === 'string' && o.code.includes('internal')) {
        return 'Server error (internal). Check Cloud Functions logs for everifyCreateCase or redeploy with the latest error handling.';
      }
      return msg;
    }
    if (typeof o.code === 'string' && o.code.includes('permission')) {
      return 'Permission denied. Your account may not have access for this tenant, or the cloud function needs to be redeployed.';
    }
  }
  if (e instanceof Error && e.message) return e.message;
  return 'Request failed';
}
