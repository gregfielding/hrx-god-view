/**
 * Worker portal: preferred language from Firestore users/{uid}.preferredLanguage.
 * Used to display staff instructions and other worker-facing content in EN/ES.
 */

import { useState, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';

export type WorkerPreferredLanguage = 'en' | 'es';

export function useWorkerPreferredLanguage(): WorkerPreferredLanguage {
  const { user } = useAuth();
  const [lang, setLang] = useState<WorkerPreferredLanguage>('en');

  useEffect(() => {
    if (!user?.uid) {
      setLang('en');
      return;
    }
    const ref = doc(db, 'users', user.uid);
    getDoc(ref).then((snap) => {
      const l = snap.data()?.preferredLanguage;
      if (l === 'es' || l === 'en') setLang(l);
    }).catch(() => {});
  }, [user?.uid]);

  return lang;
}
