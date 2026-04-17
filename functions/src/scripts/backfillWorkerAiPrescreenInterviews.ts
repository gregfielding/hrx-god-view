/**
 * One-time rescore for stored worker AI prescreen interviews after compliance semantics fix.
 *
 * Does **not** use filtered Firestore queries on `interviews` (no `where` / no `collectionGroup` on interviews):
 * reads subcollections with `.get()` and filters `interviewKind === 'worker_ai_prescreen'` in memory so admin runs
 * do not depend on interview indexes.
 *
 * Usage (from repo root, after `cd functions && npm run build`):
 *   node lib/scripts/backfillWorkerAiPrescreenInterviews.js --dry-run --limit=50
 *   node lib/scripts/backfillWorkerAiPrescreenInterviews.js --tenantId=TENANT --limit=200
 *   node lib/scripts/backfillWorkerAiPrescreenInterviews.js --userId=UID --limit=20
 *   node lib/scripts/backfillWorkerAiPrescreenInterviews.js --tenantId=T --applicationId=A
 *   node lib/scripts/backfillWorkerAiPrescreenInterviews.js --tenantId=T --limit=200 --print-changed
 *
 * Or with ts-node:
 *   npx ts-node src/scripts/backfillWorkerAiPrescreenInterviews.ts --dry-run --limit=5
 *   npx ts-node src/scripts/backfillWorkerAiPrescreenInterviews.ts --tenantId=T --limit=50 --print-changed --dry-run
 *
 * Denormalized flag: new submits set `users/{uid}.hasWorkerAiPrescreenInterview`. For legacy users, either rely on
 * `interviewStatus === 'completed'` + subcollection fallback in functions, or batch-set the flag for uids that have
 * any `users/{uid}/interviews/*` doc with `interviewKind === 'worker_ai_prescreen'` (small one-off script or console).
 */
import * as admin from 'firebase-admin';
import { extractPrescreenAnswersFromInterviewDoc } from '../workerAiPrescreen/extractPrescreenAnswersFromInterviewDoc';
import { composePrescreenAiBundle } from '../workerAiPrescreen/composePrescreenAiBundle';
import { buildAiInterviewContext, resolveApplicationDoc } from '../workerAiPrescreen/buildAiInterviewContext';
import { recomputeUserInterviewScoreSummary } from '../workerAiPrescreen/recomputeInterviewScoreSummary';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

type Args = {
  dryRun: boolean;
  printChanged: boolean;
  tenantId: string | null;
  limit: number;
  userId: string | null;
  applicationId: string | null;
};

function parseArgs(argv: string[]): Args {
  let dryRun = false;
  let printChanged = false;
  let tenantId: string | null = null;
  let limit = 100;
  let userId: string | null = null;
  let applicationId: string | null = null;

  for (const a of argv) {
    if (a === '--dry-run') dryRun = true;
    else if (a === '--print-changed') printChanged = true;
    else if (a.startsWith('--tenantId=')) tenantId = a.slice('--tenantId='.length).trim() || null;
    else if (a.startsWith('--limit=')) limit = Math.max(1, parseInt(a.slice('--limit='.length), 10) || 100);
    else if (a.startsWith('--userId=')) userId = a.slice('--userId='.length).trim() || null;
    else if (a.startsWith('--applicationId=')) applicationId = a.slice('--applicationId='.length).trim() || null;
  }
  return { dryRun, printChanged, tenantId, limit, userId, applicationId };
}

function tenantFromInterviewData(data: Record<string, unknown>): string | null {
  const ai = data.ai as Record<string, unknown> | undefined;
  const ctx = ai?.aiInterviewContext as Record<string, unknown> | undefined;
  const br = ctx?.businessRules as Record<string, unknown> | undefined;
  const t = br?.tenant;
  return typeof t === 'string' && t.trim() ? t.trim() : null;
}

function summarizeDecision(d: unknown): string {
  return typeof d === 'string' ? d : 'unknown';
}

function summarizeRecommendation(d: unknown): string {
  return typeof d === 'string' ? d : 'unknown';
}

/**
 * Application sync runs only when `aiAutomation.sourceInterviewId` is empty (backfill may set it)
 * or matches this interview doc id. If another interview id is stored, we skip to avoid clobbering
 * a different prescreen's automation snapshot.
 */
function shouldSyncApplicationAiAutomation(args: { sourceInterviewIdOnApp: string; interviewDocId: string }): boolean {
  const src = String(args.sourceInterviewIdOnApp ?? '').trim();
  if (src === '') return true;
  return src === args.interviewDocId;
}

/** Ordered unique tenant hints: interview context first, then CLI --tenantId. */
function orderedTenantHints(...parts: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const t = String(p ?? '').trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

const WORKER_AI_PRESCREEN = 'worker_ai_prescreen';

function isPrescreenInterviewDoc(data: Record<string, unknown>): boolean {
  return data.interviewKind === WORKER_AI_PRESCREEN;
}

/** Read all interview docs under a user; return up to `limit` prescreen refs (in doc id order). */
async function collectPrescreenInterviewRefsForUser(
  userId: string,
  limit: number,
  tenantFilter: string | null,
): Promise<FirebaseFirestore.DocumentReference[]> {
  const snap = await db.collection('users').doc(userId).collection('interviews').get();
  const refs: FirebaseFirestore.DocumentReference[] = [];
  for (const d of snap.docs) {
    const data = d.data() as Record<string, unknown>;
    if (!isPrescreenInterviewDoc(data)) continue;
    if (tenantFilter) {
      if (tenantFromInterviewData(data) !== tenantFilter) continue;
    }
    refs.push(d.ref);
    if (refs.length >= limit) break;
  }
  return refs;
}

const GLOBAL_USER_PAGE_SIZE = 300;

/**
 * Enumerate users in pages, read each user's `interviews` subcollection with unfiltered `.get()`,
 * keep prescreen docs until `--limit` total refs (optional tenant filter on interview payload).
 */
async function collectPrescreenInterviewRefsGlobal(args: {
  limit: number;
  tenantId: string | null;
}): Promise<{ refs: FirebaseFirestore.DocumentReference[]; usersPagesScanned: number; usersDocsVisited: number }> {
  const refs: FirebaseFirestore.DocumentReference[] = [];
  let usersPagesScanned = 0;
  let usersDocsVisited = 0;
  let lastUser: FirebaseFirestore.QueryDocumentSnapshot | null = null;

  while (refs.length < args.limit) {
    let q = db.collection('users').orderBy(admin.firestore.FieldPath.documentId()).limit(GLOBAL_USER_PAGE_SIZE);
    if (lastUser) q = q.startAfter(lastUser);
    const usersSnap = await q.get();
    usersPagesScanned += 1;
    if (usersSnap.empty) break;

    for (const userDoc of usersSnap.docs) {
      usersDocsVisited += 1;
      const uid = userDoc.id;
      const intSnap = await db.collection('users').doc(uid).collection('interviews').get();
      for (const d of intSnap.docs) {
        const data = d.data() as Record<string, unknown>;
        if (!isPrescreenInterviewDoc(data)) continue;
        if (args.tenantId) {
          if (tenantFromInterviewData(data) !== args.tenantId) continue;
        }
        refs.push(d.ref);
        if (refs.length >= args.limit) {
          return { refs, usersPagesScanned, usersDocsVisited };
        }
      }
    }

    lastUser = usersSnap.docs[usersSnap.docs.length - 1];
    if (usersSnap.docs.length < GLOBAL_USER_PAGE_SIZE) break;
  }

  return { refs, usersPagesScanned, usersDocsVisited };
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const stats = {
    interviewsScanned: 0,
    interviewsChanged: 0,
    applicationsUpdated: 0,
    applicationsSyncSkippedNoTenant: 0,
    applicationsSyncSkippedSourceInterviewGuard: 0,
    transitionLabels: {} as Record<string, number>,
    usersPagesScanned: 0 as number,
    usersDocsVisited: 0 as number,
  };

  let refs: FirebaseFirestore.DocumentReference[] = [];

  if (args.applicationId && args.tenantId) {
    const appSnap = await db.doc(`tenants/${args.tenantId}/applications/${args.applicationId}`).get();
    if (!appSnap.exists) {
      console.error('Application not found');
      process.exit(1);
    }
    const app = appSnap.data() as Record<string, unknown>;
    const uid = String(app.userId || app.candidateId || '').trim();
    const sourceInterviewId = String((app.aiAutomation as Record<string, unknown> | undefined)?.sourceInterviewId || '').trim();
    if (!uid || !sourceInterviewId) {
      console.error('Application missing userId/candidateId or aiAutomation.sourceInterviewId');
      process.exit(1);
    }
    refs.push(db.collection('users').doc(uid).collection('interviews').doc(sourceInterviewId));
  } else if (args.userId) {
    refs = await collectPrescreenInterviewRefsForUser(args.userId, args.limit, args.tenantId);
  } else {
    const global = await collectPrescreenInterviewRefsGlobal({
      limit: args.limit,
      tenantId: args.tenantId,
    });
    refs = global.refs;
    stats.usersPagesScanned = global.usersPagesScanned;
    stats.usersDocsVisited = global.usersDocsVisited;
  }

  for (const ref of refs) {
    stats.interviewsScanned += 1;
    const snap = await ref.get();
    if (!snap.exists) continue;
    const data = snap.data() as Record<string, unknown>;
    if (data.interviewKind !== WORKER_AI_PRESCREEN) continue;

    const userId = ref.parent.parent?.id;
    if (!userId) continue;

    const extracted = extractPrescreenAnswersFromInterviewDoc(data);
    if (!extracted.answers) {
      console.warn('skip (answers)', ref.path);
      continue;
    }

    const userSnap = await db.collection('users').doc(userId).get();
    const userDoc = (userSnap.data() || {}) as Record<string, unknown>;

    const applicationId =
      data.applicationId != null && String(data.applicationId).trim() !== ''
        ? String(data.applicationId).trim()
        : null;

    let tenantHint: string | null = tenantFromInterviewData(data);
    if (applicationId) {
      const hints = orderedTenantHints(tenantHint, args.tenantId);
      const resolved = await resolveApplicationDoc(db, userId, applicationId, hints, userDoc);
      if (resolved) {
        tenantHint = resolved.tenantId;
      } else if (!tenantHint) {
        console.warn(
          'Could not resolve tenant for application (direct paths only); context may be incomplete',
          { ref: ref.path, applicationId, hintsTried: hints },
        );
      }
    }

    let interviewContext = null;
    try {
      if (applicationId) {
        interviewContext = await buildAiInterviewContext(db, {
          userId,
          applicationId,
          tenantId: tenantHint,
        });
      }
    } catch (e) {
      console.warn('buildAiInterviewContext failed', ref.path, e instanceof Error ? e.message : e);
    }

    const bundle = await composePrescreenAiBundle({
      db,
      userId,
      answers: extracted.answers,
      dynamicAnswers: extracted.dynamicAnswers,
      interviewContext,
      applicationId,
      tenantIdHint: tenantHint,
      interviewId: ref.id,
      userDoc,
    });

    const oldAi = (data.ai || {}) as Record<string, unknown>;
    const oldFlags = JSON.stringify([...((oldAi.flags as string[]) || [])].sort());
    const newFlags = JSON.stringify([...(bundle.aiFlags || [])].sort());
    const oldScore = oldAi.overallScore;
    const newScore = bundle.scored.overallScore;
    const oldRec = summarizeRecommendation(oldAi.recommendation);
    const newRec = summarizeRecommendation(bundle.scored.recommendation);
    const oldDec = summarizeDecision((oldAi.hiringDecision as Record<string, unknown> | undefined)?.decision);
    const newDec = summarizeDecision(bundle.hiringResult.decision);

    const changed = oldFlags !== newFlags || oldScore !== newScore || oldDec !== newDec;

    const tid = tenantHint || interviewContext?.businessRules?.tenant || null;

    if (changed) {
      stats.interviewsChanged += 1;
      const key = `${oldDec}->${newDec}`;
      stats.transitionLabels[key] = (stats.transitionLabels[key] || 0) + 1;
    }

    if (changed && args.printChanged) {
      let applicationPath: string | null = null;
      let appSyncNote = 'no_application_on_interview';
      if (applicationId && tid) {
        applicationPath = `tenants/${tid}/applications/${applicationId}`;
        const appSnap = await db.doc(applicationPath).get();
        const src = appSnap.data()?.aiAutomation as Record<string, unknown> | undefined;
        const srcId = String(src?.sourceInterviewId ?? '').trim();
        if (shouldSyncApplicationAiAutomation({ sourceInterviewIdOnApp: srcId, interviewDocId: ref.id })) {
          appSyncNote =
            srcId === '' ? 'will_sync (sourceInterviewId empty on app; allowed)' : 'will_sync (sourceInterviewId matches)';
        } else {
          appSyncNote = `skipped_app_sync: sourceInterviewId on app is "${srcId}", expected "${ref.id}"`;
        }
      } else if (applicationId && !tid) {
        appSyncNote = 'skipped_app_sync: tenant not resolved (no tid)';
      }
      console.log(
        JSON.stringify(
          {
            kind: 'print-changed',
            interviewPath: ref.path,
            applicationPath,
            score: { old: oldScore, new: newScore },
            recommendation: { old: oldRec, new: newRec },
            decision: { old: oldDec, new: newDec },
            flags: { old: oldAi.flags ?? [], new: bundle.aiFlags ?? [] },
            appSyncNote,
          },
          null,
          2,
        ),
      );
    }

    if (args.dryRun) {
      if (changed && !args.printChanged) {
        console.log('[dry-run] would update', ref.path, { oldScore, newScore, oldFlags: oldAi.flags, newFlags: bundle.aiFlags });
      }
      continue;
    }

    if (!changed) continue;

    const newAi = {
      ...bundle.aiBlockCore,
      model: 'rules_v1',
      computedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await ref.update({
      score: bundle.score10,
      score10: bundle.score10,
      ai: newAi,
    });

    try {
      await recomputeUserInterviewScoreSummary(db, userId);
    } catch (e) {
      console.warn('recomputeUserInterviewScoreSummary failed', userId, e instanceof Error ? e.message : e);
    }

    if (applicationId && tid) {
      const appRef = db.doc(`tenants/${tid}/applications/${applicationId}`);
      const appSnap = await appRef.get();
      const appData = appSnap.data() as Record<string, unknown> | undefined;
      const src = appData?.aiAutomation as Record<string, unknown> | undefined;
      const srcId = String(src?.sourceInterviewId ?? '').trim();
      if (shouldSyncApplicationAiAutomation({ sourceInterviewIdOnApp: srcId, interviewDocId: ref.id })) {
        await appRef.set(
          {
            aiAutomation: {
              lastEvaluatedAt: admin.firestore.FieldValue.serverTimestamp(),
              sourceInterviewId: ref.id,
              decision: bundle.hiringResult.decision,
              eligibleForAutoAdvance: bundle.hiringResult.eligibleForAutoAdvance,
              priorityBucket: bundle.priorityBucket,
              recommendedActions: bundle.recommendedActions,
              reasonCodes: bundle.hiringResult.reasonCodes,
              score: bundle.scored.overallScore,
              categoryScores: bundle.categoryScores,
              categoryEvidence: bundle.categoryEvidence,
              noShowRisk: {
                engineVersion: bundle.applicationNoShowRisk.engineVersion,
                score: bundle.applicationNoShowRisk.score,
                band: bundle.applicationNoShowRisk.band,
                reasons: bundle.applicationNoShowRisk.reasons,
                recommendedAction: bundle.applicationNoShowRisk.recommendedAction,
                computedAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              ...(bundle.orchestratorV1Firestore ? { orchestratorV1: bundle.orchestratorV1Firestore } : {}),
            },
          },
          { merge: true },
        );
        stats.applicationsUpdated += 1;
      } else {
        stats.applicationsSyncSkippedSourceInterviewGuard += 1;
      }
    } else if (applicationId && !tid) {
      stats.applicationsSyncSkippedNoTenant += 1;
    }
  }

  console.log(JSON.stringify({ ok: true, args, stats }, null, 2));
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
