/**
 * Job board description generator — the ONE place public job-post copy is written
 * (Greg 2026-09-09: "the AI generated text is usually not detailed or rich… running it again
 * later creates a better result"). Root cause of the thin copy: the old callable ran gpt-4o-mini
 * at 800 max tokens / temperature 0.7 and asked for 200–400 words, so the first draft was short
 * and generic and re-runs varied. This module uses Claude Opus 5 with adaptive thinking, a
 * structured template (~350–600 words), and the same show/hide toggle rules the form enforces.
 *
 * Used by: the recruiters' "Generate Job Description" button (generateJobDescription callable),
 * Natalie's Craigslist drafts (verbatim description + "Apply Here:" link), and the thin-description
 * auto-fill drain (active public posts with < 300 chars).
 */
import * as admin from 'firebase-admin';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from 'firebase-functions/v2';
import { stripPostingMarkdown } from '../integrations/fieldglass/enrichment';

export const JOB_DESCRIPTION_MODEL = process.env.JOB_DESCRIPTION_MODEL || 'claude-opus-5';
export const THIN_DESCRIPTION_CHARS = 300;

/**
 * "Thin" = worth (re)generating. Under 300 chars is obvious; the other common case (Greg 2026-09-09,
 * CORT SF: 633 chars, one paragraph, no headings, straight from the client's order) is a single
 * blob of client boilerplate under ~1,500 chars. Anything the generator itself wrote is never thin —
 * it carries the "What you will do" / "Why work with C1" structure.
 */
export function isThinDescription(text: string): boolean {
  const d = (text || '').trim();
  if (d.length < THIN_DESCRIPTION_CHARS) return true;
  if (d.length >= 1500) return false;
  const lines = d.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const hasBullets = /(^|\n)\s*[-•*]\s/.test(d);
  return lines.length <= 2 && !hasBullets;
}

export interface JobDescriptionInput {
  jobTitle?: string;
  jobOrderName?: string;
  jobDescriptionFromClient?: string;
  payRate?: number | string;
  zipCode?: string;
  city?: string;
  state?: string;
  skills?: string[];
  uniformRequirements?: string[];
  customUniformRequirements?: string;
  experienceRequired?: string;
  educationRequired?: string;
  languages?: string[];
  physicalRequirements?: string[];
  ppeRequirements?: string[];
  licensesCerts?: string[];
  backgroundCheckPackages?: string[];
  drugScreeningPanels?: string[];
  additionalScreenings?: string[];
  eVerifyRequired?: boolean;
  shiftType?: string[];
  startDate?: string;
  endDate?: string;
  workersNeeded?: number;
  jobType?: string;
  [k: string]: unknown;
}
export type ToggleStates = Record<string, boolean | undefined>;

const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v));
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => s(x)).filter(Boolean) : typeof v === 'string' && v.trim().startsWith('[') ? (JSON.parse(v) as unknown[]).map((x) => s(x)).filter(Boolean) : []);

const EXP: Record<string, string> = { entry: 'Entry-Level (0-1 year)', intermediate: 'Intermediate (2-4 years)', experienced: 'Experienced (5+ years)' };

/** Same visibility rules as the original callable: a field is only usable when its toggle is on. */
export function buildJobDescriptionPrompt(d: JobDescriptionInput, t: ToggleStates): string {
  const lines: string[] = [];
  const shown = (label: string, value: string, on: boolean | undefined) => { if (value) lines.push(`${label}: ${value} ${on ? '(SHOW THIS IN DESCRIPTION)' : '(DO NOT MENTION IN DESCRIPTION - toggle is off)'}`); };
  if (s(d.jobTitle)) lines.push(`Job Title: ${s(d.jobTitle)}`);
  if (s(d.jobOrderName)) lines.push(`Position Name: ${s(d.jobOrderName)}`);
  if (s(d.jobDescriptionFromClient)) lines.push(`\nClient's description / recruiter notes (the richest source — use every relevant fact from it):\n${s(d.jobDescriptionFromClient)}\n`);
  if (s(d.zipCode)) lines.push(`Location Zip Code: ${s(d.zipCode)}`);
  if (s(d.city) || s(d.state)) lines.push(`Location: ${[s(d.city), s(d.state)].filter(Boolean).join(', ')}`);
  if (s(d.jobType)) lines.push(`Job type: ${s(d.jobType) === 'gig' ? 'gig / shift-based work (may be ongoing)' : 'career / ongoing position'}`);
  const pay = Number(d.payRate);
  if (Number.isFinite(pay) && pay > 0) shown('Pay Rate', `$${pay.toFixed(2)}/hour`, t.showPayRate);
  if (arr(d.skills).length) shown('Required Skills', arr(d.skills).join(', '), t.showSkills);
  if (s(d.experienceRequired)) shown('Experience Level', EXP[s(d.experienceRequired)] || s(d.experienceRequired), t.showExperience);
  if (s(d.educationRequired)) shown('Education Required', s(d.educationRequired), t.showEducation);
  if (arr(d.languages).length) shown('Languages', arr(d.languages).join(', '), t.showLanguages);
  if (arr(d.shiftType).length) shown('Shift Type', arr(d.shiftType).join(', '), t.showShift);
  if (s(d.startDate)) shown('Start Date', s(d.startDate), t.showStart);
  if (s(d.endDate)) shown('End Date', s(d.endDate), t.showEnd);
  if (d.workersNeeded) shown('Workers Needed', String(d.workersNeeded), t.showWorkersNeeded);
  if (arr(d.uniformRequirements).length || s(d.customUniformRequirements)) shown('Uniform Requirements', [...arr(d.uniformRequirements), s(d.customUniformRequirements)].filter(Boolean).join(', '), t.showUniformRequirements);
  if (arr(d.physicalRequirements).length) shown('Physical Requirements', arr(d.physicalRequirements).join(', '), t.showPhysicalRequirements);
  if (arr(d.ppeRequirements).length) shown('PPE Requirements', arr(d.ppeRequirements).join(', '), t.showRequiredPpe);
  if (arr(d.licensesCerts).length) shown('Licenses/Certifications Required', arr(d.licensesCerts).join(', '), t.showLicensesCerts);
  if (arr(d.backgroundCheckPackages).length) shown('Background Check', arr(d.backgroundCheckPackages).join(', '), t.showBackgroundChecks);
  if (arr(d.drugScreeningPanels).length) shown('Drug Screening', arr(d.drugScreeningPanels).join(', '), t.showDrugScreening);
  if (arr(d.additionalScreenings).length) shown('Additional Screenings', arr(d.additionalScreenings).join(', '), t.showAdditionalScreenings);
  if (d.eVerifyRequired) lines.push('E-Verify Required: Yes');
  return lines.join('\n');
}

const SYSTEM = `You write public job board postings for C1 Staffing (a W-2 staffing agency). The employer is always "C1 Staffing" — never name the client company or worksite (the zip code is fine).

Write a rich, specific posting of roughly 350-600 words, PLAIN TEXT ONLY (no markdown: no #, no **, no emojis; the text is rendered verbatim). Structure, using plain-sentence lead-ins and simple hyphen bullets:
1. Two-sentence opener: what the job is, where (city/zip), and the single most attractive fact (pay if shown, schedule, or start timing).
2. "What you will do:" 5-8 concrete duty bullets drawn from the client's description; never generic filler.
3. "Schedule and pay:" only facts marked SHOW (pay, shift type, dates). Say "paid weekly" — C1 pays weekly.
4. "What you will need:" requirements — 18+, physical requirements, skills/experience/certs/languages that are marked SHOW, screening lines (background check, drug screen, E-Verify) only when marked SHOW or E-Verify is required.
5. "Why work with C1:" 2-3 sentences: weekly pay, C1 is the employer of record, supportive recruiters, more assignments for reliable people.
6. Close with one line: "C1 Staffing is an Equal Opportunity Employer." Do NOT add an apply link or phone number; the board provides the Apply button.

Rules: use ONLY information given; if a field says DO NOT MENTION, omit it entirely; never invent pay, hours, benefits, or client names; no salary ranges beyond the given rate; no "must have reliable transportation" unless given; American English; no exclamation marks.`;

export async function generateJobDescriptionText(input: JobDescriptionInput, toggles: ToggleStates): Promise<string> {
  const client = new Anthropic();
  const prompt = buildJobDescriptionPrompt(input, toggles);
  const res = await client.messages.create({
    model: JOB_DESCRIPTION_MODEL,
    max_tokens: 2500,
    thinking: { type: 'adaptive' },
    system: SYSTEM,
    messages: [{ role: 'user', content: `Write the posting from these facts:\n\n${prompt}` }],
  });
  const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n');
  return stripPostingMarkdown(text).trim();
}

/** Build the same input the recruiters' button builds, but server-side from the posting + its job order. */
export async function buildInputFromPosting(tenantId: string, post: Record<string, unknown>): Promise<{ input: JobDescriptionInput; toggles: ToggleStates; hasSource: boolean }> {
  const db = admin.firestore();
  let jo: Record<string, unknown> = {};
  const joId = s(post.jobOrderId);
  if (joId) jo = ((await db.doc(`tenants/${tenantId}/job_orders/${joId}`).get()).data() ?? {}) as Record<string, unknown>;
  const scoping = ((jo.deal as Record<string, unknown> | undefined)?.stageData as Record<string, unknown> | undefined)?.scoping as Record<string, unknown> | undefined ?? {};
  const compliance = (scoping.compliance ?? {}) as Record<string, unknown>;
  // When the post's current description is client boilerplate (thin), it IS the client notes — keep
  // its facts (duties, weekend shifts, etc.) as source material for the rewrite.
  const existing = s(post.jobDescription);
  const existingAsNotes = existing && isThinDescription(existing) && !post.jobDescriptionGeneratedAt ? existing : '';
  const clientNotes = [s(jo.jobDescriptionFromClient) || s(jo.jobOrderDescription) || s(jo.jobDescription), s(post.jobDescriptionPrompt), existingAsNotes].filter(Boolean).join('\n\n');
  const addr = (jo.worksiteAddress ?? {}) as Record<string, unknown>;
  const input: JobDescriptionInput = {
    jobTitle: s(post.jobTitle) || s(jo.jobTitle),
    jobOrderName: s(post.postTitle) || s(jo.jobOrderName),
    jobDescriptionFromClient: clientNotes,
    payRate: (post.payRate as number | undefined) ?? (jo.payRate as number | undefined),
    zipCode: s(post.zipCode) || s(addr.zipCode),
    city: s(post.city) || s(addr.city),
    state: s(post.state) || s(addr.state),
    jobType: s(post.jobType),
    skills: arr(post.skills).length ? arr(post.skills) : arr(scoping.skills),
    uniformRequirements: arr(post.uniformRequirements).length ? arr(post.uniformRequirements) : arr(scoping.uniformRequirements),
    customUniformRequirements: s(post.customUniformRequirements) || s(scoping.customUniformRequirements),
    experienceRequired: s(scoping.experience) || s(compliance.experience) || s(jo.experienceRequired),
    educationRequired: s(scoping.education) || s(jo.educationRequired),
    languages: arr(post.languages).length ? arr(post.languages) : arr(scoping.languages),
    physicalRequirements: arr(post.physicalRequirements).length ? arr(post.physicalRequirements) : arr(scoping.physicalRequirements),
    ppeRequirements: arr(post.requiredPpe).length ? arr(post.requiredPpe) : arr(scoping.ppeRequirements),
    licensesCerts: arr(post.licensesCerts).length ? arr(post.licensesCerts) : arr(scoping.licensesCerts),
    backgroundCheckPackages: arr(post.backgroundCheckPackages).length ? arr(post.backgroundCheckPackages) : arr(compliance.backgroundCheckPackages),
    drugScreeningPanels: arr(post.drugScreeningPanels).length ? arr(post.drugScreeningPanels) : arr(compliance.drugScreeningPanels),
    additionalScreenings: arr(post.additionalScreenings).length ? arr(post.additionalScreenings) : arr(compliance.additionalScreenings),
    eVerifyRequired: post.eVerifyRequired === true || compliance.eVerify === true || jo.eVerifyRequired === true,
    shiftType: arr(post.shift).length ? arr(post.shift) : arr(jo.shiftType),
    startDate: s(post.startDate), endDate: s(post.endDate),
    workersNeeded: Number(post.workersNeeded ?? jo.workersNeeded ?? 0) || undefined,
  };
  const toggles: ToggleStates = {};
  for (const k of Object.keys(post)) if (k.startsWith('show')) toggles[k] = post[k] === true;
  const hasSource = Boolean(clientNotes) || Boolean(s(post.companyName) && input.jobTitle);
  return { input, toggles, hasSource };
}

/** Generate and save a description for a posting; returns the text (or null when there's nothing to write from). */
export async function generateDescriptionForPosting(tenantId: string, postId: string, opts: { by: string; force?: boolean } = { by: 'auto' }): Promise<string | null> {
  const ref = admin.firestore().doc(`tenants/${tenantId}/job_postings/${postId}`);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const post = snap.data() as Record<string, unknown>;
  if (!opts.force && !isThinDescription(s(post.jobDescription))) return s(post.jobDescription);
  const { input, toggles, hasSource } = await buildInputFromPosting(tenantId, post);
  if (!hasSource) { logger.info('[jobDescription] no source material; skipping', { postId }); return null; }
  const text = await generateJobDescriptionText(input, toggles);
  if (!text) return null;
  await ref.set({ jobDescription: text, jobDescriptionGeneratedAt: admin.firestore.FieldValue.serverTimestamp(), jobDescriptionGeneratedBy: opts.by, jobDescriptionModel: JOB_DESCRIPTION_MODEL, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  return text;
}
