/**
 * Email Draft Auto-Save Utilities
 * 
 * Handles auto-saving email drafts to Firestore
 */

import { doc, setDoc, getDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { debounce } from 'lodash';

export interface EmailDraft {
  id?: string;
  threadId?: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyHtml: string;
  bodyPlain: string;
  attachments?: any[];
  lastSavedAt: Date;
}

const DRAFT_COLLECTION = 'emailDrafts';
const AUTO_SAVE_DELAY = 2000; // 2 seconds

/**
 * Create debounced auto-save function
 */
export function createAutoSave(
  userId: string,
  tenantId: string,
  draftId?: string
): (draft: Partial<EmailDraft>) => Promise<void> {
  const debouncedSave = debounce(async (draft: Partial<EmailDraft>) => {
    try {
      const draftRef = doc(
        db,
        'tenants',
        tenantId,
        'users',
        userId,
        DRAFT_COLLECTION,
        draftId || `draft-${Date.now()}`
      );

      await setDoc(
        draftRef,
        {
          ...draft,
          lastSavedAt: new Date(),
        },
        { merge: true }
      );
    } catch (error) {
      console.error('Error auto-saving draft:', error);
    }
  }, AUTO_SAVE_DELAY);

  return debouncedSave;
}

/**
 * Load draft
 */
export async function loadDraft(
  userId: string,
  tenantId: string,
  draftId: string
): Promise<EmailDraft | null> {
  try {
    const draftRef = doc(
      db,
      'tenants',
      tenantId,
      'users',
      userId,
      DRAFT_COLLECTION,
      draftId
    );

    const draftSnap = await getDoc(draftRef);
    if (draftSnap.exists()) {
      return {
        id: draftSnap.id,
        ...draftSnap.data(),
      } as EmailDraft;
    }
    return null;
  } catch (error) {
    console.error('Error loading draft:', error);
    return null;
  }
}

/**
 * Delete draft
 */
export async function deleteDraft(
  userId: string,
  tenantId: string,
  draftId: string
): Promise<void> {
  try {
    const draftRef = doc(
      db,
      'tenants',
      tenantId,
      'users',
      userId,
      DRAFT_COLLECTION,
      draftId
    );

    await deleteDoc(draftRef);
  } catch (error) {
    console.error('Error deleting draft:', error);
  }
}

