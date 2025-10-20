import * as functions from 'firebase-functions';
import { onRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import nlp from 'compromise';
import OpenAI from 'openai';
import { z } from 'zod';

// Add at the top for missing types
// @ts-ignore
const pdfParse = require('pdf-parse');
// @ts-ignore
const mammoth = require('mammoth');

// Google Cloud Vision for OCR
const vision = require('@google-cloud/vision');

const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

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

// Zod schemas for validation
const ContactInfoSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  linkedin: z.string().url().optional(),
  website: z.string().url().optional(),
});

const SkillSchema = z.object({
  name: z.string().min(1),
  canonicalId: z.string().optional(),
  source: z.enum(['predefined', 'custom']),
  category: z.enum(['technical', 'soft', 'language', 'certification', 'other']),
  level: z.enum(['beginner', 'intermediate', 'advanced', 'expert']).optional(),
  yearsOfExperience: z.number().min(0).optional(),
  confidence: z.number().min(0).max(1),
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
  current: z.boolean().optional(),
  description: z.string().optional(),
  responsibilities: z.array(z.string()).optional(),
  achievements: z.array(z.string()).optional(),
  skillsUsed: z.array(z.string()).optional(),
});

const CertificationSchema = z.object({
  name: z.string().min(1),
  issuer: z.string().min(1),
  dateObtained: z.string().optional(),
  expiryDate: z.string().optional(),
  credentialId: z.string().optional(),
});

const LanguageSchema = z.object({
  language: z.string().min(1),
  proficiency: z.enum(['basic', 'conversational', 'fluent', 'native']),
  isNative: z.boolean().optional(),
});

const ProjectSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  technologies: z.array(z.string()).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  url: z.string().url().optional(),
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
  overallScore: z.number().min(1).max(10),
  skillGaps: z.array(z.string()),
  recommendations: z.array(z.string()),
  marketability: z.number().min(1).max(10),
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
  parsedData: ParsedResumeDataSchema,
  status: z.enum(['processing', 'completed', 'failed']),
  error: z.string().optional(),
  processingTime: z.number().min(0),
  mergeProposal: z.object({
    uploadId: z.string(),
    userId: z.string(),
    acceptedChanges: z.any(),
    rejectedChanges: z.any(),
    confidenceThreshold: z.number().min(0).max(1),
    createdAt: z.date(),
    reviewedAt: z.date().optional(),
  }).optional(),
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
  mergeProposal?: MergeProposal;
}

export interface MergeProposal {
  uploadId: string;
  userId: string;
  acceptedChanges: any;
  rejectedChanges: any;
  confidenceThreshold: number;
  createdAt: Date;
  reviewedAt?: Date;
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
 * Geocode an address string to get coordinates
 */
async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${process.env.GOOGLE_MAPS_API_KEY}`);
    const data = await response.json();
    
    if (data.status === 'OK' && data.results && data.results.length > 0) {
      const location = data.results[0].geometry.location;
      return {
        lat: location.lat,
        lng: location.lng
      };
    }
    
    return null;
  } catch (error) {
    console.error('Geocoding failed:', error);
    return null;
  }
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
 * Generate a signed URL for resume download
 */
async function generateResumeDownloadUrl(storagePath: string): Promise<string> {
  try {
    console.log('generateResumeDownloadUrl called with storagePath:', storagePath);
    const bucket = admin.storage().bucket();
    const file = bucket.file(storagePath);
    
    // Check if file exists first
    const [exists] = await file.exists();
    console.log('File exists check:', exists);
    
    if (!exists) {
      throw new Error(`File does not exist at path: ${storagePath}`);
    }
    
    // Generate a signed URL that expires in 1 year
    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 365 * 24 * 60 * 60 * 1000, // 1 year
    });
    
    console.log('Generated signed URL successfully');
    return signedUrl;
  } catch (error) {
    console.error('Failed to generate signed URL:', {
      error,
      storagePath,
      message: error instanceof Error ? error.message : 'Unknown error'
    });
    throw error;
  }
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
  
  // Generate resume URL and add to merged data
  try {
    console.log('Generating resume download URL for storagePath:', parsedResume.storagePath);
    const resumeUrl = await generateResumeDownloadUrl(parsedResume.storagePath);
    console.log('Generated resume URL:', resumeUrl);
    
    // Add resume URL and metadata to the merged data
    mergedData.resumeUrl = resumeUrl;
    mergedData.resumeFileName = parsedResume.fileName;
    mergedData.resumeUploadDate = parsedResume.uploadDate;
    
    console.log('Resume URL added to merged data:', {
      resumeUrl,
      resumeFileName: parsedResume.fileName,
      resumeUploadDate: parsedResume.uploadDate
    });
  } catch (urlError) {
    console.error('Failed to generate resume URL:', {
      error: urlError,
      storagePath: parsedResume.storagePath,
      fileName: parsedResume.fileName
    });
    
    // Even if URL generation fails, save the storage path and metadata
    // The frontend can use getResumeSignedUrl as a fallback
    mergedData.resumeStoragePath = parsedResume.storagePath;
    mergedData.resumeFileName = parsedResume.fileName;
    mergedData.resumeUploadDate = parsedResume.uploadDate;
    
    console.log('Saved resume metadata without URL:', {
      resumeStoragePath: parsedResume.storagePath,
      resumeFileName: parsedResume.fileName,
      resumeUploadDate: parsedResume.uploadDate
    });
  }
  
  // Update user profile
  const userRef = db.collection('users').doc(uid);
  batch.update(userRef, mergedData);
  
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
    confidenceScores: Object.values(parsedData).map((item: any) => item.confidence || 0),
    timestamp: new Date()
  });
  
  await batch.commit();
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

  // Get OpenAI API key from environment variables
  const openaiApiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY;
  if (!openaiApiKey) {
    throw new Error('OpenAI API key is not set in environment variables.');
  }
  const OpenAI = (await import('openai')).default;
  const openai = new OpenAI({ apiKey: openaiApiKey });

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
    const storagePath = `resumes/${userId}/${uploadId}.${fileName.split('.').pop()}`;

    // Download and parse the file
    const fileBuffer = await downloadFile(fileUrl);
    const fileHash = calculateFileHash(fileBuffer);
    console.log('File downloaded, size:', fileBuffer.length, 'bytes');
    
    // Upload file to Firebase Storage
    console.log('Uploading file to Firebase Storage at path:', storagePath);
    const bucket = admin.storage().bucket();
    const file = bucket.file(storagePath);
    await file.save(fileBuffer, {
      metadata: {
        contentType: fileName.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream',
        metadata: {
          originalName: fileName,
          userId: userId,
          uploadId: uploadId
        }
      }
    });
    
    // Make the file publicly readable
    console.log('Setting file permissions to public read...');
    await file.makePublic();
    console.log('File uploaded to Storage successfully and made public');
    
    // Generate the public URL
    const publicUrl = `https://firebasestorage.googleapis.com/v0/b/hrx1-d3beb.firebasestorage.app/o/${encodeURIComponent(storagePath)}?alt=media`;
    console.log('Generated public URL:', publicUrl);
    
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
        const enhancedBio = await generateEnhancedBio(parsedData.summary, parsedData.contact.name, openai);
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
        downloadUrl: publicUrl
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
    await logAIAction({
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
    
    // Update upload status to failed
    const uploadId = generateUploadId();
    const uploadRef = db.collection('resumeUploads').doc(userId).collection('uploads').doc(uploadId);
    await uploadRef.set({
      uploadId,
      userId,
      fileName,
      fileType: fileName.split('.').pop() || '',
      sizeKB: Math.round(fileSize / 1024),
      status: 'failed',
      uploadDate: new Date(),
      storagePath: '',
      archived: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    throw new Error(`Failed to parse resume: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// HTTP wrapper for parseResume to support localhost development with proper CORS
export const parseResumeHttp = onRequest({
  cors: true,
  timeoutSeconds: 540,
  memory: '512MiB',
  maxInstances: 5
}, async (req, res) => {
  const requestOrigin = (req.headers.origin as string) || '';
  const allowedOrigins = new Set(['http://localhost:3000', 'https://hrxone.com']);
  const corsOrigin = allowedOrigins.has(requestOrigin) ? requestOrigin : 'http://localhost:3000';

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
    
    const { fileUrl, fileName, fileSize, userId } = req.body || {};
    
    if (!fileUrl || !fileName || !userId) {
      res.set('Access-Control-Allow-Origin', corsOrigin);
      res.status(400).json({ error: 'Missing required parameters: fileUrl, fileName, userId' });
      return;
    }

    // Verify user owns the userId or is authorized
    if (decodedToken.uid !== userId) {
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
    res.status(500).json({ 
      error: error.message || 'Failed to parse resume',
      code: error.code || 'internal'
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
    throw new Error(`Word document parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Extract structured data from resume text using AI and NLP
 */
async function extractResumeData(text: string, fileName: string, openai: OpenAI): Promise<ParsedResume['parsedData']> {
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
  
  // Generate AI analysis
  const aiAnalysis = await generateAIAnalysis(mergedData, cleanedText, openai);
  
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
async function extractWithAI(text: string, openai: OpenAI) {
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
  ]
}

Resume text:
${text.substring(0, 4000)} // Limit to first 4000 characters for API efficiency
`;

  try {
    console.log('Starting AI extraction with OpenAI...');
    console.log('Prompt length:', prompt.length);
    console.log('Text length:', text.length);
    
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "You are an expert resume parser. Extract structured information accurately and return valid JSON only."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.1,
      max_completion_tokens: 2000
    });

    console.log('OpenAI API call completed');
    const response = completion.choices[0]?.message?.content;
    console.log('AI response length:', response?.length || 0);
    console.log('AI response preview:', response?.substring(0, 200) || 'No response');
    
    if (!response) {
      throw new Error('No response from AI');
    }

    // Extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('No JSON found in AI response. Full response:', response);
      throw new Error('No JSON found in AI response');
    }

    const parsedResult = JSON.parse(jsonMatch[0]);
    console.log('Successfully parsed AI response:', JSON.stringify(parsedResult, null, 2));
    return parsedResult;
  } catch (error) {
    console.error('AI extraction failed:', error);
    console.error('Error details:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      name: error instanceof Error ? error.name : undefined
    });
    // Return empty structure if AI fails
    return {
      contact: { name: '', email: '', phone: '', address: '' },
      summary: '',
      skills: [],
      education: [],
      experience: [],
      certifications: [],
      languages: [],
      projects: [],
      awards: [],
      volunteerWork: []
    };
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
  // Merge contact information
  const contact = {
    ...aiExtraction.contact,
    name: aiExtraction.contact.name || nlpExtraction.contact.name,
    email: aiExtraction.contact.email || nlpExtraction.contact.email,
    phone: aiExtraction.contact.phone || nlpExtraction.contact.phone
  };
  
  // Merge skills (avoid duplicates)
  const skillsMap = new Map();
  [...(aiExtraction.skills || []), ...(nlpExtraction.skills || [])].forEach(skill => {
    const key = skill.name.toLowerCase();
    if (!skillsMap.has(key)) {
      skillsMap.set(key, skill);
    }
  });
  const skills = Array.from(skillsMap.values());
  
  // Merge education (avoid duplicates)
  const educationMap = new Map();
  [...(aiExtraction.education || []), ...(nlpExtraction.education || [])].forEach(edu => {
    const key = edu.institution.toLowerCase();
    if (!educationMap.has(key)) {
      educationMap.set(key, edu);
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
 * Generate AI analysis of the resume
 */
async function generateAIAnalysis(parsedData: any, originalText: string, openai: OpenAI): Promise<AIAnalysis> {
  const prompt = `
Analyze this resume and provide insights. Return a JSON object with:

{
  "overallScore": "Score from 1-10",
  "skillGaps": ["List of missing skills for common roles"],
  "recommendations": ["List of improvement recommendations"],
  "marketability": "Score from 1-10",
  "yearsOfExperience": "Estimated total years",
  "educationLevel": "Highest education level",
  "keyStrengths": ["List of key strengths"],
  "areasForImprovement": ["Areas that need improvement"],
  "jobFit": {
    "Software Engineer": "Fit score 1-10",
    "Project Manager": "Fit score 1-10",
    "Data Analyst": "Fit score 1-10"
  }
}

Resume data:
${JSON.stringify(parsedData, null, 2)}

Original text (first 2000 chars):
${originalText.substring(0, 2000)}
`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "You are an expert resume analyst. Provide detailed analysis and return valid JSON only."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.3,
      max_completion_tokens: 1500
    });

    const response = completion.choices[0]?.message?.content;
    if (!response) {
      throw new Error('No response from AI analysis');
    }

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in AI analysis response');
    }

    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    console.error('AI analysis failed:', error);
    return {
      overallScore: 5,
      skillGaps: [],
      recommendations: [],
      marketability: 5,
      yearsOfExperience: 0,
      educationLevel: 'Unknown',
      keyStrengths: [],
      areasForImprovement: [],
      jobFit: {}
    };
  }
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
async function generateEnhancedBio(summary: string, name: string, openai: OpenAI): Promise<string> {
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
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
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
      max_completion_tokens: 200
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

/**
 * Update user profile with parsed resume data
 */
async function updateUserProfile(userId: string, parsedData: any) {
  const userRef = db.collection('users').doc(userId);
  
  const updates: any = {};
  
    // Update contact information
    if (parsedData.contact.name) {
      const nameParts = parsedData.contact.name.split(' ');
      if (nameParts.length >= 2) {
        updates.firstName = nameParts[0];
        updates.lastName = nameParts.slice(1).join(' ');
      }
    }
    
    if (parsedData.contact.email) {
      updates.email = parsedData.contact.email;
    }
    
    if (parsedData.contact.phone) {
      updates.phone = parsedData.contact.phone;
    }
    
    // Geocode address if available for location-based job matching
    if (parsedData.contact.address) {
      try {
        const coordinates = await geocodeAddress(parsedData.contact.address);
        if (coordinates) {
          updates['addressInfo.streetAddress'] = parsedData.contact.address;
          updates['addressInfo.homeLat'] = coordinates.lat;
          updates['addressInfo.homeLng'] = coordinates.lng;
        }
      } catch (error) {
        console.warn('Failed to geocode address from resume:', error);
      }
    }
  
  // Update skills
  if (parsedData.skills.length > 0) {
    updates.skills = parsedData.skills.map((skill: Skill) => skill.name);
  }
  
  // Update education
  if (parsedData.education.length > 0) {
    updates.education = parsedData.education;
    
    // Set highest education level
    const highestEducation = getHighestEducationLevel(parsedData.education);
    if (highestEducation) {
      updates.educationLevel = highestEducation;
    }
  }
  
  // Update work experience
  if (parsedData.experience.length > 0) {
    updates.workHistory = parsedData.experience;
    
    // Calculate years of experience
    const totalYears = calculateTotalExperience(parsedData.experience);
    if (totalYears > 0) {
      updates.yearsExperience = totalYears.toString();
    }
    
    // Set current job title
    const currentJob = parsedData.experience.find((exp: WorkExperience) => exp.current);
    if (currentJob) {
      updates.currentJobTitle = currentJob.jobTitle;
    }
  }
  
  // Update certifications
  if (parsedData.certifications.length > 0) {
    updates.certifications = parsedData.certifications;
  }
  
  // Update languages
  if (parsedData.languages.length > 0) {
    updates.languages = parsedData.languages;
  }
  
  // Update summary
  if (parsedData.summary) {
    updates.professionalSummary = parsedData.summary;
  }
  
  // Apply updates if any
  if (Object.keys(updates).length > 0) {
    console.log('Updating user profile with:', JSON.stringify(updates, null, 2));
    await userRef.update(updates);
    console.log('User profile updated successfully');
  } else {
    console.log('No updates to apply to user profile');
  }
}

/**
 * Get highest education level from education array
 */
function getHighestEducationLevel(education: Education[]): string {
  const levels = ['High School', "Associate's", "Bachelor's", "Master's", 'Doctorate'];
  let highestIndex = -1;
  
  education.forEach(edu => {
    const degreeLower = edu.degree.toLowerCase();
    levels.forEach((level, index) => {
      if (degreeLower.includes(level.toLowerCase()) && index > highestIndex) {
        highestIndex = index;
      }
    });
  });
  
  return highestIndex >= 0 ? levels[highestIndex] : '';
}

/**
 * Calculate total years of experience
 */
function calculateTotalExperience(experience: WorkExperience[]): number {
  let totalYears = 0;
  
  experience.forEach(exp => {
    const startDate = new Date(exp.startDate);
    const endDate = exp.current ? new Date() : new Date(exp.endDate);
    const years = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
    totalYears += Math.max(0, years);
  });
  
  return Math.round(totalYears);
}

/**
 * Log AI action for analytics
 */
async function logAIAction(data: any) {
  try {
    await db.collection('aiLogs').add({
      ...data,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (error) {
    console.error('Failed to log AI action:', error);
  }
}

/**
 * Get resume parsing status
 */
export const getResumeParsingStatus = functions.https.onCall(async (request, context) => {
  const { parsingId } = request.data;
  
  if (!request.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }
  
  try {
    const parsingDoc = await db.collection('resumeParsing').doc(parsingId).get();
    if (!parsingDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Parsing record not found');
    }
    
    const parsingData = parsingDoc.data();
    
    if (parsingData?.status === 'completed') {
      const parsedResumeDoc = await db.collection('parsedResumes').doc(parsingId).get();
      if (parsedResumeDoc.exists) {
        return {
          status: 'completed',
          data: parsedResumeDoc.data()
        };
      }
    }
    
    return {
      status: parsingData?.status || 'processing',
      error: parsingData?.error
    };
    
  } catch (error) {
    throw new functions.https.HttpsError('internal', 'Failed to get parsing status');
  }
});

/**
 * Get user's resume uploads with versioning
 */
export const getUserResumeUploads = functions.https.onCall(async (request, context) => {
  const { userId } = request.data;
  
  console.log('getUserResumeUploads called with userId:', userId);
  
  if (!request.auth) {
    console.log('User not authenticated');
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }
  
          try {
            // Get the user's resume uploads from the subcollection
            const userUploadsRef = db.collection('resumeUploads').doc(userId);
            console.log('Checking user uploads ref:', userUploadsRef.path);
            
            const uploadsSnapshot = await userUploadsRef
              .collection('uploads')
              .orderBy('uploadDate', 'desc')
              .get();
    
    console.log('Found uploads:', uploadsSnapshot.size);
    uploadsSnapshot.docs.forEach((doc, index) => {
      console.log(`Upload ${index + 1}:`, {
        id: doc.id,
        data: doc.data()
      });
    });
    
    const uploads = uploadsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    
    console.log('Returning uploads:', uploads);
    return { uploads };
    
  } catch (error) {
    console.error('Error getting resume uploads:', error);
    // If there's an error (like permission denied), return empty array instead of throwing
    // This prevents showing error messages for users who simply haven't uploaded resumes yet
    return { uploads: [] };
  }
});

/**
 * Get signed URL for resume file viewing/downloading
 */
export const getResumeSignedUrl = functions.https.onCall(async (request, context) => {
  const { userId, uploadId, action = 'read' } = request.data;
  
  if (!request.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }
  
  try {
    // Get upload record
    const uploadDoc = await db.collection('resumeUploads').doc(userId)
      .collection('uploads').doc(uploadId).get();
    
    if (!uploadDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Resume upload not found');
    }
    
    const uploadData = uploadDoc.data();
    if (!uploadData?.storagePath) {
      throw new functions.https.HttpsError('not-found', 'Storage path not found');
    }
    
    // Generate signed URL
    const bucket = admin.storage().bucket();
    const file = bucket.file(uploadData.storagePath);
    
    const [signedUrl] = await file.getSignedUrl({
      version: 'v4',
      action: action === 'download' ? 'read' : 'read',
      expires: Date.now() + 15 * 60 * 1000, // 15 minutes
      responseDisposition: action === 'download' ? 'attachment' : 'inline'
    });
    
    return { 
      signedUrl,
      fileName: uploadData.fileName,
      fileSize: uploadData.sizeKB,
      uploadDate: uploadData.uploadDate
    };
    
  } catch (error) {
    throw new functions.https.HttpsError('internal', 'Failed to generate signed URL');
  }
});

/**
 * Get user's parsed resumes (legacy function - keeping for compatibility)
 */
export const getUserParsedResumes = functions.https.onCall(async (request, context) => {
  const { userId } = request.data;
  
  if (!request.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }
  
  try {
    const resumesSnapshot = await db.collection('parsedResumes')
      .where('userId', '==', userId)
      .orderBy('uploadDate', 'desc')
      .get();
    
    const resumes = resumesSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    
    return { resumes };
    
  } catch (error) {
    throw new functions.https.HttpsError('internal', 'Failed to get parsed resumes');
  }
}); 