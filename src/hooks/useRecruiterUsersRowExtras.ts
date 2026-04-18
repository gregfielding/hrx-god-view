import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { db } from '../firebase';

export type RecruiterUserLatestNotePreview = {
  content: string;
  timestamp: Date | null;
  authorName?: string;
};

export type RecruiterUserLatestInterviewPreview = {
  /** Recruiter / submitter display name when present */
  createdByName?: string;
};

function stableIdsKey(userIds: readonly string[]): string {
  return [...new Set(userIds.map((id) => String(id || '').trim()).filter(Boolean))].sort().join('|');
}

async function fetchLatestNote(uid: string): Promise<RecruiterUserLatestNotePreview | null> {
  try {
    const notesRef = collection(db, 'users', uid, 'notes');
    const q = query(notesRef, orderBy('timestamp', 'desc'), limit(1));
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const d = snap.docs[0].data() as Record<string, unknown>;
    const content = typeof d.content === 'string' ? d.content.trim() : '';
    if (!content) return null;
    const ts = d.timestamp as { toDate?: () => Date } | undefined;
    const timestamp = ts && typeof ts.toDate === 'function' ? ts.toDate() : null;
    const authorName =
      typeof d.authorName === 'string'
        ? d.authorName.trim()
        : typeof d.submittedBy === 'string'
          ? d.submittedBy.trim()
          : undefined;
    return { content, timestamp, authorName };
  } catch {
    return null;
  }
}

async function fetchLatestInterviewMeta(uid: string): Promise<RecruiterUserLatestInterviewPreview | null> {
  try {
    const coll = collection(db, 'users', uid, 'interviews');
    let snap;
    try {
      snap = await getDocs(query(coll, orderBy('createdAt', 'desc'), limit(1)));
    } catch {
      snap = await getDocs(query(coll, orderBy('timestamp', 'desc'), limit(1)));
    }
    if (snap.empty) return null;
    const d = snap.docs[0].data() as Record<string, unknown>;
    const kind = String(d.interviewKind || '').trim();
    if (kind === 'worker_ai_prescreen') {
      return { createdByName: 'System' };
    }
    const createdByName =
      typeof d.createdByName === 'string'
        ? d.createdByName.trim()
        : typeof d.submittedBy === 'string'
          ? d.submittedBy.trim()
          : undefined;
    return { createdByName };
  } catch {
    return null;
  }
}

/**
 * Latest note + latest interview submitter name for recruiter /users/all rows (paginated batch only).
 */
export function useRecruiterUsersRowExtras(userIds: readonly string[]): {
  latestNoteByUserId: Map<string, RecruiterUserLatestNotePreview>;
  latestInterviewByUserId: Map<string, RecruiterUserLatestInterviewPreview>;
  loading: boolean;
} {
  const key = useMemo(() => stableIdsKey(userIds), [userIds]);
  const ids = useMemo(() => (key ? key.split('|') : []), [key]);

  const [latestNoteByUserId, setLatestNoteByUserId] = useState<Map<string, RecruiterUserLatestNotePreview>>(new Map());
  const [latestInterviewByUserId, setLatestInterviewByUserId] = useState<Map<string, RecruiterUserLatestInterviewPreview>>(
    new Map(),
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (ids.length === 0) {
      setLatestNoteByUserId(new Map());
      setLatestInterviewByUserId(new Map());
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    void (async () => {
      const noteMap = new Map<string, RecruiterUserLatestNotePreview>();
      const intMap = new Map<string, RecruiterUserLatestInterviewPreview>();

      await Promise.all(
        ids.map(async (uid) => {
          const [note, interview] = await Promise.all([fetchLatestNote(uid), fetchLatestInterviewMeta(uid)]);
          if (cancelled) return;
          if (note) noteMap.set(uid, note);
          if (interview) intMap.set(uid, interview);
        }),
      );

      if (!cancelled) {
        setLatestNoteByUserId(noteMap);
        setLatestInterviewByUserId(intMap);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [key]);

  return { latestNoteByUserId, latestInterviewByUserId, loading };
}
