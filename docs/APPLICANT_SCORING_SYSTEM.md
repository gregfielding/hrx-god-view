# Applicant Scoring System

## Overview

The applicant scoring system uses a **two-score hybrid approach** to help recruiters quickly identify the best candidates:

1. **Profile Score (0-100)** - Rule-based completeness score
2. **Fit Score (0-100)** - AI-powered job-specific qualification match

---

## 1. Profile Score (Rule-Based - FREE)

### Purpose
Measures how complete and engaged an applicant's profile is, independent of job requirements.

### Calculation Breakdown

| Component | Points | Criteria |
|-----------|--------|----------|
| **Basic Info** | 20 | First name, last name, email, phone, DOB, address all filled |
| **Verification** | 20 | Phone verified (10), Work eligibility verified (10) |
| **Skills** | 15 | Minimum 3 skills listed (proportional for 1-2 skills) |
| **Work History** | 15 | At least 1 job entry |
| **Certifications** | 10 | Any certification uploaded |
| **Education** | 5 | Any education entry |
| **Languages** | 2 | Any language listed |
| **Engagement Bonus** | Up to 15 | See below |

### Engagement Bonuses
- Login count > 3: **+5 points**
- Profile updated in last 30 days: **+5 points**
- Multiple applications (shows interest): **+3 points**

### Score Ranges
- **70-100 (Green)**: Excellent - Complete profile, highly engaged
- **40-69 (Yellow)**: Good - Adequate profile, some engagement
- **0-39 (Red)**: Poor - Incomplete profile, needs attention

### Implementation
```typescript
// Calculated instantly on frontend when fetching applicants
const profileScore = calculateProfileScore(userData);
```

**Cost:** $0 (no API calls)

---

## 2. Fit Score (AI-Powered - CACHED)

### Purpose
AI evaluates how well the applicant's qualifications match the specific job requirements.

### AI Analysis Criteria

The AI evaluates:
- **Skills Match**: Required skills vs. applicant's skills
- **Experience Level**: Entry/Mid/Senior alignment with job
- **Certifications**: Required vs. possessed certifications
- **Work History**: Relevant industry and role experience
- **Education**: Requirements vs. qualifications
- **Location**: Proximity to worksite (when relevant)
- **Availability**: Start date alignment

### Cost Hardening Strategies

#### ✅ Threshold Gating
```typescript
// Only calculate Fit Score if Profile Score >= 40
if (profileScore >= 40) {
  calculateFitScore(); // AI call
}
```

**Savings:** ~60% reduction (filters out incomplete profiles)

#### ✅ Aggressive Caching
```typescript
applicationData: {
  scores: {
    profileScore: 85,
    fitScore: 72,
    fitScoreCalculatedAt: Timestamp,
    jobRequirementsHash: "abc123..." // Invalidate if job changes
  }
}
```

**Cache Duration:** 7 days  
**Invalidation:** When job requirements change  
**Savings:** ~90% reduction on repeat views

#### ✅ Rate Limiting
```typescript
// Max 100 AI calls per hour per tenant
if (await checkRateLimit(tenantId)) {
  calculateFitScore();
} else {
  queueForBatchProcessing(); // Process overnight
}
```

**Protects Against:** Runaway loops, bulk uploads

#### ✅ Lightweight Prompts
```typescript
const prompt = `Score applicant fit (0-100) for job.
Job: ${jobTitle}
Required: ${skillsRequired.slice(0, 5)}
Experience: ${experienceRequired}
Applicant Skills: ${skills.slice(0, 10)}
Work History: ${workHistory[0]?.title}
Output JSON: {"score": 0-100, "reasoning": "1 sentence"}`;
```

**Token Count:** ~150 tokens per applicant  
**Cost:** ~$0.000023 per score (~$0.02 per 1000 applicants)

---

## Data Structure

### User Document
```typescript
users/{uid}/applicationData/{applicationId}: {
  // Existing fields...
  status: "submitted",
  candidateStatus: false,
  appliedAt: Timestamp,
  
  // NEW: Scores object
  scores: {
    profileScore: 85,          // Always calculated (client-side)
    fitScore: 72,              // AI-calculated (cached)
    fitScoreCalculatedAt: Timestamp,
    fitScoreVersion: "v1",
    jobRequirementsHash: "abc123..."
  }
}
```

---

## Cloud Function (Optional - For Automation)

### Trigger: New Application
```typescript
export const scoreNewApplication = onDocumentWritten(
  'users/{uid}',
  async (event) => {
    const userData = event.data?.after?.data();
    
    // Calculate Profile Score (instant)
    const profileScore = calculateProfileScore(userData);
    
    // Only call AI if profile is >40% complete
    if (profileScore >= 40) {
      // Check cache
      if (!hasCachedFitScore(applicationData, jobOrder)) {
        // Rate limit check
        if (await checkRateLimit(tenantId)) {
          const fitScore = await callOpenAI(userData, jobOrder);
          await saveFitScore(uid, applicationId, fitScore);
        } else {
          await queueForLaterProcessing(uid, applicationId);
        }
      }
    }
    
    // Save Profile Score (always)
    await saveProfileScore(uid, applicationId, profileScore);
  }
);
```

---

## UI Display

### Table Columns

| Column | Display | Tooltip |
|--------|---------|---------|
| **Profile** | Green/Yellow/Red chip with score | "Profile completeness score based on resume, skills, work history, and engagement" |
| **Fit** | Green/Yellow/Red chip with score OR "..." if pending | "AI-powered job fit score based on skills, experience, and qualifications" |

### Pending Fit Score States
- `...` (outlined chip): Profile < 40% - "Complete profile to 40% to enable fit scoring"
- `...` (outlined chip): Profile >= 40% - "Fit score will be calculated automatically"

### Color Coding
- **Green (70-100)**: Strong match
- **Yellow (40-69)**: Moderate match
- **Red (0-39)**: Weak match

---

## Sorting & Filtering (Future Enhancement)

```typescript
// Sort by Profile Score
applicants.sort((a, b) => (b.profileScore ?? 0) - (a.profileScore ?? 0));

// Sort by Fit Score
applicants.sort((a, b) => (b.fitScore ?? 0) - (a.fitScore ?? 0));

// Combined score (weighted average)
const combinedScore = (profileScore * 0.3) + (fitScore * 0.7);
```

---

## Cost Estimation

### Scenario: 100 Applications per Month

**Without Hardening:**
- 100 applicants × $0.000023 = **$0.0023/month**

**With Hardening (60% below threshold, 90% cached):**
- 100 × 0.4 (pass threshold) × 0.1 (not cached) = 4 AI calls
- 4 × $0.000023 = **$0.000092/month**

### Scenario: 10,000 Applications per Month (High Volume)

**Without Hardening:**
- 10,000 × $0.000023 = **$0.23/month**

**With Hardening:**
- 10,000 × 0.4 × 0.1 = 400 AI calls
- 400 × $0.000023 = **$0.0092/month** (~$0.01)

**Savings:** ~96% cost reduction through intelligent caching and threshold gating

---

## Best Practices

### ✅ DO:
- Calculate Profile Score on every page load (it's free and instant)
- Cache Fit Scores for 7 days
- Only calculate Fit Score for profiles > 40% complete
- Invalidate Fit Score cache when job requirements change
- Use rate limiting to prevent abuse
- Queue low-priority scoring for batch processing

### ❌ DON'T:
- Recalculate Fit Score on every page view
- Calculate Fit Score for incomplete profiles
- Allow unlimited AI calls per tenant
- Store AI prompts in application data (waste of space)
- Calculate Fit Score synchronously on application submission (use async)

---

## Monitoring

Track these metrics in your analytics:

```typescript
{
  "scoring_metrics": {
    "total_ai_calls_today": 45,
    "total_ai_calls_month": 1250,
    "cache_hit_rate": 0.89,
    "avg_profile_score": 62,
    "avg_fit_score": 58,
    "profiles_below_threshold": 0.35
  }
}
```

---

## Future Enhancements

1. **Composite Score**: Weighted combination of Profile + Fit
2. **Custom Weights**: Let recruiters adjust importance of each factor
3. **Trend Analysis**: Show score improvements over time
4. **Batch Scoring**: Process overnight for large applicant pools
5. **A/B Testing**: Compare AI models for accuracy
6. **Explainability**: Show why an applicant scored high/low

---

## Implementation Checklist

- [x] Create `applicantScoring.ts` utility
- [x] Add Profile Score calculation (rule-based)
- [x] Add score columns to UI table
- [x] Add tooltips explaining scores
- [x] Add color-coded chips
- [ ] Create Cloud Function for AI Fit Score
- [ ] Implement caching logic
- [ ] Add rate limiting
- [ ] Set up monitoring dashboard
- [ ] Add sorting by scores
- [ ] Add filtering by score ranges

