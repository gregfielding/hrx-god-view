/**
 * Regenerate AI posting copy for MACHINE-OWNED Fieldglass auto-postings
 * (Greg 2026-09-04: "make them as if I clicked the AI generate button").
 *
 * Machine-owned = the posting's current description still equals the
 * machine copy (`jobOrder.fieldglass.aiJobDescription`, raw or
 * markdown-stripped) or the raw client description fallback. Human-edited
 * copy is never clobbered — same rule as the enrichment backfill.
 *
 * Usage (from functions/, with ANTHROPIC_API_KEY in the env — the script
 * sources .env.hrx1-d3beb itself when present):
 *   npx ts-node --project tsconfig.scripts.json src/scripts/regenerateFieldglassPostingCopies.ts --dry-run --limit=3
 *   npx ts-node --project tsconfig.scripts.json src/scripts/regenerateFieldglassPostingCopies.ts --all
 */
import * as fs from 'fs';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import {
  generateFieldglassPostingCopy,
  stripPostingMarkdown,
  type FieldglassEnrichmentStamp,
} from '../integrations/fieldglass/enrichment';

// Source the gitignored env file for the Anthropic key (never printed).
try {
  const envText = fs.readFileSync('.env.hrx1-d3beb', 'utf8');
  for (const line of envText.split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
} catch {
  /* env file optional when the key is already exported */
}

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const TENANT = 'BCiP2bQ9CgVOCTfV6MhD';
const dryRun = process.argv.includes('--dry-run');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : null;

const trim = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown): number | undefined =>
  Number.isFinite(v as number) && (v as number) > 0 ? (v as number) : undefined;

async function main(): Promise<void> {
  const posts = await db
    .collection(`tenants/${TENANT}/job_postings`)
    .where('createdBy', '==', 'system_fieldglass_auto')
    .get();
  console.log(`fieldglass auto postings: ${posts.size}`);

  let regenerated = 0;
  let skippedHumanEdited = 0;
  let skippedNoJo = 0;
  let failed = 0;

  for (const post of posts.docs) {
    if (limit != null && regenerated >= limit) break;
    const p = post.data();
    const jobOrderId = trim(p.jobOrderId);
    if (!jobOrderId) {
      skippedNoJo++;
      continue;
    }
    const joSnap = await db.doc(`tenants/${TENANT}/job_orders/${jobOrderId}`).get();
    if (!joSnap.exists) {
      skippedNoJo++;
      continue;
    }
    const jo = joSnap.data() as Record<string, unknown>;
    const fg = (jo.fieldglass ?? {}) as Record<string, unknown>;
    const stampedAi = trim(fg.aiJobDescription);
    const clientDesc = trim(jo.jobDescriptionFromClient);

    const postDesc = trim(p.jobDescription);
    const machineOwned =
      !postDesc ||
      postDesc === stampedAi ||
      (stampedAi !== '' && postDesc === stripPostingMarkdown(stampedAi)) ||
      postDesc === clientDesc;
    if (!machineOwned) {
      skippedHumanEdited++;
      continue;
    }

    // Enrichment stamp from the originating Fieldglass request, when linked.
    let enrichment: FieldglassEnrichmentStamp = {} as FieldglassEnrichmentStamp;
    let reqDescription = '';
    let commentsToSupplier = '';
    const requestId = trim(fg.requestId);
    if (requestId) {
      const reqSnap = await db
        .doc(`tenants/${TENANT}/external_shift_requests/${requestId}`)
        .get();
      if (reqSnap.exists) {
        const r = reqSnap.data() as Record<string, unknown>;
        enrichment = (r.enrichment ?? {}) as FieldglassEnrichmentStamp;
        reqDescription = trim(r.description);
        commentsToSupplier = trim(r.commentsToSupplier);
      }
    }

    const worksiteAddress = (jo.worksiteAddress ?? {}) as Record<string, string>;
    const e = enrichment as unknown as Record<string, unknown>;
    const input = {
      title: trim(jo.jobTitle) || trim(p.jobTitle) || trim(p.postTitle),
      city: trim(worksiteAddress.city) || undefined,
      state: trim(worksiteAddress.state) || undefined,
      zipCode: trim(worksiteAddress.zipCode) || undefined,
      payRate: num(jo.payRate),
      payRateOt: num(e.payRateOt),
      scheduleText: trim(e.scheduleText) || undefined,
      hoursPerWeek: num(e.hoursPerWeek) ? String(e.hoursPerWeek) : undefined,
      uniform: trim(e.uniform) || undefined,
      description: reqDescription || clientDesc || undefined,
      commentsToSupplier: commentsToSupplier || undefined,
      contractType: trim(e.contractType) || undefined,
      positionsRequested: num(e.positionsRequested),
      startDate: trim(jo.startDate) || undefined,
      endDate: trim(jo.endDate) || undefined,
      jobType: (trim(jo.jobType) === 'gig' ? 'gig' : 'career') as 'gig' | 'career',
    };
    if (!input.title) {
      skippedNoJo++;
      continue;
    }

    const copy = await generateFieldglassPostingCopy(input);
    if (!copy) {
      failed++;
      console.log(`FAILED ${post.id} (${input.title})`);
      continue;
    }

    if (dryRun) {
      console.log(`DRY ${post.id} (${input.title}):\n${copy.slice(0, 300)}\n---`);
      regenerated++;
      continue;
    }

    await post.ref.set(
      { jobDescription: copy, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    const joDesc = trim(jo.jobDescription);
    const joMachineOwned =
      !joDesc ||
      joDesc === stampedAi ||
      (stampedAi !== '' && joDesc === stripPostingMarkdown(stampedAi)) ||
      joDesc === clientDesc;
    const joPatch: Record<string, unknown> = {
      'fieldglass.aiJobDescription': copy,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (joMachineOwned) joPatch.jobDescription = copy;
    await joSnap.ref.update(joPatch);
    regenerated++;
    if (regenerated % 10 === 0) console.log(`…${regenerated} regenerated`);
  }

  console.log(
    JSON.stringify({ total: posts.size, regenerated, skippedHumanEdited, skippedNoJo, failed, dryRun }),
  );
}

void main();
