# Mobile App User Profile Fields Inventory

This document lists all Firestore user profile fields that should be included in the Flutter mobile app, organized by logical groups and access levels.

## 📱 **Mobile App Implementation Notes**

- **Employee-Editable**: Fields users can view and edit in their own profile
- **Read-Only for Employees**: Fields users can view but not edit
- **Manager/Admin Only**: Fields only visible to managers and admins (not in mobile app)
- **Required Fields**: Must be collected during onboarding
- **Optional Fields**: Can be filled later or left empty

---

## 🧍 **Basic Identity Section (Employee-Editable)**

| Firestore Field | Form Label | Data Type | Required | Description | Mobile Implementation |
|----------------|------------|-----------|----------|-------------|----------------------|
| `firstName` | "First Name" | `string` | ✅ | User's first name | Text input, required |
| `lastName` | "Last Name" | `string` | ✅ | User's last name | Text input, required |
| `preferredName` | "Preferred Name" | `string` | ❌ | Name shown in chat/companion | Text input, optional |
| `email` | "Email Address" | `string` | ✅ | Primary email address | Email input, required |
| `phone` | "Phone Number" | `string` | ✅ | Primary phone number | Phone input, required |
| `dateOfBirth` | "Date of Birth" | `Date` | ✅ | Birth date for EEO reporting | Date picker, required |
| `gender` | "Gender" | `string` | ❌ | Gender identity | Dropdown: Male/Female/Nonbinary/Other/Prefer not to say |
| `languages` | "Languages Spoken" | `string[]` | ❌ | Languages user can speak | Multi-select chips |

---

## 🏢 **Employment Information (Read-Only for Employees)**

| Firestore Field | Form Label | Data Type | Required | Description | Mobile Implementation |
|----------------|------------|-----------|----------|-------------|----------------------|
| `employmentType` | "Employment Type" | `string` | ✅ | Full-Time/Part-Time/Contract/Flex | Read-only display |
| `department` | "Department" | `string` | ❌ | Department name | Read-only display |
| `jobTitle` | "Job Title" | `string` | ❌ | Primary job title | Read-only display |
| `startDate` | "Start Date" | `Date` | ❌ | Employment start date | Read-only display |
| `workStatus` | "Work Status" | `string` | ✅ | Active/On Leave/Terminated/etc. | Read-only display |
| `workerId` | "Worker ID" | `string` | ❌ | Custom ID from HRIS | Read-only display |
| `union` | "Union" | `string` | ❌ | Union affiliation | Read-only display |

---

## 📍 **Address & Location (Employee-Editable)**

| Firestore Field | Form Label | Data Type | Required | Description | Mobile Implementation |
|----------------|------------|-----------|----------|-------------|----------------------|
| `addressInfo.homeLat` | "Home Latitude" | `number` | ❌ | Home address latitude | Map picker, optional |
| `addressInfo.homeLng` | "Home Longitude" | `number` | ❌ | Home address longitude | Map picker, optional |
| `addressInfo.homeAddress` | "Home Address" | `string` | ❌ | Full home address | Text input, optional |
| `addressInfo.workLat` | "Work Latitude" | `number` | ❌ | Primary work location lat | Map picker, optional |
| `addressInfo.workLng` | "Work Longitude" | `number` | ❌ | Primary work location lng | Map picker, optional |
| `addressInfo.workAddress` | "Work Address" | `string` | ❌ | Primary work location | Text input, optional |
| `transportMethod` | "Transport Method" | `string` | ❌ | Primary transportation | Dropdown: Car/Public Transit/Bike/Walk |

---

## 🚨 **Emergency Contact (Employee-Editable)**

| Firestore Field | Form Label | Data Type | Required | Description | Mobile Implementation |
|----------------|------------|-----------|----------|-------------|----------------------|
| `emergencyContact.name` | "Emergency Contact Name" | `string` | ❌ | Emergency contact full name | Text input, optional |
| `emergencyContact.relationship` | "Relationship" | `string` | ❌ | Relationship to user | Text input, optional |
| `emergencyContact.phone` | "Emergency Contact Phone" | `string` | ❌ | Emergency contact phone | Phone input, optional |

---

## 🔒 **Privacy & Notifications (Employee-Editable)**

### Location Sharing Settings
| Firestore Field | Form Label | Data Type | Required | Description | Mobile Implementation |
|----------------|------------|-----------|----------|-------------|----------------------|
| `locationSettings.locationSharingEnabled` | "Enable Location Sharing" | `boolean` | ❌ | Master location sharing toggle | Switch, default false |
| `locationSettings.locationGranularity` | "Location Precision" | `string` | ❌ | Coarse/Fine/Precise | Dropdown, conditional |
| `locationSettings.locationUpdateFrequency` | "Update Frequency" | `string` | ❌ | Manual/Hourly/Real-time | Dropdown, conditional |
| `locationSettings.shareWithManagers` | "Share with Managers" | `boolean` | ❌ | Share location with managers | Switch, conditional |
| `locationSettings.shareWithCompanion` | "Share with AI Companion" | `boolean` | ❌ | Share location with AI | Switch, conditional |

### Notification Preferences
| Firestore Field | Form Label | Data Type | Required | Description | Mobile Implementation |
|----------------|------------|-----------|----------|-------------|----------------------|
| `notificationSettings.pushNotifications` | "Push Notifications" | `boolean` | ❌ | Enable push notifications | Switch, default true |
| `notificationSettings.emailNotifications` | "Email Notifications" | `boolean` | ❌ | Enable email notifications | Switch, default true |
| `notificationSettings.smsNotifications` | "SMS Notifications" | `boolean` | ❌ | Enable SMS notifications | Switch, default false |
| `notificationSettings.companionMessages` | "AI Companion Messages" | `boolean` | ❌ | Receive AI companion messages | Switch, default true |
| `notificationSettings.shiftReminders` | "Shift Reminders" | `boolean` | ❌ | Receive shift reminders | Switch, default true |
| `notificationSettings.safetyAlerts` | "Safety Alerts" | `boolean` | ❌ | Receive safety alerts | Switch, default true |
| `notificationSettings.performanceUpdates` | "Performance Updates" | `boolean` | ❌ | Receive performance updates | Switch, default false |
| `notificationSettings.quietHours.enabled` | "Enable Quiet Hours" | `boolean` | ❌ | Enable quiet hours | Switch, default false |
| `notificationSettings.quietHours.startTime` | "Quiet Hours Start" | `string` | ❌ | Quiet hours start time | Time picker, conditional |
| `notificationSettings.quietHours.endTime` | "Quiet Hours End" | `string` | ❌ | Quiet hours end time | Time picker, conditional |

### Privacy Controls
| Firestore Field | Form Label | Data Type | Required | Description | Mobile Implementation |
|----------------|------------|-----------|----------|-------------|----------------------|
| `privacySettings.profileVisibility` | "Profile Visibility" | `string` | ❌ | Public/Managers/Private | Dropdown, default "managers" |
| `privacySettings.showContactInfo` | "Show Contact Information" | `boolean` | ❌ | Show contact info to others | Switch, default true |
| `privacySettings.showLocation` | "Show Location Information" | `boolean` | ❌ | Show location to others | Switch, default false |
| `privacySettings.showPerformanceMetrics` | "Show Performance Metrics" | `boolean` | ❌ | Show performance to others | Switch, default false |
| `privacySettings.allowDataAnalytics` | "Allow Data Analytics" | `boolean` | ❌ | Allow data usage for analytics | Switch, default true |
| `privacySettings.allowAIInsights` | "Allow AI Insights" | `boolean` | ❌ | Allow AI insights generation | Switch, default true |

---

## 🎓 **Qualifications & Skills (Employee-Editable)**

| Firestore Field | Form Label | Data Type | Required | Description | Mobile Implementation |
|----------------|------------|-----------|----------|-------------|----------------------|
| `primaryJobTitle` | "Primary Job Title" | `string` | ❌ | Main job title | Text input, optional |
| `skills` | "Skills" | `string[]` | ❌ | List of skills | Multi-select with search |
| `certifications` | "Certifications" | `string[]` | ❌ | Professional certifications | Multi-select with add |
| `yearsExperience` | "Years of Experience" | `string` | ❌ | Total work experience | Dropdown: 0-1, 1-3, 3-5, 5-10, 10+ |
| `educationLevel` | "Education Level" | `string` | ❌ | Highest education level | Dropdown: High School, Associate's, Bachelor's, Master's, PhD |
| `specialTraining` | "Special Training" | `string` | ❌ | Additional training notes | Text area, optional |

---

## 📄 **Documents (Employee-Editable)**

| Firestore Field | Form Label | Data Type | Required | Description | Mobile Implementation |
|----------------|------------|-----------|----------|-------------|----------------------|
| `resume` | "Resume" | `object` | ❌ | Resume file and metadata | File upload, optional |
| `resume.url` | "Resume URL" | `string` | ❌ | Resume file URL | Read-only after upload |
| `resume.uploadedAt` | "Upload Date" | `Date` | ❌ | Resume upload timestamp | Read-only display |

---

## 🔍 **Read-Only Information (Employee View Only)**

### System Information
| Firestore Field | Form Label | Data Type | Required | Description | Mobile Implementation |
|----------------|------------|-----------|----------|-------------|----------------------|
| `uid` | "User ID" | `string` | ✅ | Firebase user ID | Read-only display |
| `tenantId` | "Organization" | `string` | ✅ | Associated organization | Read-only display |
| `createdAt` | "Account Created" | `Date` | ✅ | Account creation date | Read-only display |
| `updatedAt` | "Last Updated" | `Date` | ✅ | Last profile update | Read-only display |

### Work Eligibility
| Firestore Field | Form Label | Data Type | Required | Description | Mobile Implementation |
|----------------|------------|-----------|----------|-------------|----------------------|
| `workEligibility` | "Work Eligibility" | `boolean` | ✅ | Eligible to work | Read-only display |

---

## 📱 **Mobile App Implementation Guidelines**

### **Required Fields for Onboarding**
- First Name, Last Name, Email, Phone, Date of Birth
- Employment Type, Work Status
- Work Eligibility confirmation

### **Optional Fields (Can be filled later)**
- All other fields marked as ❌ Required

### **Permission-Based Access**
- **Employees**: Can view and edit their own profile fields
- **Managers**: Can view employee profiles but editing should be limited to web app
- **Admins**: Full access through web app only

### **Mobile UI Considerations**
- Use native form components for better UX
- Implement proper validation for required fields
- Add loading states for async operations
- Provide clear error messages
- Use appropriate input types (email, phone, date, etc.)
- Implement proper keyboard handling for form navigation

### **Data Synchronization**
- Sync changes in real-time with Firestore
- Handle offline scenarios gracefully
- Implement proper error handling for network issues
- Cache user data locally for offline access

### **Security Notes**
- Validate all user inputs on both client and server
- Implement proper authentication checks
- Ensure users can only edit their own data
- Log all profile changes for audit purposes 