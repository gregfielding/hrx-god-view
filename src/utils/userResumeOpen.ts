import { getApp } from 'firebase/app';
import { getDownloadURL, getStorage, ref } from 'firebase/storage';

/** Subset of `users.resume` used to open the file the same way as `UserProfileHeader`. */
export type UserResumeForOpen = {
  fileName: string;
  downloadUrl?: string;
  storagePath?: string;
};

/**
 * Returns resume metadata when the user has a named resume and at least one openable URL/path.
 * Aligns with profile header: requires `resume.fileName` plus `downloadUrl`, `fileUrl`, or `storagePath`.
 */
export function pickResumeFromUserDoc(user: Record<string, unknown> | null | undefined): UserResumeForOpen | null {
  if (!user) return null;
  const resume = user.resume as Record<string, unknown> | undefined;
  if (!resume || typeof resume !== 'object') return null;
  const fileName =
    typeof resume.fileName === 'string' && resume.fileName.trim() ? resume.fileName.trim() : null;
  if (!fileName) return null;

  const downloadUrl =
    typeof resume.downloadUrl === 'string' && resume.downloadUrl.trim() ? resume.downloadUrl.trim() : '';
  const fileUrl =
    typeof resume.fileUrl === 'string' && resume.fileUrl.trim() ? resume.fileUrl.trim() : '';
  const storagePath =
    typeof resume.storagePath === 'string' && resume.storagePath.trim() ? resume.storagePath.trim() : '';

  const fromDownloadOrFile = downloadUrl || fileUrl;
  if (fromDownloadOrFile) {
    return { fileName, downloadUrl: fromDownloadOrFile };
  }
  if (storagePath) {
    return { fileName, storagePath };
  }
  return null;
}

/** Same behavior as `UserProfileHeader` `handleResumeClick` (new tab). */
export function openUserResumeInNewTab(resume: UserResumeForOpen): void {
  try {
    if (resume.downloadUrl) {
      window.open(resume.downloadUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    if (resume.storagePath) {
      // Resumes are no longer world-readable (storage.rules 2026-08-25), so
      // the old hand-built ?alt=media URL 403s. Fetch an authed token URL via
      // the SDK; the window opens synchronously so popup blockers stay calm.
      const win = window.open('', '_blank', 'noopener,noreferrer');
      void getDownloadURL(ref(getStorage(getApp()), resume.storagePath))
        .then((url) => {
          if (win) win.location.href = url;
          else window.open(url, '_blank', 'noopener,noreferrer');
        })
        .catch((e) => {
          win?.close();
          console.error('Error opening resume:', e);
        });
    }
  } catch (e) {
    console.error('Error opening resume:', e);
  }
}
