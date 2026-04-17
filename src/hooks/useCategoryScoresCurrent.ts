import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import type { PrescreenCategoryScoresV1 } from '../types/prescreenCategoryScores';
import { parseCategoryScoresCurrentFromUserDoc } from '../utils/parseRecruiterCategoryScores';

/**
 * Live `users/{uid}.categoryScoresCurrent` (evolving profile scores), or null if missing/invalid.
 */
export function useCategoryScoresCurrent(uid: string | undefined | null): {
  scores: PrescreenCategoryScoresV1 | null;
  userDocReady: boolean;
} {
  const [scores, setScores] = useState<PrescreenCategoryScoresV1 | null>(null);
  const [userDocReady, setUserDocReady] = useState(false);

  useEffect(() => {
    if (!uid) {
      setScores(null);
      setUserDocReady(true);
      return;
    }
    setUserDocReady(false);
    const unsub = onSnapshot(doc(db, 'users', uid), (snap) => {
      setUserDocReady(true);
      if (!snap.exists()) {
        setScores(null);
        return;
      }
      setScores(parseCategoryScoresCurrentFromUserDoc(snap.data()));
    });
    return () => unsub();
  }, [uid]);

  return { scores, userDocReady };
}
