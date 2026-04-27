# User Profile Fields & Data Inventory

## Overview
This document provides a comprehensive inventory of all fields and data available in the User Profile system, organized by tab/section. This inventory is intended to help identify what information can be surfaced in the header and Overview tab to reduce reliance on deep navigation.

---

## 📋 Current Tab Structure

1. **Overview** - Basic identity, employment info, address, emergency contact
2. **Work Eligibility** - Work authorization, EEO info, veteran/disability status
3. **Resumé** - Resume upload/download
4. **Skills** - Skills, languages, job titles, behavioral traits
5. **Education** - Education history (array)
6. **Work Experience** - Work history (array)
7. **Qualifications** - Bio, experience summary, skills/languages summary
8. **Preferences** - Job preferences, availability, shift preferences
9. **Licenses & Certs** - Certifications/licenses (array)
10. **Applications** - Job applications history
11. **Assignments** - Job assignments/history
12. **Background & Vaccination** - Background check status, vaccination status
13. **Reports & Insights** - JSI scores, traits, engagement data
14. **Notes** - Internal notes/comments
15. **Activity Log** - System activity history
16. **User Groups** - Group memberships
17. **System Access** - Security level, module access
18. **Privacy & Notifications** - Privacy and notification settings

---

## 🧍 BASIC IDENTITY (Overview Tab)

| Field | Type | Current Location | Description |
|-------|------|------------------|-------------|
| `firstName` | string | Header, Overview | User's first name |
| `lastName` | string | Header, Overview | User's last name |
| `preferredName` | string | Header, Overview | Preferred/nickname |
| `email` | string | Header, Overview | Primary email address |
| `phone` | string | Header, Overview | Primary phone number |
| `phoneE164` | string | Overview | E.164 formatted phone |
| `phoneVerified` | boolean | Overview | Phone verification status |
| `phoneVerifiedAt` | Date | Overview | When phone was verified |
| `dateOfBirth` / `dob` | Date/string | Overview | Date of birth (EEO/eligibility) |
| `gender` | string | Overview | Gender identity |
| `avatar` | string | Header | Profile photo URL |
| `linkedinUrl` | string | Overview | LinkedIn profile URL |

---

## 📍 EMPLOYMENT & ORGANIZATIONAL (Overview Tab)

| Field | Type | Current Location | Description |
|-------|------|------------------|-------------|
| `securityLevel` | string ('0'-'7') | Header, Overview | Access level (0=Suspended, 1=Applicant, 2=Flex, 3=Worker, 4=Manager, 5=Admin) |
| `employmentType` | string | Header, Overview | Full-Time/Part-Time/Contract/Flex |
| `workStatus` | string | Header, Overview | Active/On Leave/Terminated/Suspended/Pending |
| `jobTitle` / `primaryJobTitle` | string | Header, Overview | Current job title |
| `startDate` | Date | Overview | Employment start date |
| `workerId` | string | Overview | Custom HRIS ID |
| `union` | string | Overview | Union name/affiliation |
| `departmentId` | string | Overview | Department reference ID |
| `department` | string | Overview | Department name (legacy) |
| `divisionId` | string | Overview | Division reference ID |
| `locationId` | string | Overview | Location reference ID |
| `regionId` | string | Overview | Region reference ID |
| `managerId` | string | Overview | Manager user ID |
| `managerName` | string | Overview | Manager display name (resolved) |

---

## 🏠 ADDRESS & LOCATION (Overview Tab)

| Field | Type | Current Location | Description |
|-------|------|------------------|-------------|
| `addressInfo.streetAddress` | string | Overview | Street address |
| `addressInfo.unitNumber` | string | Overview | Apartment/unit number |
| `addressInfo.city` | string | Header, Overview | City |
| `addressInfo.state` | string | Header, Overview | State |
| `addressInfo.zip` | string | Overview | ZIP code |
| `addressInfo.homeLat` | number | Overview | Home latitude |
| `addressInfo.homeLng` | number | Overview | Home longitude |
| `addressInfo.workLat` | number | Overview | Work latitude |
| `addressInfo.workLng` | number | Overview | Work longitude |
| `addressInfo.currentLat` | number | Overview | Current location latitude |
| `addressInfo.currentLng` | number | Overview | Current location longitude |
| `city` | string | Header (legacy) | City (direct field) |
| `state` | string | Header (legacy) | State (direct field) |
| `zipCode` | string | (legacy) | ZIP code (direct field) |
| `transportMethod` | string | Overview | Car/Public Transit/Bike/Walk/Other |

---

## 🆘 EMERGENCY CONTACT (Overview Tab)

| Field | Type | Current Location | Description |
|-------|------|------------------|-------------|
| `emergencyContact.name` | string | Overview | Emergency contact name |
| `emergencyContact.relationship` | string | Overview | Relationship to user |
| `emergencyContact.phone` | string | Overview | Emergency contact phone |

---

## ✅ WORK ELIGIBILITY & COMPLIANCE (Work Eligibility Tab, Background & Vaccination Tab)

| Field | Type | Current Location | Description |
|-------|------|------------------|-------------|
| `workEligibility` | boolean | Header, Overview | Work authorization status |
| `requireSponsorship` | boolean | Work Eligibility Tab | Requires visa sponsorship |
| `workAuthorization` | string | Work Eligibility Tab | Work authorization type |
| `workAuthExpiry` | Date | Work Eligibility Tab | Authorization expiration |
| `veteranStatus` | string | Work Eligibility Tab | Veteran status (EEO) |
| `disabilityStatus` | string | Work Eligibility Tab | Disability status (EEO) |
| `backgroundCheckStatus` | string | Background Tab, Header | Status (Complete/Pending/Failed) |
| `vaccinationStatus` | string | Background Tab, Header | Vaccination status |

---

## 📄 RESUME & DOCUMENTS (Resumé Tab, Overview)

| Field | Type | Current Location | Description |
|-------|------|------------------|-------------|
| `resume.fileName` | string | Header, Overview, Resumé Tab | Resume filename |
| `resume.size` | number | Overview, Resumé Tab | File size in bytes |
| `resume.sizeKB` | number | Overview | File size in KB |
| `resume.timestamp` | Date | Overview, Resumé Tab | Upload date |
| `resume.storagePath` | string | Resumé Tab | Firebase Storage path |
| `resume.downloadUrl` | string | Resumé Tab | Download URL |

---

## 🎓 EDUCATION (Education Tab)

| Field | Type | Current Location | Description |
|-------|------|------------------|-------------|
| `education` | array | Education Tab | Education history array |
| `education[].school` | string | Education Tab | School name |
| `education[].degree` | string | Education Tab | Degree type |
| `education[].field` | string | Education Tab | Field of study |
| `education[].startDate` | Date | Education Tab | Start date |
| `education[].endDate` | Date | Education Tab | End date |
| `education[].isCurrent` | boolean | Education Tab | Currently enrolled |
| `educationLevel` | string | Header, Overview | Highest education level (summary) |

---

## 💼 WORK EXPERIENCE (Work Experience Tab)

| Field | Type | Current Location | Description |
|-------|------|------------------|-------------|
| `workExperience` / `workHistory` | array | Work Experience Tab | Work history array |
| `workExperience[].company` | string | Work Experience Tab | Company name |
| `workExperience[].title` | string | Work Experience Tab | Job title |
| `workExperience[].startDate` | Date | Work Experience Tab | Start date |
| `workExperience[].endDate` | Date | Work Experience Tab | End date |
| `workExperience[].isCurrent` | boolean | Work Experience Tab | Current job |
| `workExperience[].description` | string | Work Experience Tab | Job description |
| `yearsExperience` | string | Header, Overview | Total years of experience (summary) |

---

## 🛠️ SKILLS & QUALIFICATIONS (Skills Tab, Qualifications Tab)

| Field | Type | Current Location | Description |
|-------|------|------------------|-------------|
| `skills` | array | Skills Tab, Overview | Skills array (mixed types: strings/objects) |
| `skills[].name` | string | Skills Tab | Skill name |
| `skills[].canonicalId` | string | Skills Tab | Canonical skill ID |
| `skills[].source` | string | Skills Tab | 'predefined' or 'custom' |
| `skills[].type` | string | Skills Tab | Skill category/type |
| `skills[].level` | string | Skills Tab | Beginner/Intermediate/Advanced/Expert |
| `skills[].confidence` | number | Skills Tab | Confidence score |
| `languages` | array | Skills Tab, Overview | Languages array (mixed types) |
| `languages[].language` | string | Skills Tab | Language name |
| `languages[].proficiency` | string | Skills Tab | Basic/Conversational/Fluent/Native |
| `languages[].isNative` | boolean | Skills Tab | Native speaker |
| `currentJobTitle` | string | Skills Tab | Current job title |
| `appliedJobTitle` | string | Skills Tab | Applied job title |
| `aspirationalJobTitles` | array | Skills Tab | Desired job titles |
| `specialTraining` | string | Skills Tab | Special training/certifications |
| `experienceSummary` | string | Qualifications Tab | Experience summary text |
| `bio` / `professionalBio` | string | Qualifications Tab | Professional bio |
| `traitsProfile` | object | Skills Tab | Behavioral traits profile (AI-generated) |
| `traitsProfile.traits` | array | Skills Tab | Behavioral traits array |
| `traitsProfile.topTraits` | array | Skills Tab | Top traits array |

---

## 🏅 CERTIFICATIONS & LICENSES (Licenses & Certs Tab)

| Field | Type | Current Location | Description |
|-------|------|------------------|-------------|
| `certifications` | array | Licenses Tab, Overview | Certifications array |
| `certifications[].name` | string | Licenses Tab | Certification name |
| `certifications[].issuer` | string | Licenses Tab | Issuing organization |
| `certifications[].dateObtained` | Date | Licenses Tab | Date obtained |
| `certifications[].expirationDate` | Date | Licenses Tab | Expiration date |
| `certifications[].fileName` | string | Licenses Tab | Certificate file name |
| `certifications[].fileUrl` | string | Licenses Tab | Certificate file URL |
| `certifications[].uploadedAt` | Date | Licenses Tab | Upload timestamp |

---

## ⚙️ JOB PREFERENCES (Preferences Tab)

| Field | Type | Current Location | Description |
|-------|------|------------------|-------------|
| `preferences.shiftPreferences` | array | Preferences Tab | Preferred shifts |
| `preferences.industryPreferences` | array | Preferences Tab | Preferred industries |
| `preferences.targetPay` | string | Preferences Tab | Target pay rate |
| `preferences.shift` | string | Preferences Tab | Preferred shift |
| `preferences.availabilityNotes` | string | Preferences Tab | Availability notes |
| `availableToStartDate` | Date | Preferences Tab | Earliest start date |
| `remoteWorkPreferences` | array | Skills Tab | Remote work preferences |
| `communicationPreferences` | array | Skills Tab | Communication preferences |
| `workEnvironmentPreferences` | array | Skills Tab | Work environment preferences |
| `preferredLearningMethods` | array | Skills Tab | Learning method preferences |
| `industryPreferences` | array | Skills Tab | Industry preferences |
| `salaryExpectations` | object | Skills Tab | Min/target/max salary |
| `workPreferences.schedule` | string | Skills Tab | Schedule preference |
| `workPreferences.travelWillingness` | number | Skills Tab | Travel willingness (0-100) |
| `workPreferences.relocationWillingness` | boolean | Skills Tab | Willing to relocate |
| `workPreferences.relocationLocations` | array | Skills Tab | Preferred relocation locations |
| `workPreferences.benefitsPreferences` | array | Skills Tab | Benefits preferences |

---

## 📊 APPLICATIONS & ASSIGNMENTS

| Field | Type | Current Location | Description |
|-------|------|------------------|-------------|
| `applicationIds` | array | Applications Tab | Array of application IDs |
| `activeApplicationsCount` | number | Header, Overview | Count of active applications |
| (Applications data fetched from `tenants/{tenantId}/applications/{uid}_{jobId}`) | | Applications Tab | Full application details |
| (Assignments data fetched from assignments collection) | | Assignments Tab | Job assignment history |

---

## 📈 ANALYTICS & INSIGHTS (Reports & Insights Tab)

| Field | Type | Current Location | Description |
|-------|------|------------------|-------------|
| `jobSatisfactionIndex` | number | Reports Tab | JSI score (1-100) |
| `jsiHistory` | array | Reports Tab | JSI score history |
| `burnoutRiskScore` | number | Reports Tab | Burnout risk (1-100) |
| `traitsData` | array | Reports Tab | Detailed traits data |
| `momentsData` | array | Reports Tab | Engagement moments |
| `feedbackData` | object | Reports Tab | Feedback analysis |
| `learningData` | object | Reports Tab | Learning progress |
| `selfImprovementData` | object | Reports Tab | Self-improvement tracking |
| `careerPathSuggestions` | array | (Schema) | AI-generated career suggestions |
| `profileScore` | number | Header, Overview | Profile completeness score (0-100) |

---

## 📝 NOTES & ACTIVITY (Notes Tab, Activity Log Tab)

| Field | Type | Current Location | Description |
|-------|------|------------------|-------------|
| (Notes stored in separate collection) | | Notes Tab | Internal notes/comments |
| (Activity log stored in separate collection) | | Activity Log Tab | System activity history |

---

## 🔐 SYSTEM & ACCESS (System Access Tab, Overview)

| Field | Type | Current Location | Description |
|-------|------|------------------|-------------|
| `uid` | string | All tabs | User ID |
| `tenantId` | string | Overview | Tenant ID |
| `activeTenantId` | string | Overview | Active tenant ID |
| `tenantIds` | object | Overview | Multi-tenant structure |
| `createdBy` | string | Overview | Creator user ID |
| `source` | string | Overview | Manual/Import/Job App/Flex Sign-Up |
| `createdAt` | Date | Overview | Account creation date |
| `updatedAt` | Date | Overview | Last update timestamp |
| `loginCount` | number | Overview | Number of logins |
| `lastLoginAt` | Date | Overview | Last login timestamp |
| `crm_sales` | boolean | System Access Tab | CRM/Sales module access |
| `recruiter` | boolean | System Access Tab | Recruiter module access |
| `jobsBoard` | boolean | System Access Tab | Jobs Board module access |
| `userGroupIds` | array | User Groups Tab | Group membership IDs |

---

## 🔒 PRIVACY & NOTIFICATIONS (Privacy & Notifications Tab)

| Field | Type | Current Location | Description |
|-------|------|------------------|-------------|
| `privacySettings.profileVisibility` | string | Privacy Tab | public/private/team |
| `privacySettings.showContactInfo` | boolean | Privacy Tab | Show contact info |
| `privacySettings.showSchedule` | boolean | Privacy Tab | Show schedule |
| `privacySettings.allowDataAnalytics` | boolean | Privacy Tab | Allow analytics |
| `privacySettings.allowLocationSharing` | boolean | Privacy Tab | Allow location sharing |
| `notificationSettings.*` | object | Privacy Tab | Various notification preferences |
| `locationSettings.*` | object | Overview | Location sharing settings |

---

## 🏢 ORGANIZATIONAL HIERARCHY (Resolved from References)

| Field | Type | Current Location | Description |
|-------|------|------------------|-------------|
| `departmentName` | string | Overview | Department name (resolved) |
| `locationName` | string | Overview | Location name (resolved) |
| `divisionName` | string | Overview | Division name (resolved) |
| `regionName` | string | Overview | Region name (resolved) |
| `managerName` | string | Overview | Manager name (resolved) |

---

## 📱 MOBILE/COMPANION SPECIFIC

| Field | Type | Current Location | Description |
|-------|------|------------------|-------------|
| `companionLastActiveAt` | Date | (Schema) | Last Companion activity |
| `externalIds` | object | (Schema) | External system IDs (Workday, ADP, etc.) |

---

## Summary Statistics for Quick Display

**Currently in Header/Overview:**
- Name, preferred name
- Job title
- Location (city, state)
- Phone, email (with copy buttons)
- Status chips (Work Eligible, Active, Applicant Type, Role)
- Profile quality score (80%)
- Quick action buttons
- Missing items banner

**Currently in QuickInfoBar (below tabs):**
- Documents (resume preview)
- Metrics (score, certifications count, applications count, years experience, education level)
- Compliance (work eligibility, background check, vaccination)
- At a Glance (skills, languages, behavioral traits)

**Could potentially be added to Header/Overview:**
- Years of experience (currently only in QuickInfoBar)
- Education level (currently only in QuickInfoBar)
- Emergency contact status (quick indicator)
- Resume status/age
- Certification count with expiration warnings
- Active applications count
- Last activity/login timestamp
- Department/Location/Division (organizational hierarchy)
- Manager name
- Start date
- Work authorization status/expiry
- Veteran/Disability status (EEO)
- LinkedIn profile link
- Bio/experience summary (truncated)
- Top skills (beyond what's in QuickInfoBar)
- Preferred job titles/aspirations
- Availability/start date
- Transport method
- Phone verification status

---

## Notes for Header/Overview Redesign

1. **Profile Quality Score** - Already visible, good
2. **Missing Items Banner** - Already visible, good
3. **Quick Actions** - Already visible, good
4. **Contact Info** - Already visible with copy buttons, good

**Potential Enhancements:**
- Show more compliance indicators at a glance (not just chips)
- Surface education/experience summaries more prominently
- Show certification status with expiration warnings
- Display organizational hierarchy (dept/location/manager) more prominently
- Add "quick stats" row (years exp, education, certs, applications)
- Show availability/start date if applicable
- Display bio/experience summary (truncated) for quick context
- Add emergency contact quick access
- Show last activity/login timestamp for recruiter context

