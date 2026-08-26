import * as crypto from 'crypto';
import * as functions from 'firebase-functions';
import { onRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { getStorage } from 'firebase-admin/storage';
import { getStorageBucketName } from './utils/storageBucket';
import { getOrCreateFirebaseDownloadReadUrl } from './utils/firebaseStorageDownloadReadUrl';
import { logger } from './utils/logger';
import { maybeEmitResumeUploadedCategoryScore } from './categoryScoreEvolution/activityCategoryScoreEmit';
import nlp from 'compromise';
import { getClaudeChat, type ChatClientLike } from './utils/claudeChat';
import { z } from 'zod';

// Ensure default app exists (emulators + cold starts)
if (!admin.apps.length) {
  admin.initializeApp();
}

// Add at the top for missing types
// @ts-ignore
const pdfParse = require('pdf-parse');
// @ts-ignore
const mammoth = require('mammoth');

// Google Cloud Vision for OCR
const vision = require('@google-cloud/vision');

const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

/** User-fixable file issues → HTTP 400 from {@link parseResumeHttp}. */
export class ResumeParseClientError extends Error {
  readonly code: string;

  constructor(message: string, code = 'invalid_resume_file') {
    super(message);
    this.name = 'ResumeParseClientError';
    this.code = code;
  }
}

type BinaryWordKind = 'ooxml_zip' | 'legacy_ole' | 'unknown';

/** OOXML .docx is a ZIP; legacy Word .doc is OLE compound file. */
function sniffWordBinaryKind(buffer: Buffer): BinaryWordKind {
  if (buffer.length < 8) return 'unknown';
  if (
    buffer[0] === 0xd0 &&
    buffer[1] === 0xcf &&
    buffer[2] === 0x11 &&
    buffer[3] === 0xe0 &&
    buffer[4] === 0xa1 &&
    buffer[5] === 0xb1 &&
    buffer[6] === 0x1a &&
    buffer[7] === 0xe1
  ) {
    return 'legacy_ole';
  }
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
    return 'ooxml_zip';
  }
  return 'unknown';
}

function sniffPdfMagic(buffer: Buffer): boolean {
  return buffer.length >= 5 && buffer.slice(0, 5).toString('latin1') === '%PDF-';
}

/**
 * Compare filename extension to file magic bytes so we return 400 with a clear message
 * instead of a generic mammoth/parse failure.
 */
function validateResumeBinaryAgainstExtension(buffer: Buffer, fileName: string): void {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';

  if (ext === 'pdf') {
    if (!sniffPdfMagic(buffer)) {
      throw new ResumeParseClientError(
        'This file does not look like a valid PDF (missing PDF signature). It may be corrupted or misnamed. Export or save as PDF and try again.',
        'invalid_pdf_file',
      );
    }
    return;
  }

  if (ext === 'docx' || ext === 'doc') {
    const kind = sniffWordBinaryKind(buffer);
    if (kind === 'legacy_ole') {
      throw new ResumeParseClientError(
        'This file is a legacy Microsoft Word document (.doc, binary format). HRX only supports Word documents saved in the newer .docx format. Open the file in Word and use Save As → Word Document (.docx), then upload again.',
        'legacy_doc_not_supported',
      );
    }
    if (ext === 'docx' && kind !== 'ooxml_zip') {
      throw new ResumeParseClientError(
        'This file does not look like a valid .docx (Office Open XML / ZIP). It may be corrupted, renamed, or still an older .doc saved with the wrong extension. Save As .docx from Microsoft Word or upload a PDF.',
        'invalid_docx_file',
      );
    }
    // .doc extension but ZIP magic → Word saved as OOXML but misnamed; mammoth can parse.
    return;
  }
}

// Validation functions using Zod schemas
function validateParsedResumeData(data: any): any {
  try {
    return ParsedResumeDataSchema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('ParsedResumeData validation failed:', error.errors);
      console.warn('Using unvalidated parsed resume data due to schema validation failure');
      // Return the data as-is but log the issues
      return data;
    }
    throw error;
  }
}

function validateResumeUpload(data: any): ResumeUpload {
  try {
    const validated = ResumeUploadSchema.parse(data);
    return validated as ResumeUpload;
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('ResumeUpload validation failed:', error.errors);
      // For validation errors, return the data as-is but log the issues
      console.warn('Using unvalidated resume upload data due to schema validation failure');
      return data as ResumeUpload;
    }
    throw error;
  }
}

function validateParsedResume(data: any): ParsedResume {
  try {
    const validated = ParsedResumeSchema.parse(data);
    return validated as ParsedResume;
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('ParsedResume validation failed:', error.errors);
      // For validation errors, return the data as-is but log the issues
      console.warn('Using unvalidated parsed resume data due to schema validation failure');
      return data as ParsedResume;
    }
    throw error;
  }
}
// Remove global openai client initialization
// const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Zod schemas — aligned 2026-08-25 to what the extraction prompt actually
// returns (they previously mismatched on every parse: skills had no
// source/confidence, years/current/isNative came back as strings, LinkedIn
// URLs lack schemes, and the synthesized aiAnalysis writes zeros). Validation
// stays fail-open (log + return raw) but should now normally PASS — a
// console.error here means the prompt and schema drifted again.
const ContactInfoSchema = z.object({
  name: z.string().min(1),
  email: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  linkedin: z.string().optional(),
  website: z.string().optional(),
});

const SkillSchema = z.object({
  name: z.string().min(1),
  canonicalId: z.string().optional(),
  source: z.enum(['predefined', 'custom']).optional(),
  category: z.enum(['technical', 'soft', 'language', 'certification', 'other']),
  level: z.enum(['beginner', 'intermediate', 'advanced', 'expert']).optional(),
  yearsOfExperience: z.union([z.number(), z.string()]).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

const EducationSchema = z.object({
  institution: z.string().min(1),
  degree: z.string().min(1),
  field: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  gpa: z.string().optional(),
  honors: z.string().optional(),
  location: z.string().optional(),
});

const WorkExperienceSchema = z.object({
  jobTitle: z.string().min(1),
  company: z.string().min(1),
  location: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  current: z.union([z.boolean(), z.string()]).optional(),
  description: z.string().optional(),
  responsibilities: z.array(z.string()).optional(),
  achievements: z.array(z.string()).optional(),
  skillsUsed: z.array(z.string()).optional(),
});

const CertificationSchema = z.object({
  name: z.string().min(1),
  issuer: z.string().optional(),
  dateObtained: z.string().optional(),
  expiryDate: z.string().optional(),
  credentialId: z.string().optional(),
});

const LanguageSchema = z.object({
  language: z.string().min(1),
  proficiency: z.string(),
  isNative: z.union([z.boolean(), z.string()]).optional(),
});

const ProjectSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  technologies: z.array(z.string()).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  url: z.string().optional(),
});

const AwardSchema = z.object({
  name: z.string().min(1),
  issuer: z.string().min(1),
  date: z.string().optional(),
  description: z.string().optional(),
});

const VolunteerWorkSchema = z.object({
  organization: z.string().min(1),
  role: z.string().min(1),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  description: z.string().optional(),
});

const AIAnalysisSchema = z.object({
  // 0 = synthesized placeholder (generateAIAnalysis was deleted 2026-08-25).
  overallScore: z.number().min(0).max(10),
  skillGaps: z.array(z.string()),
  recommendations: z.array(z.string()),
  marketability: z.number().min(0).max(10),
  yearsOfExperience: z.number().min(0),
  educationLevel: z.string(),
  keyStrengths: z.array(z.string()),
  areasForImprovement: z.array(z.string()),
  jobFit: z.record(z.string(), z.number().min(0).max(10)),
});

const ParsedResumeDataSchema = z.object({
  contact: ContactInfoSchema,
  summary: z.string(),
  bio: z.string().optional(),
  skills: z.array(SkillSchema),
  education: z.array(EducationSchema),
  experience: z.array(WorkExperienceSchema),
  certifications: z.array(CertificationSchema),
  languages: z.array(LanguageSchema),
  projects: z.array(ProjectSchema),
  awards: z.array(AwardSchema),
  volunteerWork: z.array(VolunteerWorkSchema),
  parsedText: z.string(),
  confidence: z.number().min(0).max(1),
  aiAnalysis: AIAnalysisSchema,
});

const ResumeUploadSchema = z.object({
  uploadId: z.string().min(1),
  userId: z.string().min(1),
  fileName: z.string().min(1),
  fileType: z.string().min(1),
  sizeKB: z.number().min(0),
  status: z.enum(['processing', 'parsed', 'failed']),
  uploadDate: z.date(),
  storagePath: z.string().min(1),
  parsedResumeId: z.string().optional(),
  archived: z.boolean(),
  fileHash: z.string().optional(),
});

const ParsedResumeSchema = z.object({
  parsedResumeId: z.string().min(1),
  userId: z.string().min(1),
  uploadId: z.string().min(1),
  customerId: z.string().optional(),
  agencyId: z.string().optional(),
  fileName: z.string().min(1),
  fileSize: z.number().min(0),
  uploadDate: z.date(),
  // Was omitted while the object always sets it — Zod strips unknown keys,
  // so a passing validation would have silently DROPPED storagePath and
  // broken the duplicate-detection re-read (audit 2026-08-25).
  storagePath: z.string().min(1),
  parsedData: ParsedResumeDataSchema,
  status: z.enum(['processing', 'completed', 'failed']),
  error: z.string().optional(),
  processingTime: z.number().min(0),
});

// Types for resume parsing with versioning support
export interface ResumeUpload {
  uploadId: string;
  userId: string;
  fileName: string;
  fileType: string;
  sizeKB: number;
  status: 'processing' | 'parsed' | 'failed';
  uploadDate: Date;
  storagePath: string;
  parsedResumeId?: string;
  archived: boolean;
  fileHash?: string; // For duplicate detection
}

export interface ParsedResume {
  parsedResumeId: string;
  userId: string;
  uploadId: string;
  customerId?: string;
  agencyId?: string;
  fileName: string;
  fileSize: number;
  uploadDate: Date;
  storagePath: string;
  parsedData: {
    contact: ContactInfo;
    summary: string;
    bio?: string;
    skills: Skill[];
    education: Education[];
    experience: WorkExperience[];
    certifications: Certification[];
    languages: Language[];
    projects: Project[];
    awards: Award[];
    volunteerWork: VolunteerWork[];
    parsedText: string;
    confidence: number;
    aiAnalysis: AIAnalysis;
  };
  status: 'processing' | 'completed' | 'failed';
  error?: string;
  processingTime: number;
}

export interface ContactInfo {
  name: string;
  email: string;
  phone: string;
  address: string;
  linkedin?: string;
  website?: string;
}

export interface Skill {
  name: string;
  canonicalId?: string; // Reference to HRX predefined list
  source: 'predefined' | 'custom';
  category: 'technical' | 'soft' | 'language' | 'certification' | 'other';
  level?: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  yearsOfExperience?: number;
  confidence: number;
}

export interface Education {
  institution: string;
  degree: string;
  field: string;
  startDate: string;
  endDate: string;
  gpa?: string;
  honors?: string;
  location?: string;
}

export interface WorkExperience {
  jobTitle: string;
  company: string;
  location: string;
  startDate: string;
  endDate: string;
  current: boolean;
  description: string;
  responsibilities: string[];
  achievements: string[];
  skillsUsed: string[];
}

export interface Certification {
  name: string;
  issuer: string;
  dateObtained: string;
  expiryDate?: string;
  credentialId?: string;
}

export interface Language {
  language: string;
  proficiency: 'basic' | 'conversational' | 'fluent' | 'native';
  isNative: boolean;
}

export interface Project {
  name: string;
  description: string;
  technologies: string[];
  startDate: string;
  endDate: string;
  url?: string;
}

export interface Award {
  name: string;
  issuer: string;
  date: string;
  description: string;
}

export interface VolunteerWork {
  organization: string;
  role: string;
  startDate: string;
  endDate: string;
  description: string;
}

export interface AIAnalysis {
  overallScore: number;
  skillGaps: string[];
  recommendations: string[];
  marketability: number;
  yearsOfExperience: number;
  educationLevel: string;
  keyStrengths: string[];
  areasForImprovement: string[];
  jobFit: {
    [jobTitle: string]: number;
  };
}

// Skill categories and keywords for classification
// Remove: const SKILL_CATEGORIES = { ... }

// Education level mapping
// Remove: const EDUCATION_LEVELS = { ... }

/**
 * Generate unique upload ID
 */
function generateUploadId(): string {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '_');
  const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '');
  return `${dateStr}_${timeStr}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Calculate file hash for duplicate detection
 */
function calculateFileHash(buffer: Buffer): string {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Archive previous resumes when uploading new one
 */
async function archivePreviousResumes(userId: string, newUploadId: string): Promise<void> {
  const uploadsRef = db.collection('resumeUploads').doc(userId);
  const uploadsSnapshot = await uploadsRef.collection('uploads').where('archived', '==', false).get();
  
  const batch = db.batch();
  uploadsSnapshot.docs.forEach(doc => {
    if (doc.id !== newUploadId) {
      batch.update(doc.ref, { archived: true });
    }
  });
  
  if (!uploadsSnapshot.empty) {
    await batch.commit();
  }
}

/**
 * Generate a stable download URL for resume files (no IAM signBlob).
 */
async function generateResumeDownloadUrl(storagePath: string): Promise<string> {
  try {
    console.log('generateResumeDownloadUrl called with storagePath:', storagePath);
    const url = await getOrCreateFirebaseDownloadReadUrl(storagePath);
    console.log('Generated Firebase download URL successfully');
    return url;
  } catch (error) {
    console.error('Failed to generate resume download URL:', {
      error,
      storagePath,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

/** Map parser `experience` rows to profile `workExperience` / `workHistory` shape. */
function mapExperienceToWorkExperience(rows: unknown): Record<string, unknown>[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((exp: any) => ({
      jobTitle: String(exp?.jobTitle || exp?.title || '').trim(),
      company: String(exp?.company || '').trim(),
      location: String(exp?.location || '').trim(),
      startDate: String(exp?.startDate || '').trim(),
      endDate: String(exp?.endDate || '').trim(),
      current: Boolean(exp?.current),
      description: String(exp?.description || '').trim(),
      responsibilities: Array.isArray(exp?.responsibilities) ? exp.responsibilities : [],
      achievements: Array.isArray(exp?.achievements) ? exp.achievements : [],
      skillsUsed: Array.isArray(exp?.skillsUsed) ? exp.skillsUsed : [],
    }))
    .filter((row) => row.jobTitle || row.company);
}

function normalizeSkillsForUser(skills: unknown): Array<{ name: string; type: string }> {
  if (!Array.isArray(skills)) return [];
  const out: Array<{ name: string; type: string }> = [];
  for (const s of skills) {
    const raw = (s as any)?.name;
    const name = typeof raw === 'string' ? raw.trim() : String(raw || '').trim();
    if (!name) continue;
    const cat = (s as any)?.category ?? (s as any)?.type ?? 'Other';
    out.push({ name, type: String(cat || 'Other') });
  }
  return out;
}

function proficiencyDisplay(p: unknown): string {
  const v = String(p || 'conversational').toLowerCase();
  const map: Record<string, string> = {
    basic: 'Basic',
    conversational: 'Conversational',
    fluent: 'Fluent',
    native: 'Native',
  };
  return map[v] || 'Conversational';
}

/**
 * Only profile fields the app reads — not full parsed blob (parsedText, aiAnalysis, etc.).
 */
function buildUserProfileMergePatch(
  mergedData: Record<string, any>,
  existingUser: Record<string, any> = {},
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const normName = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  const bioText = [mergedData.bio, mergedData.summary].find(
    (x) => typeof x === 'string' && x.trim().length > 0
  ) as string | undefined;
  if (bioText) {
    const t = bioText.trim();
    patch.professionalBio = t;
    patch.bio = t;
  }

  const workExp = mapExperienceToWorkExperience(mergedData.experience);
  if (workExp.length > 0) {
    // employmentHistory (a third identical copy) retired 2026-08-25 — its only
    // readers fall back to workHistory first.
    patch.workExperience = workExp;
    patch.workHistory = workExp;
  }

  if (Array.isArray(mergedData.education) && mergedData.education.length > 0) {
    patch.education = mergedData.education;
  }

  // Skills: same additive rule — existing entries keep their richer shape
  // (canonicalId/source/confidence from admin SkillsTab); resume adds new ones.
  const skills = normalizeSkillsForUser(mergedData.skills);
  if (skills.length > 0) {
    const existingSkills: any[] = Array.isArray(existingUser.skills) ? existingUser.skills : [];
    const existingSkillNames = new Set(
      existingSkills
        .map((sk: any) => normName(typeof sk === 'string' ? sk : sk?.name))
        .filter(Boolean),
    );
    const newSkills = skills.filter((sk: any) => !existingSkillNames.has(normName(sk?.name ?? sk)));
    if (existingSkills.length === 0) {
      patch.skills = skills;
    } else if (newSkills.length > 0) {
      patch.skills = [...existingSkills, ...newSkills];
    }
  }

  // Certifications: ADDITIVE merge (2026-08-25 audit defect #2). The old code
  // wholesale-replaced the array, destroying user-uploaded evidence
  // (fileUrl/fileName/expirationDate from the wizard's cert upload) and
  // fabricating dateObtained = today when the resume stated none. Existing
  // entries are preserved verbatim; only genuinely new names are appended.
  if (Array.isArray(mergedData.certifications) && mergedData.certifications.length > 0) {
    const existingCerts: any[] = Array.isArray(existingUser.certifications)
      ? existingUser.certifications
      : [];
    const existingNames = new Set(
      existingCerts
        .map((c: any) => normName(typeof c === 'string' ? c : c?.name))
        .filter(Boolean),
    );
    const newCerts = mergedData.certifications
      .map((c: any) => {
        const entry: Record<string, string> = {
          name: String(c?.name || '').trim(),
          issuer: String(c?.issuer || '').trim() || 'Unknown',
          credentialId: String(c?.credentialId || '').trim(),
        };
        const dateObtained = String(c?.dateObtained || '').trim();
        if (dateObtained) entry.dateObtained = dateObtained;
        return entry;
      })
      .filter((c: any) => c.name && !existingNames.has(normName(c.name)));
    if (newCerts.length > 0) {
      patch.certifications = [...existingCerts, ...newCerts];
    }
  }

  if (Array.isArray(mergedData.languages) && mergedData.languages.length > 0) {
    patch.languages = mergedData.languages
      .map((lang: any) => ({
        language: String(lang?.language || '').trim(),
        proficiency: proficiencyDisplay(lang?.proficiency),
        isNative: Boolean(lang?.isNative),
      }))
      .filter((l: any) => l.language);
  }

  const analysis = mergedData.aiAnalysis;
  if (analysis && typeof analysis === 'object') {
    const y = (analysis as any).yearsOfExperience;
    if (typeof y === 'number' && Number.isFinite(y)) {
      patch.yearsExperience = y;
    } else if (typeof y === 'string' && y.trim()) {
      const n = parseFloat(y);
      if (!Number.isNaN(n)) patch.yearsExperience = n;
    }
    const el = (analysis as any).educationLevel;
    if (typeof el === 'string' && el.trim()) {
      patch.educationLevel = el.trim();
    }
  }

  patch.updatedAt = new Date();
  return patch;
}

/**
 * CORS: static list + optional RESUME_PARSE_ALLOWED_ORIGINS (comma-separated) + *.hrxone.com + localhost ports.
 */
function pickCorsOrigin(requestOrigin: string | undefined): string {
  const o = (requestOrigin || '').trim();
  const defaults = new Set([
    'http://localhost:3000',
    'https://hrxone.com',
    'https://www.hrxone.com',
  ]);
  const extra = (process.env.RESUME_PARSE_ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  extra.forEach((e) => defaults.add(e));
  if (o && defaults.has(o)) return o;
  if (o && /^https:\/\/([a-z0-9-]+\.)*hrxone\.com$/i.test(o)) return o;
  if (o && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/i.test(o)) return o;
  return 'https://hrxone.com';
}

/**
 * Commit merge with atomic batch writes
 */
async function commitMerge(uid: string, uploadId: string, acceptedChanges: any = {}): Promise<void> {
  const batch = db.batch();
  
  // Get parsed resume data
  const parsedResumeRef = db.collection('parsedResumes').doc(uploadId);
  const parsedResumeDoc = await parsedResumeRef.get();
  
  if (!parsedResumeDoc.exists) {
    throw new Error('Parsed resume not found');
  }
  
  const parsedResume = parsedResumeDoc.data() as ParsedResume;
  const parsedData = parsedResume.parsedData;
  
  // Apply accepted changes with confidence-based merging
  const mergedData = await applyConfidenceBasedMerge(parsedData, acceptedChanges);

  const existingUserSnap = await db.collection('users').doc(uid).get();
  const existingUserData = (existingUserSnap.data() ?? {}) as Record<string, any>;
  const userProfilePatch = buildUserProfileMergePatch(mergedData as Record<string, any>, existingUserData);
  if (Object.keys(userProfilePatch).length <= 1 && userProfilePatch.updatedAt) {
    console.warn('commitMerge: no profile fields to merge beyond updatedAt; parsed data may be empty');
  }

  // Update user profile — mapped fields only (not parsedText / aiAnalysis / experience key)
  const userRef = db.collection('users').doc(uid);
  batch.update(userRef, userProfilePatch);
  
  // Update merge proposal
  const mergeProposalRef = db.collection('mergeProposals').doc(`${uid}_${uploadId}`);
  batch.set(mergeProposalRef, {
    uploadId,
    userId: uid,
    acceptedChanges,
    rejectedChanges: {},
    confidenceThreshold: 0.8,
    createdAt: new Date(),
    reviewedAt: new Date()
  });
  
  // Log merge action
  const logRef = db.collection('logs').doc('resume-merge').collection('logs').doc();
  batch.set(logRef, {
    uploadId,
    userId: uid,
    changesCount: Object.keys(acceptedChanges).length,
    confidenceScores: typeof (parsedData as any)?.confidence === 'number' ? [(parsedData as any).confidence] : [],
    timestamp: new Date()
  });
  
  await batch.commit();

  try {
    await maybeEmitResumeUploadedCategoryScore(db, { uid, uploadId });
  } catch (e) {
    console.warn('commitMerge.activity_category_score_failed', {
      uid,
      uploadId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * Apply confidence-based merging
 */
async function applyConfidenceBasedMerge(parsedData: any, acceptedChanges: any): Promise<any> {
  const mergedData: any = {};
  
  // Merge all parsed data directly (AI extraction results)
  Object.entries(parsedData).forEach(([key, value]: [string, any]) => {
    if (value !== null && value !== undefined) {
      mergedData[key] = value;
    }
  });
  
  // Apply user-accepted changes (override any conflicting fields)
  Object.assign(mergedData, acceptedChanges);
  
  return mergedData;
}

/**
 * Core resume parsing logic with versioning
 */
async function parseResumeCore(fileUrl: string, fileName: string, fileSize: number, userId: string): Promise<any> {
  const startTime = Date.now();

  // Claude-backed since 2026-08-21 (same chat.completions call shape —
  // see utils/claudeChat). Throws if ANTHROPIC_API_KEY is unset.
  const openai = getClaudeChat();

  // Hoisted so the catch can mark the REAL upload doc failed (previously the
  // failure path minted a fresh uploadId and wrote a bogus doc with no file).
  let activeUploadId: string | null = null;
  try {
    // Get user info
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'User not found');
    }
    const userData = userDoc.data();
    const customerId = userData?.customerId;
    const agencyId = userData?.agencyId;

    // Generate upload ID and storage path
    const uploadId = generateUploadId();
    activeUploadId = uploadId;
    const storagePath = `resumes/${userId}/${uploadId}.${fileName.split('.').pop()}`;

    // Download and parse the file
    const fileBuffer = await downloadFile(fileUrl);
    const fileHash = calculateFileHash(fileBuffer);
    console.log('File downloaded, size:', fileBuffer.length, 'bytes');

    validateResumeBinaryAgainstExtension(fileBuffer, fileName);
    
    // Upload file to Firebase Storage
    console.log('Uploading file to Firebase Storage at path:', storagePath);
    const bucket = getStorage().bucket(getStorageBucketName());
    const file = bucket.file(storagePath);
    const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
    const resumeMime =
      ext === 'pdf'
        ? 'application/pdf'
        : ext === 'docx'
          ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          : ext === 'doc'
            ? 'application/msword'
            : ext === 'txt'
              ? 'text/plain'
              : 'application/octet-stream';

    await file.save(fileBuffer, {
      metadata: {
        contentType: resumeMime,
        metadata: {
          originalName: fileName,
          userId: userId,
          uploadId: uploadId
        }
      }
    });

    // Token-based download URL (works with uniform bucket-level access; avoid makePublic ACL errors)
    const resumeDownloadUrl = await generateResumeDownloadUrl(storagePath);
    console.log('Resume stored; download URL created (token-based)');
    
    // Store the storage path and public URL
    console.log('Resume uploaded to storage path:', storagePath);
    
    // Check for duplicate files
    const existingUploads = await db.collection('resumeUploads').doc(userId)
      .collection('uploads').where('fileHash', '==', fileHash).get();
    
    console.log('Checking for duplicates, found:', existingUploads.size, 'existing uploads');
    
    if (!existingUploads.empty) {
      const existingUpload = existingUploads.docs[0].data() as ResumeUpload;
      console.log('Duplicate file detected:', existingUpload.uploadId, 'parsedResumeId:', existingUpload.parsedResumeId);
      
      // If the existing upload has a parsed resume, fetch it
      if (existingUpload.parsedResumeId) {
        const parsedResumeDoc = await db.collection('parsedResumes').doc(existingUpload.parsedResumeId).get();
        if (parsedResumeDoc.exists) {
          const parsedResume = parsedResumeDoc.data() as ParsedResume;
          console.log('Returning existing parsed data for duplicate file');
          return {
            success: true,
            uploadId: existingUpload.uploadId,
            parsedData: parsedResume.parsedData,
            duplicate: true,
            message: 'Resume already parsed - returning existing results'
          };
        }
      }
      
      // If no parsed data available, continue with parsing (don't skip)
      console.log('Duplicate file found but no parsed data - proceeding with parsing');
    }

    // Archive previous resumes
    await archivePreviousResumes(userId, uploadId);

    // Create upload record
    const uploadRef = db.collection('resumeUploads').doc(userId).collection('uploads').doc(uploadId);
    const resumeUpload = {
      uploadId,
      userId,
      fileName,
      fileType: fileName.split('.').pop() || '',
      sizeKB: Math.round(fileSize / 1024),
      status: 'processing' as const,
      uploadDate: new Date(),
      storagePath,
      archived: false,
      fileHash
    };

    // Validate resume upload data
    const validatedResumeUpload = validateResumeUpload(resumeUpload);
    await uploadRef.set(validatedResumeUpload);

    // Parse file content
    const fileExtension = fileName.toLowerCase().split('.').pop();
    let parsedText = '';
    console.log('File extension:', fileExtension);
    
    switch (fileExtension) {
      case 'pdf':
        parsedText = await parsePDF(fileBuffer);
        break;
      case 'docx':
      case 'doc':
        parsedText = await parseWord(fileBuffer);
        break;
      case 'txt':
        parsedText = fileBuffer.toString('utf-8');
        break;
      case 'jpg':
      case 'jpeg':
      case 'png':
      case 'webp':
      case 'heic':
      case 'heif':
        parsedText = await performOCR(fileBuffer);
        break;
      default:
        throw new functions.https.HttpsError('invalid-argument', 'Unsupported file format');
    }
    
    console.log('Extracted text length:', parsedText.length);
    console.log('Extracted text preview:', parsedText.substring(0, 500));

    // Extract structured data using AI and NLP
    const parsedData = await extractResumeData(parsedText, fileName, openai);

    // Generate enhanced bio from resume summary
    if (parsedData.summary) {
      try {
        console.log('Generating enhanced bio from resume summary...');
        const enhancedBio = await generateEnhancedBio(
          parsedData.summary,
          parsedData.contact?.name || '',
          openai
        );
        if (enhancedBio) {
          parsedData.bio = enhancedBio;
          console.log('Enhanced bio generated:', enhancedBio);
        }
      } catch (error) {
        console.warn('Failed to generate enhanced bio:', error);
        // Fallback to original summary if bio generation fails
        parsedData.bio = parsedData.summary;
      }
    }

    // Create parsed resume record
    // Validate parsed data before saving
    const validatedParsedData = validateParsedResumeData(parsedData);

    const parsedResume: ParsedResume = {
      parsedResumeId: uploadId,
      userId,
      uploadId,
      customerId,
      agencyId,
      fileName,
      fileSize,
      uploadDate: new Date(),
      storagePath,
      parsedData: validatedParsedData,
      status: 'completed',
      processingTime: Date.now() - startTime
    };

    // Validate the complete parsed resume object
    const validatedParsedResume = validateParsedResume(parsedResume);

    // Save to Firestore collections
    console.log('Starting Firestore batch write...');
    const batch = db.batch();
    
    // Update upload record
    console.log('Updating upload record with status: parsed');
    batch.update(uploadRef, {
      status: 'parsed',
      parsedResumeId: uploadId
    });
    
    // Save parsed resume
    console.log('Saving parsed resume to collection');
    const parsedResumeRef = db.collection('parsedResumes').doc(uploadId);
    batch.set(parsedResumeRef, validatedParsedResume);
    
    // Update user profile with single resume object
    console.log('Updating user profile with resume object');
    const userRef = db.collection('users').doc(userId);
    batch.update(userRef, {
      resume: {
        fileName: fileName,
        size: fileSize,
        sizeKB: Math.round(fileSize / 1024),
        timestamp: new Date(),
        storagePath: storagePath,
        downloadUrl: resumeDownloadUrl
      },
      updatedAt: new Date()
    });
    
    // Create merge proposal
    console.log('Creating merge proposal');
    const mergeProposalRef = db.collection('mergeProposals').doc(`${userId}_${uploadId}`);
    batch.set(mergeProposalRef, {
      uploadId,
      userId,
      acceptedChanges: {},
      rejectedChanges: {},
      confidenceThreshold: 0.8,
      createdAt: new Date()
    });
    
    console.log('Committing batch write...');
    await batch.commit();
    console.log('Batch write completed successfully');

    // Auto-merge high confidence data
    console.log('Starting auto-merge...');
    await commitMerge(userId, uploadId);
    console.log('Auto-merge completed');

    // Log AI action
    await logger.aiEvent({
      userId,
      actionType: 'resume_parsed',
      sourceModule: 'ResumeParser',
      success: true,
      latencyMs: Date.now() - startTime,
      versionTag: 'v2',
      reason: `Resume parsed successfully: ${fileName}`,
      eventType: 'profile.resume_parsed',
      targetType: 'resume',
      targetId: uploadId,
      aiRelevant: true,
      contextType: 'profile',
      traitsAffected: null,
      aiTags: ['resume_parsing', 'ai_extraction', 'profile_update', 'versioning'],
      urgencyScore: 5
    });

    return {
      success: true,
      uploadId,
      parsedData
    };

  } catch (error) {
    console.error('Resume parsing error:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      name: error instanceof Error ? error.name : undefined,
      fileName,
      userId,
      fileSize
    });

    if (error instanceof ResumeParseClientError) {
      throw error;
    }
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    
    // Mark the REAL upload doc failed (fall back to a fresh record only when
    // we crashed before the upload doc was created).
    const failedUploadId = activeUploadId ?? generateUploadId();
    const uploadRef = db.collection('resumeUploads').doc(userId).collection('uploads').doc(failedUploadId);
    await uploadRef.set({
      uploadId: failedUploadId,
      userId,
      fileName,
      fileType: fileName.split('.').pop() || '',
      sizeKB: Math.round(fileSize / 1024),
      status: 'failed',
      uploadDate: new Date(),
      archived: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { merge: true });

    throw new Error(`Failed to parse resume: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/** Internal team / admin security levels (per-tenant or global). */
function isElevatedSecurityLevel(sl: unknown): boolean {
  if (sl == null || sl === '') return false;
  const s = String(sl).trim();
  if (s === 'Admin') return true;
  const n = Number.parseInt(s, 10);
  if (Number.isFinite(n) && n >= 5) return true;
  return ['5', '6', '7'].includes(s);
}

/** Caller is internal staff (L5+) for this tenant — same rules as messaging/threadsApi. */
function isInternalStaffForTenant(user: admin.firestore.DocumentData | undefined, tenantId: string): boolean {
  if (!user) return false;
  const u = user as Record<string, unknown>;
  if (u.role === 'HRX') return true;
  if (isElevatedSecurityLevel(u.securityLevel)) return true;
  const tenantIds = u.tenantIds;
  if (tenantIds && typeof tenantIds === 'object' && tenantId in tenantIds) {
    const t = (tenantIds as Record<string, { securityLevel?: string | number }>)[tenantId];
    if (t && isElevatedSecurityLevel(t.securityLevel)) return true;
  }
  return false;
}

/** Target user is a member of the tenant (worker or any role). */
function userBelongsToTenant(user: admin.firestore.DocumentData | undefined, tenantId: string): boolean {
  if (!user) return false;
  const u = user as Record<string, unknown>;
  if (u.tenantId === tenantId || u.activeTenantId === tenantId) return true;
  const tenantIds = u.tenantIds;
  if (Array.isArray(tenantIds) && tenantIds.includes(tenantId)) return true;
  if (tenantIds && typeof tenantIds === 'object' && tenantId in tenantIds) return true;
  return false;
}

/**
 * Self-serve: caller uid === target. Admin: caller is L5+ for tenantId and target user belongs to tenant.
 */
async function canParseResumeForUser(
  callerUid: string,
  targetUserId: string,
  tenantId: string | undefined
): Promise<boolean> {
  if (callerUid === targetUserId) return true;
  if (!tenantId || typeof tenantId !== 'string' || !tenantId.trim()) return false;

  const tid = tenantId.trim();
  const [callerSnap, targetSnap] = await Promise.all([
    db.collection('users').doc(callerUid).get(),
    db.collection('users').doc(targetUserId).get(),
  ]);
  const caller = callerSnap.exists ? callerSnap.data() : undefined;
  const target = targetSnap.exists ? targetSnap.data() : undefined;
  if (!isInternalStaffForTenant(caller, tid)) return false;
  if (!userBelongsToTenant(target, tid)) return false;
  return true;
}

// HTTP wrapper for parseResume to support localhost development with proper CORS
export const parseResumeHttp = onRequest({
  cors: true,
  timeoutSeconds: 540,
  memory: '1GiB',
  maxInstances: 5
}, async (req, res) => {
  const requestOrigin = (req.headers.origin as string) || '';
  const corsOrigin = pickCorsOrigin(requestOrigin);

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Origin', corsOrigin);
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Max-Age', '3600');
    res.set('Vary', 'Origin');
    res.status(204).send('');
    return;
  }

  try {
    // Verify authentication
    if (!req.headers.authorization) {
      res.set('Access-Control-Allow-Origin', corsOrigin);
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // Extract token and verify
    const token = req.headers.authorization.replace('Bearer ', '');
    const decodedToken = await admin.auth().verifyIdToken(token);
    
    const { fileUrl, fileName, fileSize, userId, tenantId } = req.body || {};
    
    if (!fileUrl || !fileName || !userId) {
      res.set('Access-Control-Allow-Origin', corsOrigin);
      res.status(400).json({ error: 'Missing required parameters: fileUrl, fileName, userId' });
      return;
    }

    // Self-upload OR internal staff (L5+) parsing on behalf of a worker in the same tenant
    const allowed = await canParseResumeForUser(decodedToken.uid, userId, tenantId);
    if (!allowed) {
      res.set('Access-Control-Allow-Origin', corsOrigin);
      res.status(403).json({ error: 'Unauthorized to parse resume for this user' });
      return;
    }

    // Call the core parseResume logic
    const result = await parseResumeCore(fileUrl, fileName, fileSize, userId);
    
    res.set('Access-Control-Allow-Origin', corsOrigin);
    res.status(200).json(result);
  } catch (error: any) {
    console.error('parseResumeHttp error:', error);
    res.set('Access-Control-Allow-Origin', corsOrigin);

    if (error instanceof ResumeParseClientError) {
      res.status(400).json({
        error: error.message,
        code: error.code,
      });
      return;
    }

    if (error instanceof functions.https.HttpsError) {
      const map: Record<string, number> = {
        'invalid-argument': 400,
        'not-found': 404,
        'permission-denied': 403,
        'failed-precondition': 400,
      };
      const status = map[error.code] ?? 400;
      res.status(status).json({
        error: error.message,
        code: error.code,
      });
      return;
    }

    res.status(500).json({
      error: error?.message || 'Failed to parse resume',
      code: error?.code || 'internal',
    });
  }
});

/**
 * Download file from URL
 */
async function downloadFile(fileUrl: string): Promise<Buffer> {
  const response = await fetch(fileUrl);
  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Parse PDF file with OCR fallback for scanned documents
 */
async function parsePDF(buffer: Buffer): Promise<string> {
  try {
    // First try standard PDF parsing
    const data = await pdfParse(buffer);
    
    // Check if we got meaningful text (more than just whitespace and minimal content)
    const text = data.text.trim();
    const wordCount = text.split(/\s+/).filter(word => word.length > 0).length;
    
    // If we have less than 10 meaningful words, likely a scanned PDF
    if (wordCount < 10) {
      console.log('PDF appears to be scanned, attempting OCR...');
      return await performOCR(buffer);
    }
    
    return text;
  } catch (error) {
    console.log('Standard PDF parsing failed, attempting OCR fallback...', error);
    // If standard parsing fails, try OCR
    try {
      return await performOCR(buffer);
    } catch (ocrError) {
      throw new Error(`Both PDF parsing and OCR failed. PDF: ${error instanceof Error ? error.message : 'Unknown error'}, OCR: ${ocrError instanceof Error ? ocrError.message : 'Unknown error'}`);
    }
  }
}

/**
 * Perform OCR on PDF/image using Google Cloud Vision
 */
async function performOCR(buffer: Buffer): Promise<string> {
  try {
    const client = new vision.ImageAnnotatorClient();
    
    // Convert buffer to base64 for Vision API
    const base64Image = buffer.toString('base64');
    
    const [result] = await client.textDetection({
      image: {
        content: base64Image
      }
    });
    
    const detections = result.textAnnotations;
    if (!detections || detections.length === 0) {
      throw new Error('No text detected in image');
    }
    
    // The first detection contains all text
    const fullText = detections[0].description || '';
    
    if (fullText.trim().length < 10) {
      throw new Error('OCR detected minimal text, likely not a readable document');
    }
    
    console.log(`OCR extracted ${fullText.length} characters`);
    return fullText;
  } catch (error) {
    throw new Error(`OCR failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Parse Word document
 */
async function parseWord(buffer: Buffer): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const lower = msg.toLowerCase();
    if (
      lower.includes('could not find the body element') ||
      lower.includes('are you sure this is a docx') ||
      lower.includes('invalid zip')
    ) {
      throw new ResumeParseClientError(
        'This file could not be read as a Word document (.docx). It may be corrupted, password-protected, not actually a Word file, or an older .doc format. Save As .docx from Microsoft Word or upload a PDF.',
        'word_parse_invalid_ooxml',
      );
    }
    throw new Error(`Word document parsing failed: ${msg}`);
  }
}

/**
 * Extract structured data from resume text using AI and NLP
 */
async function extractResumeData(text: string, fileName: string, openai: ChatClientLike): Promise<ParsedResume['parsedData']> {
  // Clean and preprocess text
  const cleanedText = preprocessText(text);
  
  // Use AI to extract structured information
  const aiExtraction = await extractWithAI(cleanedText, openai);
  console.log('AI Extraction result:', JSON.stringify(aiExtraction, null, 2));
  
  // Use NLP for additional extraction and validation
  const nlpExtraction = extractWithNLP(cleanedText);
  console.log('NLP Extraction result:', JSON.stringify(nlpExtraction, null, 2));
  
  // Merge and validate results
  const mergedData = mergeExtractions(aiExtraction, nlpExtraction);
  console.log('Merged data result:', JSON.stringify(mergedData, null, 2));
  
  // Analysis scalars now come from the extraction call itself (2026-08-25):
  // the dedicated generateAIAnalysis LLM call was ~1/3 of per-resume spend and
  // produced scores/jobFit nothing ever read — only yearsOfExperience and
  // educationLevel reached the user doc.
  const yearsRaw = (aiExtraction as Record<string, unknown>)?.yearsOfExperience;
  const yearsNum = typeof yearsRaw === 'number' ? yearsRaw : parseFloat(String(yearsRaw ?? ''));
  const aiAnalysis: AIAnalysis = {
    overallScore: 0,
    skillGaps: [],
    recommendations: [],
    marketability: 0,
    yearsOfExperience: Number.isFinite(yearsNum) ? yearsNum : 0,
    educationLevel: String((aiExtraction as Record<string, unknown>)?.educationLevel ?? '').trim(),
    keyStrengths: [],
    areasForImprovement: [],
    jobFit: {}
  };

  return {
    ...mergedData,
    parsedText: cleanedText,
    confidence: calculateConfidence(mergedData),
    aiAnalysis
  };
}

/**
 * Preprocess resume text
 */
function preprocessText(text: string): string {
  // Remove extra whitespace and normalize
  let cleaned = text.replace(/\s+/g, ' ').trim();
  
  // Remove common resume artifacts
  cleaned = cleaned.replace(/Page \d+ of \d+/gi, '');
  cleaned = cleaned.replace(/Confidential|Private|Resume/gi, '');
  
  // Normalize dates
  cleaned = cleaned.replace(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/g, '$1/$2/$3');
  
  return cleaned;
}

/**
 * Extract information using OpenAI
 */
async function extractWithAI(text: string, openai: ChatClientLike) {
  const prompt = `
Extract structured information from this resume. Return a JSON object with the following structure:

{
  "contact": {
    "name": "Full name",
    "email": "Email address",
    "phone": "Phone number",
    "address": "Full address",
    "linkedin": "LinkedIn URL if present",
    "website": "Personal website if present"
  },
  "summary": "Professional summary or objective",
  "skills": [
    {
      "name": "Skill name",
      "category": "technical|soft|language|certification|other",
      "level": "beginner|intermediate|advanced|expert",
      "yearsOfExperience": "Number of years if mentioned"
    }
  ],
  "education": [
    {
      "institution": "School/University name",
      "degree": "Degree type",
      "field": "Field of study",
      "startDate": "Start date (MM/YYYY)",
      "endDate": "End date (MM/YYYY) or 'Present'",
      "gpa": "GPA if mentioned",
      "honors": "Honors or awards",
      "location": "Location"
    }
  ],
  "experience": [
    {
      "jobTitle": "Job title",
      "company": "Company name",
      "location": "Location",
      "startDate": "Start date (MM/YYYY)",
      "endDate": "End date (MM/YYYY) or 'Present'",
      "current": "true if current job",
      "description": "Job description",
      "responsibilities": ["List of responsibilities"],
      "achievements": ["List of achievements"],
      "skillsUsed": ["Skills used in this role"]
    }
  ],
  "certifications": [
    {
      "name": "Certification name",
      "issuer": "Issuing organization",
      "dateObtained": "Date obtained (MM/YYYY)",
      "expiryDate": "Expiry date if applicable",
      "credentialId": "Credential ID if mentioned"
    }
  ],
  "languages": [
    {
      "language": "Language name",
      "proficiency": "basic|conversational|fluent|native",
      "isNative": "true if native speaker"
    }
  ],
  "projects": [
    {
      "name": "Project name",
      "description": "Project description",
      "technologies": ["Technologies used"],
      "startDate": "Start date",
      "endDate": "End date",
      "url": "Project URL if available"
    }
  ],
  "awards": [
    {
      "name": "Award name",
      "issuer": "Issuing organization",
      "date": "Date received",
      "description": "Award description"
    }
  ],
  "volunteerWork": [
    {
      "organization": "Organization name",
      "role": "Volunteer role",
      "startDate": "Start date",
      "endDate": "End date",
      "description": "Description of volunteer work"
    }
  ],
  "yearsOfExperience": "Estimated total years of professional experience as a number",
  "educationLevel": "Highest education level attained (e.g. High School, Associate, Bachelor, Master, Doctorate), or empty string if unclear"
}

Resume text:
${text.substring(0, 12000)}
`;

  const attemptExtraction = async () => {
    const extractionModel = process.env.RESUME_EXTRACTION_MODEL || 'gpt-4o-mini';
    const jsonMode = /gpt-4o|gpt-4-turbo|o1|o3|gpt-5/i.test(extractionModel);
    const completion = await openai.chat.completions.create({
      model: extractionModel,
      messages: [
        {
          role: "system",
          content:
            'You are an expert resume parser. Extract structured information accurately and return a single valid JSON object only (no markdown).'
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.1,
      max_completion_tokens: 8192,
      ...(jsonMode ? { response_format: { type: 'json_object' as const } } : {})
    });

    const response = completion.choices[0]?.message?.content;
    console.log('AI response length:', response?.length || 0);
    if (!response) {
      throw new Error('No response from AI');
    }
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('No JSON found in AI response. Full response:', response.substring(0, 500));
      throw new Error('No JSON found in AI response');
    }
    return JSON.parse(jsonMatch[0]);
  };

  // One bounded retry, then FAIL LOUD. The old catch returned an all-empty
  // structure, so a failed extraction surfaced as "parsed successfully!" with
  // a blank profile (2026-08-25 audit, defect #1).
  try {
    console.log('Starting AI extraction (attempt 1)...');
    return await attemptExtraction();
  } catch (firstError) {
    console.warn('AI extraction attempt 1 failed, retrying once:', firstError instanceof Error ? firstError.message : firstError);
    try {
      return await attemptExtraction();
    } catch (secondError) {
      console.error('AI extraction failed after retry:', secondError);
      throw new ResumeParseClientError(
        "We couldn't read this resume. Please try a clearer PDF or photo — or skip this step and add it later."
      );
    }
  }
}

/**
 * Extract information using NLP
 */
function extractWithNLP(text: string) {
  const doc = nlp(text);
  
  // Extract names
  const names = doc.people().out('array');
  
  // Extract emails
  const emails = doc.emails().out('array');
  
  // Extract phone numbers
  // const phones = doc.phones().out('array'); // Not supported by compromise
  const phones: string[] = [];
  
  // Extract dates
  // const dates = doc.dates().out('array'); // Not supported by compromise
  const dates: string[] = [];
  
  // Extract organizations
  const organizations = doc.organizations().out('array');
  
  // Extract skills using keyword matching
  const skills = extractSkillsFromText(text);
  
  // Extract education using patterns
  const education = extractEducationFromText(text);
  
  return {
    contact: {
      name: names[0] || '',
      email: emails[0] || '',
      phone: phones[0] || '',
      address: '',
      linkedin: '',
      website: ''
    },
    skills,
    education,
    organizations,
    dates
  };
}

/**
 * Extract skills from text using keyword matching
 */
function extractSkillsFromText(text: string): Skill[] {
  const skills: Skill[] = [];
  
  // Common technical skills
  const technicalSkills = [
    'javascript', 'python', 'java', 'c++', 'c#', 'php', 'ruby', 'go', 'rust',
    'react', 'angular', 'vue', 'node.js', 'express', 'django', 'flask',
    'mysql', 'postgresql', 'mongodb', 'redis', 'elasticsearch',
    'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'jenkins',
    'git', 'svn', 'agile', 'scrum', 'kanban', 'jira', 'confluence'
  ];
  
  // Common soft skills
  const softSkills = [
    'leadership', 'communication', 'teamwork', 'problem solving', 'critical thinking',
    'creativity', 'adaptability', 'time management', 'organization', 'collaboration',
    'negotiation', 'presentation', 'mentoring', 'project management'
  ];
  
  // Check for technical skills
  technicalSkills.forEach(skill => {
    if (text.toLowerCase().includes(skill)) {
      skills.push({
        name: skill,
        canonicalId: skill, // Use skill name as canonical ID for predefined skills
        source: 'predefined',
        category: 'technical',
        confidence: 0.8
      });
    }
  });
  
  // Check for soft skills
  softSkills.forEach(skill => {
    if (text.toLowerCase().includes(skill)) {
      skills.push({
        name: skill,
        canonicalId: skill, // Use skill name as canonical ID for predefined skills
        source: 'predefined',
        category: 'soft',
        confidence: 0.7
      });
    }
  });
  
  return skills;
}

/**
 * Extract education from text using patterns
 */
function extractEducationFromText(text: string): Education[] {
  const education: Education[] = [];
  const lines = text.split('\n');
  
  const educationKeywords = ['university', 'college', 'school', 'institute', 'academy'];
  const degreeKeywords = ['bachelor', 'master', 'phd', 'doctorate', 'associate', 'diploma'];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toLowerCase();
    
    // Check if line contains education keywords
    const hasEducationKeyword = educationKeywords.some(keyword => line.includes(keyword));
    const hasDegreeKeyword = degreeKeywords.some(keyword => line.includes(keyword));
    
    if (hasEducationKeyword || hasDegreeKeyword) {
      // Try to extract education information from this line and surrounding lines
      const eduInfo = extractEducationInfo(lines, i);
      if (eduInfo) {
        education.push(eduInfo);
      }
    }
  }
  
  return education;
}

/**
 * Extract education information from a specific line and context
 */
function extractEducationInfo(lines: string[], index: number): Education | null {
  const currentLine = lines[index];
  
  // Simple pattern matching - this could be enhanced with more sophisticated NLP
  const institutionMatch = currentLine.match(/([A-Z][A-Za-z\s&]+(?:University|College|School|Institute|Academy))/);
  const degreeMatch = currentLine.match(/(Bachelor|Master|PhD|Doctorate|Associate|Diploma)/i);
  
  if (institutionMatch) {
    return {
      institution: institutionMatch[1].trim(),
      degree: degreeMatch ? degreeMatch[1] : '',
      field: '',
      startDate: '',
      endDate: '',
      gpa: '',
      honors: '',
      location: ''
    };
  }
  
  return null;
}

/**
 * Merge AI and NLP extractions
 */
function mergeExtractions(aiExtraction: any, nlpExtraction: any) {
  const ac = aiExtraction?.contact && typeof aiExtraction.contact === 'object' ? aiExtraction.contact : {};
  const nc = nlpExtraction?.contact && typeof nlpExtraction.contact === 'object' ? nlpExtraction.contact : {};
  const contact = {
    ...nc,
    ...ac,
    name: ac.name || nc.name || '',
    email: ac.email || nc.email || '',
    phone: ac.phone || nc.phone || '',
    address: ac.address || nc.address || '',
    linkedin: ac.linkedin || nc.linkedin,
    website: ac.website || nc.website
  };
  
  // Merge skills (avoid duplicates)
  const skillsMap = new Map<string, any>();
  [...(aiExtraction.skills || []), ...(nlpExtraction.skills || [])].forEach((skill: any) => {
    const rawName = skill?.name;
    const name = typeof rawName === 'string' ? rawName.trim() : String(rawName || '').trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (!skillsMap.has(key)) {
      skillsMap.set(key, { ...skill, name });
    }
  });
  const skills = Array.from(skillsMap.values());
  
  // Merge education (avoid duplicates)
  const educationMap = new Map<string, any>();
  [...(aiExtraction.education || []), ...(nlpExtraction.education || [])].forEach((edu: any) => {
    const rawInst = edu?.institution;
    const inst = typeof rawInst === 'string' ? rawInst.trim() : String(rawInst || '').trim();
    if (!inst) return;
    const key = inst.toLowerCase();
    if (!educationMap.has(key)) {
      educationMap.set(key, { ...edu, institution: inst });
    }
  });
  const education = Array.from(educationMap.values());
  
  return {
    contact,
    summary: aiExtraction.summary || '',
    skills,
    education,
    experience: aiExtraction.experience || [],
    certifications: aiExtraction.certifications || [],
    languages: aiExtraction.languages || [],
    projects: aiExtraction.projects || [],
    awards: aiExtraction.awards || [],
    volunteerWork: aiExtraction.volunteerWork || []
  };
}

/**
 * Calculate confidence score for parsed data
 */
function calculateConfidence(parsedData: any): number {
  let score = 0;
  let total = 0;
  
  // Contact information completeness
  const contactFields = ['name', 'email', 'phone'];
  contactFields.forEach(field => {
    total++;
    if (parsedData.contact[field]) score++;
  });
  
  // Skills found
  total++;
  if (parsedData.skills.length > 0) score += Math.min(parsedData.skills.length / 10, 1);
  
  // Education found
  total++;
  if (parsedData.education.length > 0) score += Math.min(parsedData.education.length / 3, 1);
  
  // Experience found
  total++;
  if (parsedData.experience.length > 0) score += Math.min(parsedData.experience.length / 5, 1);
  
  return score / total;
}

/**
 * Generate an enhanced bio from resume summary using AI
 */
async function generateEnhancedBio(summary: string, name: string, openai: ChatClientLike): Promise<string> {
  const prompt = `
Transform this resume summary/objective into an engaging, professional bio for a user profile. The bio should be:

1. More conversational and engaging than a formal resume summary
2. Written in first person (using "I" instead of third person)
3. Highlight key achievements and strengths
4. Be 2-3 sentences long, concise but impactful
5. Sound natural and personal, like someone describing themselves
6. Remove overly formal resume language

Original resume summary:
"${summary}"

Generate a compelling bio that captures the essence of this professional's story and value proposition.
`;

  try {
    const bioModel = process.env.RESUME_BIO_MODEL || 'gpt-4o-mini';
    const completion = await openai.chat.completions.create({
      model: bioModel,
      messages: [
        {
          role: "system",
          content: "You are an expert at writing compelling professional bios. Transform resume summaries into engaging, first-person bios that sound natural and highlight key strengths."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.7,
      max_completion_tokens: 400
    });

    const response = completion.choices[0]?.message?.content;
    if (!response) {
      throw new Error('No response from AI bio generation');
    }

    // Clean up the response (remove quotes if present)
    let bio = response.trim();
    if (bio.startsWith('"') && bio.endsWith('"')) {
      bio = bio.slice(1, -1);
    }

    console.log('Generated enhanced bio:', bio);
    return bio;
  } catch (error) {
    console.error('AI bio generation failed:', error);
    throw error;
  }
}

/** @see ./getUserParsedResumes.ts — moved out of this module to avoid loading heavy deps for a small callable. */