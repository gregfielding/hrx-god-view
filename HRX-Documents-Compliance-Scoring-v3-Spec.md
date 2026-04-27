# HRX Worker Documents + Compliance + Scoring Architecture (v3 Spec)

*Last Updated: 2026-02-12 22:21 UTC*

------------------------------------------------------------------------

# 1. System Overview

HRX now supports three distinct but interconnected domains:

1.  **Hiring Score (Global Talent Score)**
2.  **Job Match Score (Per-Job Evaluation)**
3.  **Compliance & Document Management (Onboarding + Expiration + Everee
    Integration)**

These must remain logically separated but architecturally aligned.

------------------------------------------------------------------------

# 2. Scoring System Architecture

## 2.1 Hiring Score (Global Profile Score)

**Purpose:**\
Measures overall candidate quality and engagement independent of any
specific job.

**Inputs Include:** - Verified phone - Resume uploaded - Home address -
Bio completed - Skills added - Work history depth - Education depth -
Certifications count - Engagement metrics (future phase)

**Key Principles:** - More credentials/experience increases score
proportionally - Score stored at: `users/{uid}.scoreSummary.aiScore` -
Used in: - Admin dashboard - Worker "Hiring Score" display - Default
applicant sorting (when no job requirement pack exists)

This score is profile-based, not job-based.

------------------------------------------------------------------------

## 2.2 Job Match Score (Requirement Pack Based)

**Purpose:**\
Measures how well a worker matches a specific job.

Stored on application:

    applications/{applicationId}.jobScoreSummary

**Compared Against Job Requirement Pack:** - Required skills - Required
certifications - Required education level - Required experience level -
Shift availability compatibility - Employment type alignment -
Background/drug screening requirements - PPE/uniform requirements (if
gating)

**Key Rules:** - Worker may have 80% Hiring Score but 25% Job Match
Score. - Required cert missing = heavy deduction. - Experience below
minimum = heavy deduction. - Availability mismatch = deduction.

Sorting Behavior: - If job has requirementPackId → default sort by Job
Score. - Otherwise → sort by Hiring Score.

------------------------------------------------------------------------

# 3. Document Architecture

Documents are separated into three domains:

------------------------------------------------------------------------

## 3.1 Compliance (Onboarding + Regulatory)

Includes: - I-9 - E-Verify - Direct Deposit - W4 - Contractor
Agreement - Handbook Acknowledgment - Background Check - Drug Screen -
Driver's License - Work Permit

These may: - Be stored in Everee - Have expiration dates - Differ
between W2 and Contractor

### Data Model

    users/{uid}
      onboarding:
        templateId
        employmentType ("w2" | "contractor")
        checklist: { ... }
        overallStatus
        compliancePercent
        requiredCount
        completedCount
        expiredCount
        expiringSoonCount
        lastEvaluatedAt

### Checklist Item Shape

    {
      status: "missing" | "submitted" | "verified" | "expired",
      provider: "everee" | "hrx",
      externalId,
      viewUrl,
      fileUrl,
      expiresAt
    }

------------------------------------------------------------------------

## 3.2 Credentials (Worker-Owned)

Includes: - Resume - Certifications - Uploaded licenses - Education
documents

These: - Improve Hiring Score - Improve Job Match Score - May expire

Stored within worker profile and HRX storage.

------------------------------------------------------------------------

## 3.3 Job Files (Assignment-Specific)

Includes: - First day instructions - Site maps - Safety procedures -
Orientation packet - Client-specific agreements

Read-only for worker. Linked from job order \> Staff Instructions.

------------------------------------------------------------------------

# 4. Sensitive Document Strategy

HRX does NOT store: - SSN - I-9 scans - Driver license images - Social
security cards - W4 PDFs

Instead store references:

    {
      provider: "everee",
      externalId,
      viewUrl,
      expiresAt,
      status: "verified"
    }

HRX acts as compliance orchestrator, not document vault.

------------------------------------------------------------------------

# 5. Compliance Engine

Add centralized utility:

    computeComplianceSummary(checklist)

Returns: - compliancePercent (0--100) - overallStatus - expiredCount -
expiringSoonCount - completedCount - requiredCount

Expiration Rules: \| Days Until Expiration \| Display \|
\|----------------------\|----------\| \| \> 30 days \| Verified \| \| ≤
30 days \| Expiring Soon \| \| ≤ 0 \| Expired \|

Automation (future): - 30 days → notify worker + recruiter - 14 days →
reminder - 7 days → escalation - 0 days → mark non-compliant

------------------------------------------------------------------------

# 6. Everee Integration Strategy

### Sync Flow

1.  Everee webhook fires
2.  Cloud Function:
    -   Maps Everee document type → checklist key
    -   Updates status + expiresAt
    -   Recomputes compliance summary
    -   Writes lastSyncedAt

Frontend never owns Everee truth.

------------------------------------------------------------------------

# 7. UI Layout (Worker Documents v3)

## Header Section (Always Visible)

Displays: - Compliance Percent - Expiring Soon Badge - Expired Badge

## Tabs

### 1. Compliance

Checklist view with status chips and expiration logic.

### 2. Credentials

Resume + Certifications + Uploadable worker docs.

### 3. Job Files

Read-only job order attachments.

------------------------------------------------------------------------

# 8. Separation of Concerns

  ----------------------------------------------------------------------------------
  System           Influences Hiring      Influences Job Match Influences Compliance
                   Score                                       
  ---------------- ---------------------- -------------------- ---------------------
  Resume           ✓                      ✓                    ✗

  Certifications   ✓                      ✓                    Sometimes

  I-9              ✗                      Hard Gate            ✓

  Direct Deposit   ✗                      ✗                    ✓

  Background       ✗                      Hard Gate            ✓

  Experience       ✓                      ✓                    ✗
  ----------------------------------------------------------------------------------

Compliance ≠ Talent.\
Talent ≠ Job Match.

They are intentionally separate.

------------------------------------------------------------------------

# 9. Future Build Order

1.  Replace mock onboarding checklist with Firestore subscription.
2.  Add centralized compliance summary computation.
3.  Add recruiter compliance badge in applicant table + placements.
4.  Implement Everee webhook sync.
5.  Add Cloud Function to auto-recompute compliance on checklist change.

------------------------------------------------------------------------

# 10. Architectural Summary

HRX is becoming:

-   A compliance orchestration layer
-   A requirement evaluation engine
-   A talent intelligence platform
-   A job-fit matching engine
-   A payroll integration bridge

The deliberate separation of: - Hiring Score - Job Match Score -
Compliance Status

is correct and enterprise-aligned.
