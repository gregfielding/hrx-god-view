# WORKER PROFILE + APPLICATION FIELD AUDIT

## Purpose

This audit maps every worker application wizard field/question to:

- where it is stored in Firestore today,
- whether it should sync to worker profile,
- what the correct target field should be,
- and whether current behavior is correct, missing, duplicated, or misleading.

Primary scope is the application wizard and requirement-answering surfaces used by workers.

## Source Files Audited

- `src/components/apply/Wizard.tsx`
- `src/components/apply/steps/PersonalInfoStep.tsx`
- `src/components/apply/steps/AddressStep.tsx`
- `src/components/apply/steps/WorkEligibilityStep.tsx`
- `src/components/apply/steps/ProfilePictureStep.tsx`
- `src/components/apply/steps/ResumeStep.tsx`
- `src/components/apply/steps/SkillsStep.tsx`
- `src/components/apply/steps/EducationStep.tsx`
- `src/components/apply/steps/WorkExperienceStep.tsx`
- `src/components/apply/steps/BioStep.tsx`
- `src/components/apply/steps/JobPreferencesStep.tsx`
- `src/components/apply/steps/RequirementsAcknowledgementStep.tsx`
- `src/pages/JobPostingDetail.tsx`
- `src/utils/jobRequirementStatus.ts`
- `src/utils/userProfileBatching.ts`

## Current Write Surfaces (Observed)

- Application draft writes:
  - `tenants/{tenantId}/applicationDrafts/{draftId}.data.*`
- Final submitted application writes:
  - `tenants/{tenantId}/applications/{uid}_{jobId}.data.*`
- Worker profile writes (direct and debounced):
  - `users/{uid}.*`
- Worker profile denormalized application map:
  - `users/{uid}.applicationData.{tenantId}_{jobId}`

## Critical Finding Summary

- Requirement willingness answers (`comfortablePassBackground`, `comfortablePassDrug`, `comfortableEVerify`) are stored on `users/{uid}` and later interpreted as requirement "met" in `src/utils/jobRequirementStatus.ts`.
- This creates false-green readiness and requirement completion for background/drug/E-Verify when no verified compliance record exists.
- Additional screening answers (including vaccine-like items) also use attestation-style "Yes/Maybe" to mark requirements met.

---

## Field-by-Field Audit

Legend:

- **Should sync profile?**
  - `Yes`: durable worker fact or preference
  - `No`: application-specific answer only
  - `Conditional`: sync to attestation namespace only, not verified-compliance namespace
- **Assessment**
  - `OK`, `Duplicated`, `Wrong target`, `Missing target`, `Misleading`

| Wizard step / question | Application write path (today) | Current profile write(s) (today) | Should sync profile? | Correct profile target | Assessment |
|---|---|---|---|---|---|
| First name | `applications/{id}.data.personal.firstName` | `users/{uid}.firstName` | Yes | `users/{uid}.firstName` | OK (duplicated write timing) |
| Last name | `applications/{id}.data.personal.lastName` | `users/{uid}.lastName` | Yes | `users/{uid}.lastName` | OK (duplicated write timing) |
| Email | `applications/{id}.data.personal.email` | `users/{uid}.email` (+ auth email attempt) | Yes | `users/{uid}.email` | OK (duplicated write timing) |
| Phone | `applications/{id}.data.personal.phone` | `users/{uid}.phone` | Yes | `users/{uid}.phone` | OK (duplicated write timing) |
| DOB | `applications/{id}.data.personal.dob` | `users/{uid}.dob` | Yes | `users/{uid}.dob` | OK |
| Preferred language | `applications/{id}.data.personal.preferredLanguage` | `users/{uid}.preferredLanguage` | Yes | `users/{uid}.preferredLanguage` | OK |
| Street | `applications/{id}.data.personal.street` | `users/{uid}.address.street`, `users/{uid}.addressInfo.streetAddress` | Yes | Canonicalize one address object | Duplicated |
| Unit | `applications/{id}.data.personal.unit` | `users/{uid}.address.unit`, `users/{uid}.addressInfo.unitNumber` | Yes | Canonicalize one address object | Duplicated |
| City | `applications/{id}.data.personal.city` | `users/{uid}.address.city`, `users/{uid}.city`, `users/{uid}.addressInfo.city` | Yes | Canonicalize one address object | Duplicated |
| State | `applications/{id}.data.personal.state` | `users/{uid}.address.state`, `users/{uid}.state`, `users/{uid}.addressInfo.state` | Yes | Canonicalize one address object | Duplicated |
| Zip | `applications/{id}.data.personal.zip` | `users/{uid}.address.zipCode`, `users/{uid}.zipCode`, `users/{uid}.addressInfo.zip` | Yes | Canonicalize one address object | Duplicated |
| Home coordinates | `applications/{id}.data.personal.homeLat/homeLng` | `users/{uid}.homeLat/homeLng`, `users/{uid}.address.coordinates`, `users/{uid}.addressInfo.homeLat/homeLng` | Yes | Canonicalize one coordinate source | Duplicated |
| Work authorized | `applications/{id}.data.eligibility.workAuthorized` | `users/{uid}.workEligibility`, `users/{uid}.workEligibilityAttestation.authorizedToWorkUS` | Conditional | `users/{uid}.workEligibilityAttestation.*` | Mixed legacy + attestation |
| Requires sponsorship | `applications/{id}.data.eligibility.requireSponsorship` | `users/{uid}.requireSponsorship`, attestation mirror | Conditional | `users/{uid}.workEligibilityAttestation.requireSponsorship` | Duplicated |
| Gender/veteran/disability | `applications/{id}.data.eligibility.*` | `users/{uid}.gender`, `users/{uid}.veteranStatus`, `users/{uid}.disabilityStatus`, attestation mirror | Conditional | Keep under attestation + optional profile demographics | Duplicated |
| Profile picture | `applicationDrafts.data.profilePicture.profilePicture` (wizard state), not in final application payload as primary contract | `users/{uid}.avatar` | Yes | `users/{uid}.avatar` | OK |
| Resume uploaded | Not strongly represented in final app contract; parser updates local wizard state | Stored in profile resume structure (via upload component flow) | Yes | `users/{uid}.resume.*` | Missing clear app-level contract |
| Skills | `applications/{id}.data.qualifications.skills` | `users/{uid}.skills` (step + submit + job detail fix path) | Yes | `users/{uid}.skills` | OK (multi-writer duplication) |
| Languages | `applications/{id}.data.qualifications.languages` | `users/{uid}.languages` | Yes | `users/{uid}.languages` | OK |
| Education entries | `applications/{id}.data.qualifications.education` | `users/{uid}.education` | Yes | `users/{uid}.education` | OK |
| Education level quick fix (job detail) | `applications/{id}.data.requirements.acks.education_*` | `users/{uid}.educationLevel` | Conditional | Derive from `education[]`, avoid dual truth | Duplicated/misaligned shape |
| Certifications entries | `applications/{id}.data.qualifications.certifications` | `users/{uid}.certifications` | Yes | `users/{uid}.certifications` | OK but mixed object/string schema |
| Certification upload evidence | `applications/{id}.data.requirements.uploaded[{name}]` | `users/{uid}.certifications[{name,fileUrl,fileName,uploadedAt,...}]` | Conditional | Store evidence in certification object only | Duplicated, potential drift |
| Work experience | `applications/{id}.data.qualifications.workExperience/workHistory` | `users/{uid}.workExperience` + `users/{uid}.workHistory` | Yes | One canonical array + optional legacy mirror | Duplicated |
| Professional bio | `applications/{id}.data.bio.professionalBio` | `users/{uid}.professionalBio` | Yes | `users/{uid}.professionalBio` | OK |
| Target pay | `applications/{id}.data.preferences.targetPay` | `users/{uid}.preferences.targetPay` | Yes | `users/{uid}.preferences.targetPay` | OK |
| Shift preference(s) | `applications/{id}.data.preferences.shift/shiftPreferences` | `users/{uid}.preferences.shift/shiftPreferences` | Yes | `users/{uid}.preferences.shiftPreferences` | Slightly duplicated shape |
| Availability notes | `applications/{id}.data.preferences.availabilityNotes` | `users/{uid}.preferences.availabilityNotes` | Yes | `users/{uid}.preferences.availabilityNotes` | OK |
| Available start date | `applications/{id}.data.preferences.availableToStartDate` | `users/{uid}.availableToStartDate` and `users/{uid}.preferences.availableToStartDate` | Yes | `users/{uid}.preferences.availableToStartDate` | Duplicated |
| Transport method | `applications/{id}.data.requirements.transportMethod` | `users/{uid}.transportMethod` | Yes | `users/{uid}.transportMethod` (or `preferences.transportMethod`) | OK |
| E-Verify willingness | `applications/{id}.data.requirements.eVerifyComfort` | `users/{uid}.comfortableEVerify` | Conditional | `users/{uid}.attestations.eVerify.willingness` | **Wrong target / Misleading** |
| Drug screening willingness | `applications/{id}.data.requirements.drugScreeningComfort` | `users/{uid}.comfortablePassDrug` | Conditional | `users/{uid}.attestations.drugScreen.willingness` | **Wrong target / Misleading** |
| Drug explanation | `applications/{id}.data.requirements.drugExplanation` | `users/{uid}.passDrugExplanation` | Conditional | `users/{uid}.attestations.drugScreen.explanation` | Wrong namespace (attestation should be explicit) |
| Background willingness | `applications/{id}.data.requirements.backgroundScreeningComfort` | `users/{uid}.comfortablePassBackground` | Conditional | `users/{uid}.attestations.backgroundCheck.willingness` | **Wrong target / Misleading** |
| Background explanation | `applications/{id}.data.requirements.backgroundExplanation` | `users/{uid}.passBackgroundExplanation` | Conditional | `users/{uid}.attestations.backgroundCheck.explanation` | Wrong namespace |
| Additional screening answers | `applications/{id}.data.requirements.additionalScreenings[{name}]` | `users/{uid}.comfortableWith{ScreenName}` (dynamic) and/or `users/{uid}.additionalScreenings[{name}]` from job detail flow | Conditional | `users/{uid}.attestations.additionalScreenings[{name}]` | Wrong dynamic-field strategy |
| Vaccination answers (if listed as additional screening) | `applications/{id}.data.requirements.additionalScreenings[{vaccineName}]` | dynamic comfortable fields / additionalScreenings map | Conditional | `users/{uid}.attestations.vaccination[{requirement}]` | **Misleading if interpreted as verified** |
| Language comfort for requirement | `applications/{id}.data.requirements.languagesComfort` | `users/{uid}.comfortableWithLanguages` | No (application-specific for requirement) | Keep application-only answer | Wrongly promoted to durable profile |
| Physical requirement comfort | `applications/{id}.data.requirements.physicalRequirementsComfort` | `users/{uid}.comfortableWithPhysicalRequirements` | No (application-specific to posting) | Keep application-only answer | Wrongly promoted to durable profile |
| Uniform requirement comfort | `applications/{id}.data.requirements.uniformRequirementsComfort` | `users/{uid}.comfortableWithUniformRequirements` | No | Keep application-only answer | Wrongly promoted to durable profile |
| Custom uniform comfort | `applications/{id}.data.requirements.customUniformRequirementsComfort` | `users/{uid}.comfortableWithCustomUniformRequirements` | No | Keep application-only answer | Wrongly promoted to durable profile |
| Required PPE comfort | `applications/{id}.data.requirements.requiredPpeComfort` | `users/{uid}.comfortableWithRequiredPpe` | No | Keep application-only answer | Wrongly promoted to durable profile |
| Generic requirement acks (skills_*, languages_*, etc.) | `applications/{id}.data.requirements.acks.*` | `users/{uid}.requirementsAcks.*` (job detail path) | No (except selected durable domains) | Mostly application-only | Over-synced / noisy |

---

## Domain-Specific Findings Requested

### Skills

- Current behavior:
  - Application stores `data.qualifications.skills`.
  - Profile stores `users/{uid}.skills`.
  - Job detail "Fix requirement" also mutates `users/{uid}.skills`.
- Recommendation:
  - Keep profile sync for durable skill facts.
  - Keep application snapshot for historical application context.

### Languages

- Current behavior:
  - Durable list in `users/{uid}.languages`.
  - Requirement comfort also stored to `users/{uid}.comfortableWithLanguages`.
- Problem:
  - Comfort answer is posting-specific but currently promoted to profile.

### Education

- Current behavior:
  - `education[]` is durable and should sync.
  - `educationLevel` is separately written in some fix flows.
- Problem:
  - dual truth between list-based education and `educationLevel` scalar.

### Certifications

- Current behavior:
  - `users/{uid}.certifications` contains mixed string and object shapes.
  - Upload evidence and requirement uploaded flags can diverge.
- Recommendation:
  - Canonical cert object schema with evidence and verification status.

### Transportation

- Current behavior:
  - `transportMethod` synced to profile.
- Recommendation:
  - Keep as durable preference.

### Shift Preferences

- Current behavior:
  - synced to `users/{uid}.preferences.shiftPreferences`.
- Recommendation:
  - keep as durable preference; avoid redundant `shift` scalar where possible.

### Work Eligibility

- Current behavior:
  - boolean + attestation object both written.
- Recommendation:
  - attestation object should be canonical; boolean derived.

### Background Check Willingness / Drug Screening Willingness / E-Verify Willingness

- Current behavior:
  - written to top-level comfort fields and interpreted as "met" in requirement status utility.
- Problem:
  - willingness is treated like completion in eligibility UI.
- Required correction:
  - willingness must only be attestation.
  - verified completion must come from screening/compliance records only.

### Vaccination Answers

- Current behavior:
  - may be encoded as additional screening values and can count as met.
- Problem:
  - answer-based satisfaction can be mistaken for medical/compliance completion.
- Required correction:
  - separate attestation from verified record.

---

## Immediate Risk List

- `src/utils/jobRequirementStatus.ts` currently marks background/drug/E-Verify as met using willingness values from application/profile.
- `src/components/apply/steps/RequirementsAcknowledgementStep.tsx` writes willingness directly into profile comfort fields during form interaction (before submit).
- `src/pages/JobPostingDetail.tsx` requirement fix path also writes comfort fields on profile and can drive green states without verified orders/checklist.

---

## Bottom Line

Current architecture mixes three different data classes:

- durable worker profile facts,
- per-application answers,
- verified compliance outcomes.

The highest-severity defect is willingness being used as completion for screening requirements. This should be treated as a data-model bug, not only a UI bug.
