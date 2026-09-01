/**
 * Firestore access for the cumulative prescreen answer bank (`users/{uid}/prescreen/answerBank`).
 * Policy + delta math live in `../shared/prescreenAnswerBank`; this file is the admin-SDK glue.
 */
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import {
  PRESCREEN_BANK_COLLECTION,
  PRESCREEN_BANK_DOC_ID,
  PRESCREEN_BANK_VERSION,
  parsePrescreenBankDocAnswers,
  prescreenBankCategoryForQuestionId,
  type PrescreenBankEntryLite,
} from '../shared/prescreenAnswerBank';
import { PRESCREEN_OPENING_MULTI_SELECT_KEYS } from './prescreenOpeningKeys';
import type { WorkerAiPrescreenAnswers } from './scoreWorkerAiPrescreen';

const MULTI_SELECT_ANSWER_KEYS = new Set<string>(['work_confidence', ...PRESCREEN_OPENING_MULTI_SELECT_KEYS]);

export function prescreenAnswerBankRef(
  db: admin.firestore.Firestore,
  uid: string,
): admin.firestore.DocumentReference {
  return db
    .collection('users')
    .doc(uid)
    .collection(PRESCREEN_BANK_COLLECTION)
    .doc(PRESCREEN_BANK_DOC_ID);
}

/** Read the bank as ms-based entries; `{}` when absent/unreadable. */
export async function readPrescreenAnswerBank(
  db: admin.firestore.Firestore,
  uid: string,
): Promise<Record<string, PrescreenBankEntryLite>> {
  try {
    const snap = await prescreenAnswerBankRef(db, uid).get();
    if (!snap.exists) return {};
    return parsePrescreenBankDocAnswers(snap.data());
  } catch (e) {
    logger.warn('prescreenAnswerBank.read_failed', {
      uid,
      message: e instanceof Error ? e.message : String(e),
    });
    return {};
  }
}

/**
 * Upsert bank entries for the questions the worker actually answered in this submission.
 * Carried rows are untouched so their original `answeredAt` keeps driving staleness.
 */
export async function writePrescreenAnswerBankFromSubmission(args: {
  db: admin.firestore.Firestore;
  uid: string;
  interviewId: string;
  applicationId: string | null;
  /** Ids of stored question rows answered this session (source === 'asked'). */
  askedQuestionIds: string[];
  answers: WorkerAiPrescreenAnswers;
  dynamicAnswers: Record<string, string>;
}): Promise<void> {
  const { db, uid, interviewId, applicationId, askedQuestionIds, answers, dynamicAnswers } = args;

  const now = admin.firestore.FieldValue.serverTimestamp();
  const entries: Record<string, Record<string, unknown>> = {};
  for (const id of askedQuestionIds) {
    let value: string | string[];
    if (id.startsWith('dyn_')) {
      value = String(dynamicAnswers[id] ?? '').trim();
    } else if (MULTI_SELECT_ANSWER_KEYS.has(id)) {
      const arr = (answers as Record<string, unknown>)[id];
      value = Array.isArray(arr) ? arr.map((x) => String(x).trim()).filter(Boolean) : [];
    } else {
      value = String((answers as Record<string, unknown>)[id] ?? '').trim();
    }
    if (Array.isArray(value) ? value.length === 0 : value === '') continue;
    entries[id] = {
      answer: value,
      answeredAt: now,
      sourceInterviewId: interviewId,
      applicationId: applicationId ?? null,
      category: prescreenBankCategoryForQuestionId(id),
    };
  }
  if (Object.keys(entries).length === 0) return;

  await prescreenAnswerBankRef(db, uid).set(
    {
      version: PRESCREEN_BANK_VERSION,
      answers: entries,
      updatedAt: now,
    },
    { merge: true },
  );
}
