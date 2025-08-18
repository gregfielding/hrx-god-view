import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import nlp from 'compromise';
import OpenAI from 'openai';

// Add at the top for missing types
// @ts-ignore
const pdfParse = require('pdf-parse');
// @ts-ignore
const mammoth = require('mammoth');

const db = admin.firestore();
// Remove global openai client initialization
// const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Types for resume parsing
export interface ParsedResume {
  userId: string;
  customerId?: string;
  agencyId?: string;
  fileName: string;
  fileSize: number;
  uploadDate: Date;
  parsedData: {
    contact: ContactInfo;
    summary: string;
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
 * Parse resume from uploaded file
 */
export const parseResume = functions.https.onCall(async (request, context) => {
  const { fileUrl, fileName, fileSize, userId } = request.data;
  const startTime = Date.now();

  if (!request.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  // Get OpenAI API key from Firebase config
  const openaiApiKey = functions.config().openai?.key;
  if (!openaiApiKey) {
    throw new functions.https.HttpsError('failed-precondition', 'OpenAI API key is not set in Firebase config.');
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

    // Create initial parsing record
    const parsingId = `resume_${userId}_${Date.now()}`;
    const parsingRef = db.collection('resumeParsing').doc(parsingId);
    
    await parsingRef.set({
      userId,
      customerId,
      agencyId,
      fileName,
      fileSize,
      uploadDate: new Date(),
      status: 'processing',
      processingTime: 0
    });

    // Download and parse the file
    const fileBuffer = await downloadFile(fileUrl);
    const fileExtension = fileName.toLowerCase().split('.').pop();
    
    let parsedText = '';
    
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

    // Extract structured data using AI and NLP
    const parsedData = await extractResumeData(parsedText, fileName, openai);

    // Create final parsed resume record
    const parsedResume: ParsedResume = {
      userId,
      customerId,
      agencyId,
      fileName,
      fileSize,
      uploadDate: new Date(),
      parsedData,
      status: 'completed',
      processingTime: Date.now() - startTime
    };

    // Save parsed resume
    await db.collection('parsedResumes').doc(parsingId).set(parsedResume);

    // Update user profile with extracted information
    await updateUserProfile(userId, parsedData);

    // Update parsing status
    await parsingRef.update({
      status: 'completed',
      processingTime: Date.now() - startTime
    });

    // Log AI action
    await logAIAction({
      userId,
      actionType: 'resume_parsed',
      sourceModule: 'ResumeParser',
      success: true,
      latencyMs: Date.now() - startTime,
      versionTag: 'v1',
      reason: `Resume parsed successfully: ${fileName}`,
      eventType: 'profile.resume_parsed',
      targetType: 'resume',
      targetId: parsingId,
      aiRelevant: true,
      contextType: 'profile',
      traitsAffected: null,
      aiTags: ['resume_parsing', 'ai_extraction', 'profile_update'],
      urgencyScore: 5
    });

    return {
      success: true,
      parsingId,
      parsedData
    };

  } catch (error) {
    console.error('Resume parsing error:', error);
    
    // Update parsing status to failed
    const parsingId = `resume_${userId}_${Date.now()}`;
    await db.collection('resumeParsing').doc(parsingId).set({
      userId,
      fileName,
      fileSize,
      uploadDate: new Date(),
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error',
      processingTime: Date.now() - startTime
    });

    throw new functions.https.HttpsError('internal', 'Failed to parse resume');
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
 * Parse PDF file
 */
async function parsePDF(buffer: Buffer): Promise<string> {
  try {
    const data = await pdfParse(buffer);
    return data.text;
  } catch (error) {
    throw new Error(`PDF parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
  
  // Use NLP for additional extraction and validation
  const nlpExtraction = extractWithNLP(cleanedText);
  
  // Merge and validate results
  const mergedData = mergeExtractions(aiExtraction, nlpExtraction);
  
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
    const completion = await openai.chat.completions.create({
      model: "gpt-5",
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

    const response = completion.choices[0]?.message?.content;
    if (!response) {
      throw new Error('No response from AI');
    }

    // Extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in AI response');
    }

    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    console.error('AI extraction failed:', error);
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
      model: "gpt-5",
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
    updates.employmentHistory = parsedData.experience;
    
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
    await userRef.update(updates);
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
 * Get user's parsed resumes
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