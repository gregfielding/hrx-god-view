/**
 * WC code suggestion — the semantic classifier (Greg 2026-07-29, slice 2).
 *
 * The exact-match `jobTitles[]` layer only covers titles seen before;
 * fresh Sodexo/catering titles ("banquet chef", "beverage attendant")
 * fall through. This closes that gap: given a novel title + the worksite
 * state, it asks the LLM to pick the best WC code FROM THE CODES ALREADY
 * IN USE FOR THAT STATE (never inventing one), using each code's catalog
 * description as the semantic anchor — the two-hop model (title → nature
 * → state-scoped code+rate).
 *
 * Suggest-only, never auto-apply (WC misclassification = audit risk). On
 * confirm, `learnWorkersCompAlias` writes the title back to the matrix
 * row's jobTitles[] so the exact-match layer grows and the LLM only fires
 * on genuinely new titles — the same learn-once loop as venue/site
 * mappings.
 *
 * Gate: staff (hrx claim / admin / securityLevel >= 4).
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { getClaudeChat } from '../utils/claudeChat';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();
const openai = getClaudeChat(); // Claude-backed since 2026-08-21 (lazy — no key read at import)

const trim = (v: unknown): string => String(v ?? '').trim();

async function ensureStaffAccess(
  uid: string | undefined,
  token: Record<string, unknown> | undefined,
  tenantId: string,
): Promise<void> {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  if (token?.hrx === true) return;
  const data = ((await db.collection('users').doc(uid).get()).data() ?? {}) as Record<string, unknown>;
  const role = String(data.role ?? '').toLowerCase();
  const level = Number.parseInt(String(data.securityLevel ?? '0'), 10) || 0;
  const tenantLevel =
    Number.parseInt(
      String(
        (data.tenantIds as Record<string, Record<string, unknown>> | undefined)?.[tenantId]?.securityLevel ?? '0',
      ),
      10,
    ) || 0;
  if (role === 'admin' || role === 'super_admin' || level >= 4 || tenantLevel >= 4) return;
  throw new HttpsError('permission-denied', 'Staff access required.');
}

interface Candidate {
  code: string;
  rate: number | null;
  title: string | null;
  description: string | null;
  verified: boolean;
}

export const suggestWorkersCompCode = onCall(
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 60 },
  async (request) => {
    const tenantId = trim(request.data?.tenantId);
    const jobTitle = trim(request.data?.jobTitle);
    const state = trim(request.data?.state).toUpperCase();
    if (!tenantId || !jobTitle || !state) {
      throw new HttpsError('invalid-argument', 'tenantId, jobTitle and state are required.');
    }
    await ensureStaffAccess(request.auth?.uid, request.auth?.token as never, tenantId);

    // In-scope codes = codes the carrier actually rates for this state.
    // Highest rate wins when a (state, code) pair appears twice.
    const rateSnap = await db.collection(`tenants/${tenantId}/workers_comp_rates`).where('state', '==', state).get();
    const rateByCode = new Map<string, number>();
    rateSnap.forEach((d) => {
      const v = d.data();
      const code = trim(v.code);
      const rate = Number(v.rate);
      if (code && Number.isFinite(rate)) rateByCode.set(code, Math.max(rateByCode.get(code) ?? -Infinity, rate));
    });
    // Some states store the code with mixed casing; normalize is already done.
    if (rateByCode.size === 0) {
      return { suggestions: [], noCodesForState: true, state };
    }

    // Join the catalog for descriptions.
    const catSnap = await db.collection(`tenants/${tenantId}/workers_comp_class_codes`).get();
    const catByCode = new Map<string, { title?: string; description?: string; verified?: boolean }>();
    catSnap.forEach((d) => {
      const v = d.data();
      const code = trim(v.code);
      if (code) {
        catByCode.set(code, {
          title: (v.title as string) || undefined,
          description: (v.description as string) || undefined,
          verified: v.descriptionVerified === true,
        });
      }
    });

    const candidates: Candidate[] = [...rateByCode.entries()]
      .map(([code, rate]) => ({
        code,
        rate,
        title: catByCode.get(code)?.title ?? null,
        description: catByCode.get(code)?.description ?? null,
        verified: catByCode.get(code)?.verified ?? false,
      }))
      .sort((a, b) => a.code.localeCompare(b.code));

    // ── LLM: pick the best code from candidates (never invent) ──
    const candidateList = candidates
      .map((c) => `- code ${c.code}: ${c.title ?? '(no title)'} — ${c.description ?? '(no description)'}`)
      .join('\n');
    const prompt = [
      `You are a US workers' compensation classification assistant for a staffing agency.`,
      `Worksite state: ${state}. Job title to classify: "${jobTitle}".`,
      ``,
      `Choose the SINGLE best-fit workers' comp class code for this job title from ONLY the candidate codes below (these are the codes the carrier rates for ${state}). NEVER invent a code. If none reasonably fit, return an empty array.`,
      ``,
      `Candidate codes:`,
      candidateList,
      ``,
      `Respond with ONLY JSON of this exact shape (no prose): {"suggestions":[{"code":"<one of the candidate codes>","confidence":<0..1>,"reasoning":"<one short sentence on why this class fits the work>"}]}. Return at most 2 suggestions, best first. Confidence reflects how clearly the title maps to the class.`,
    ].join('\n');

    let parsed: { suggestions?: Array<{ code?: string; confidence?: number; reasoning?: string }> } = {};
    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-5',
        messages: [
          { role: 'system', content: 'You output only valid JSON. You never invent class codes outside the provided candidates.' },
          { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
      });
      parsed = JSON.parse(completion.choices?.[0]?.message?.content || '{}');
    } catch (err) {
      throw new HttpsError('internal', `Classifier failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const byCode = new Map(candidates.map((c) => [c.code, c]));
    const suggestions = (parsed.suggestions ?? [])
      .map((s) => {
        const code = trim(s.code);
        const cand = byCode.get(code);
        if (!cand) return null; // drop anything not in candidates (anti-hallucination)
        const confidence = Math.max(0, Math.min(1, Number(s.confidence) || 0));
        return {
          code: cand.code,
          rate: cand.rate,
          title: cand.title,
          description: cand.description,
          descriptionVerified: cand.verified,
          confidence,
          reasoning: trim(s.reasoning) || null,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .slice(0, 2);

    return { suggestions, state, candidateCount: candidates.length };
  },
);

export const learnWorkersCompAlias = onCall(
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 30 },
  async (request) => {
    const tenantId = trim(request.data?.tenantId);
    const state = trim(request.data?.state).toUpperCase();
    const code = trim(request.data?.code);
    const jobTitle = trim(request.data?.jobTitle);
    const modifierAccountId = trim(request.data?.modifierAccountId);
    if (!tenantId || !state || !code || !jobTitle) {
      throw new HttpsError('invalid-argument', 'tenantId, state, code and jobTitle are required.');
    }
    await ensureStaffAccess(request.auth?.uid, request.auth?.token as never, tenantId);

    const snap = await db
      .collection(`tenants/${tenantId}/workers_comp_rates`)
      .where('state', '==', state)
      .where('code', '==', code)
      .get();
    if (snap.empty) {
      throw new HttpsError('not-found', `No rate row for ${state} ${code} — can't learn an alias without a rate.`);
    }
    // Prefer the account-scoped row when a modifier account is supplied.
    const scoped = modifierAccountId
      ? snap.docs.find((d) => trim(d.data().modifierAccountId) === modifierAccountId)
      : undefined;
    const target = scoped ?? snap.docs.find((d) => !trim(d.data().modifierAccountId)) ?? snap.docs[0];

    const existing = Array.isArray(target.data().jobTitles) ? (target.data().jobTitles as unknown[]).map(String) : [];
    const lc = jobTitle.toLowerCase();
    if (existing.some((t) => t.trim().toLowerCase() === lc)) {
      return { ok: true, alreadyPresent: true, code, state };
    }
    await target.ref.update({
      jobTitles: [...existing, jobTitle],
      updatedBy: 'wc_ai_suggest_confirm',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { ok: true, alreadyPresent: false, code, state, rowId: target.id };
  },
);
