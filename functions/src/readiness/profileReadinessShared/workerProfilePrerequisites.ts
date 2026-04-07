export function userDocHasStoredResume(userDoc: Record<string, unknown> | null | undefined): boolean {
  if (!userDoc || typeof userDoc !== 'object') return false;
  const resumeObj = (userDoc.resume || {}) as Record<string, unknown>;
  return Boolean(
    resumeObj.downloadUrl ||
      resumeObj.fileName ||
      resumeObj.storagePath ||
      resumeObj.fileUrl ||
      userDoc.resumeStoragePath ||
      userDoc.resumeUrl
  );
}

export function userDocHasProfilePhoto(
  userDoc: Record<string, unknown> | null | undefined,
  authAvatarUrl?: string | null
): boolean {
  const photo = String(
    (userDoc?.workerProfile as Record<string, unknown> | undefined)?.photoUrl ||
      userDoc?.avatar ||
      authAvatarUrl ||
      ''
  ).trim();
  return photo.length > 0;
}

export function userDocHasCompleteWorkAuthorization(userDoc: Record<string, unknown> | null | undefined): boolean {
  if (!userDoc || typeof userDoc !== 'object') return false;
  const att = (userDoc.workEligibilityAttestation || {}) as Record<string, unknown>;
  const hasAuth =
    typeof att.authorizedToWorkUS === 'boolean' || typeof userDoc.workEligibility === 'boolean';
  const hasSponsorship =
    typeof att.requireSponsorship === 'boolean' || typeof userDoc.requireSponsorship === 'boolean';
  return Boolean(hasAuth && hasSponsorship);
}
