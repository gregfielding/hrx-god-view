/**
 * Worker portal: preferred language from Firestore users/{uid}.preferredLanguage.
 * Used to display staff instructions and other worker-facing content in EN/ES.
 */

import { useState, useEffect } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import {
  clearLanguageChangedThisSession,
  hasLanguageChangedThisSession,
  readLocalLanguage,
  writeLocalLanguage,
} from '../utils/languagePreference';

export type WorkerPreferredLanguage = 'en' | 'es';

export function useWorkerPreferredLanguage(): WorkerPreferredLanguage {
  const { user } = useAuth();
  const [lang, setLang] = useState<WorkerPreferredLanguage>(() => readLocalLanguage());

  useEffect(() => {
    if (!user?.uid) {
      setLang(readLocalLanguage());
      return;
    }
    const run = async () => {
      const localLang = readLocalLanguage();
      const localChanged = hasLanguageChangedThisSession();
      const ref = doc(db, 'users', user.uid);

      try {
        const snap = await getDoc(ref);
        const firestoreLangRaw = snap.data()?.preferredLanguage;
        const firestoreLang =
          firestoreLangRaw === 'es' || firestoreLangRaw === 'en'
            ? (firestoreLangRaw as WorkerPreferredLanguage)
            : null;

        if (localChanged) {
          setLang(localLang);
          if (firestoreLang !== localLang) {
            await setDoc(ref, { preferredLanguage: localLang, updatedAt: new Date() }, { merge: true });
          }
          clearLanguageChangedThisSession();
          return;
        }

        if (firestoreLang) {
          setLang(firestoreLang);
          writeLocalLanguage(firestoreLang);
          return;
        }

        setLang(localLang);
        await setDoc(ref, { preferredLanguage: localLang, updatedAt: new Date() }, { merge: true });
      } catch {
        // If Firestore is unavailable, preserve local language and never flip unexpectedly.
        setLang(localLang);
      }
    };
    run();
  }, [user?.uid]);

  return lang;
}
