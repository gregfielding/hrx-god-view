import { onCall } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { z } from 'zod';

const db = getFirestore();

// Duplicate detection schema
const DetectDuplicatesSchema = z.object({
  tenantId: z.string().min(1),
  candidateId: z.string().min(1),
  updatedBy: z.string().optional(),
});

/**
 * Detects duplicate candidates using AI
 */
export const detectDuplicates = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  try {
    // Validate input
    const { tenantId, candidateId, updatedBy } = DetectDuplicatesSchema.parse(request.data);

    console.log(`Detecting duplicates for candidate ${candidateId} in tenant ${tenantId}`);

    // Get candidate data
    const candidateRef = db.collection('tenants').doc(tenantId).collection('candidates').doc(candidateId);
    const candidateDoc = await candidateRef.get();

    if (!candidateDoc.exists) {
      throw new Error(`Candidate ${candidateId} not found`);
    }

    const candidateData = candidateDoc.data();

    // Perform duplicate detection
    const duplicateResults = await performDuplicateDetection(tenantId, candidateData);

    // Update candidate with duplicate check results
    const now = Date.now();
    const userId = updatedBy || 'system';

    await candidateRef.update({
      duplicateCheck: duplicateResults,
      lastDuplicateCheck: now,
      updatedAt: now,
      updatedBy: userId,
    });

    // Create duplicate detection event
    const duplicateEvent = {
      type: 'candidate.duplicate_check',
      tenantId,
      entityType: 'candidate',
      entityId: candidateId,
      source: 'recruiter',
      dedupeKey: `candidate_duplicate_check:${candidateId}:${now}`,
      createdBy: userId,
      updatedBy: userId,
      searchKeywords: ['candidate', 'duplicate', 'check', 'ai', candidateId],
      payload: {
        candidateId,
        duplicateResults,
      }
    };

    // Import and use the createEvent function
    const { createEvent } = await import('../utils/events');
    await createEvent(duplicateEvent);

    console.log(`Successfully detected duplicates for candidate ${candidateId}`);

    return {
      success: true,
      action: 'duplicate_detection',
      candidateId,
      tenantId,
      duplicateResults,
    };

  } catch (error) {
    console.error('Error detecting duplicates:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
});

/**
 * Perform comprehensive duplicate detection
 */
async function performDuplicateDetection(tenantId: string, candidateData: any): Promise<any> {
  const candidatesRef = db.collection('tenants').doc(tenantId).collection('candidates');
  const duplicates: any[] = [];

  // 1. Exact email match
  if (candidateData.email) {
    const emailQuery = await candidatesRef
      .where('email', '==', candidateData.email)
      .get();

    emailQuery.docs.forEach(doc => {
      if (doc.id !== candidateData.id) {
        duplicates.push({
          candidateId: doc.id,
          candidateData: doc.data(),
          matchType: 'exact_email',
          confidence: 0.95,
          reason: 'Exact email match',
        });
      }
    });
  }

  // 2. Exact phone match
  if (candidateData.phone) {
    const phoneQuery = await candidatesRef
      .where('phone', '==', candidateData.phone)
      .get();

    phoneQuery.docs.forEach(doc => {
      if (doc.id !== candidateData.id && !duplicates.find(d => d.candidateId === doc.id)) {
        duplicates.push({
          candidateId: doc.id,
          candidateData: doc.data(),
          matchType: 'exact_phone',
          confidence: 0.90,
          reason: 'Exact phone match',
        });
      }
    });
  }

  // 3. Name similarity (fuzzy matching)
  const nameDuplicates = await detectNameSimilarity(candidatesRef, candidateData);
  duplicates.push(...nameDuplicates);

  // 4. Resume hash comparison (if available)
  if (candidateData.resumeUrl) {
    const resumeDuplicates = await detectResumeSimilarity(candidatesRef, candidateData);
    duplicates.push(...resumeDuplicates);
  }

  // 5. Work history pattern matching
  const workHistoryDuplicates = await detectWorkHistoryPatterns(candidatesRef, candidateData);
  duplicates.push(...workHistoryDuplicates);

  // Remove duplicates and sort by confidence
  const uniqueDuplicates = duplicates.filter((duplicate, index, self) =>
    index === self.findIndex(d => d.candidateId === duplicate.candidateId)
  );

  uniqueDuplicates.sort((a, b) => b.confidence - a.confidence);

  // Determine overall duplicate status
  const isDuplicate = uniqueDuplicates.length > 0 && uniqueDuplicates[0].confidence > 0.7;
  const highestConfidence = uniqueDuplicates.length > 0 ? uniqueDuplicates[0].confidence : 0;

  return {
    isDuplicate,
    confidence: highestConfidence,
    duplicateCount: uniqueDuplicates.length,
    duplicates: uniqueDuplicates.slice(0, 5), // Top 5 matches
    lastChecked: Date.now(),
  };
}

/**
 * Detect name similarity using fuzzy matching
 */
async function detectNameSimilarity(candidatesRef: any, candidateData: any): Promise<any[]> {
  const duplicates: any[] = [];
  const candidateName = `${candidateData.firstName} ${candidateData.lastName}`.toLowerCase();

  // Get all candidates for name comparison
  const allCandidatesSnapshot = await candidatesRef.get();

  allCandidatesSnapshot.docs.forEach(doc => {
    if (doc.id === candidateData.id) return;

    const otherCandidate = doc.data();
    const otherName = `${otherCandidate.firstName} ${otherCandidate.lastName}`.toLowerCase();

    // Calculate name similarity
    const similarity = calculateNameSimilarity(candidateName, otherName);

    if (similarity > 0.8) {
      duplicates.push({
        candidateId: doc.id,
        candidateData: otherCandidate,
        matchType: 'name_similarity',
        confidence: similarity,
        reason: `Name similarity: ${Math.round(similarity * 100)}%`,
      });
    }
  });

  return duplicates;
}

/**
 * Calculate name similarity using Levenshtein distance
 */
function calculateNameSimilarity(name1: string, name2: string): number {
  const distance = levenshteinDistance(name1, name2);
  const maxLength = Math.max(name1.length, name2.length);
  return 1 - (distance / maxLength);
}

/**
 * Levenshtein distance calculation
 */
function levenshteinDistance(str1: string, str2: string): number {
  const matrix = [];

  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[str2.length][str1.length];
}

/**
 * Detect resume similarity (placeholder for resume hash comparison)
 */
async function detectResumeSimilarity(candidatesRef: any, candidateData: any): Promise<any[]> {
  // This would integrate with resume parsing and hash comparison
  // For now, return empty array
  return [];
}

/**
 * Detect work history patterns
 */
async function detectWorkHistoryPatterns(candidatesRef: any, candidateData: any): Promise<any[]> {
  const duplicates: any[] = [];

  // This would analyze work history patterns, job titles, companies, etc.
  // For now, return empty array
  return duplicates;
}

/**
 * Bulk duplicate detection for all candidates
 */
export const bulkDetectDuplicates = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  try {
    const { tenantId, updatedBy } = request.data;

    console.log(`Starting bulk duplicate detection for tenant ${tenantId}`);

    const candidatesRef = db.collection('tenants').doc(tenantId).collection('candidates');
    const candidatesSnapshot = await candidatesRef.get();

    const results = [];
    let processed = 0;

    for (const doc of candidatesSnapshot.docs) {
      const candidateData = doc.data();
      
      try {
        const duplicateResults = await performDuplicateDetection(tenantId, candidateData);
        
        // Update candidate with results
        await doc.ref.update({
          duplicateCheck: duplicateResults,
          lastDuplicateCheck: Date.now(),
          updatedAt: Date.now(),
          updatedBy: updatedBy || 'system',
        });

        results.push({
          candidateId: doc.id,
          success: true,
          duplicateResults,
        });

        processed++;
        
        // Log progress every 10 candidates
        if (processed % 10 === 0) {
          console.log(`Processed ${processed}/${candidatesSnapshot.docs.length} candidates`);
        }
      } catch (error) {
        results.push({
          candidateId: doc.id,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    console.log(`Completed bulk duplicate detection for ${processed} candidates`);

    return {
      success: true,
      action: 'bulk_duplicate_detection',
      tenantId,
      processed,
      total: candidatesSnapshot.docs.length,
      results,
    };

  } catch (error) {
    console.error('Error in bulk duplicate detection:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
});
