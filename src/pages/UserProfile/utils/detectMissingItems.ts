interface MissingItem {
  id: string;
  type: 'error' | 'warning' | 'info';
  message: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface ProfileData {
  workEligibility?: boolean;
  resume?: {
    fileName: string;
    timestamp?: Date | any;
    downloadUrl?: string;
    storagePath?: string;
    size?: number;
    sizeKB?: number;
  } | null;
  certifications?: Array<{
    name: string;
    expirationDate?: string | Date | any;
    dateObtained?: string | Date | any;
  }>;
  emergencyContact?: {
    name?: string;
    phone?: string;
    relationship?: string;
  } | null;
  backgroundCheckStatus?: string;
  vaccinationStatus?: string;
  phone?: string;
  email?: string;
  dateOfBirth?: Date | string | any;
}

// Helper function to check if a date value is valid and present
const hasValidDateOfBirth = (dob: Date | string | any): boolean => {
  if (!dob) return false;
  
  // Handle Firestore Timestamp
  if (dob?.toDate && typeof dob.toDate === 'function') {
    const date = dob.toDate();
    return date instanceof Date && !isNaN(date.getTime());
  }
  
  // Handle Date object
  if (dob instanceof Date) {
    return !isNaN(dob.getTime());
  }
  
  // Handle string
  if (typeof dob === 'string' && dob.trim() !== '') {
    const date = new Date(dob);
    return !isNaN(date.getTime());
  }
  
  // Handle timestamp number
  if (typeof dob === 'number' && dob > 0) {
    const date = new Date(dob);
    return !isNaN(date.getTime());
  }
  
  // Handle objects with _seconds (Firestore Timestamp structure)
  if (dob?._seconds && typeof dob._seconds === 'number') {
    const date = new Date(dob._seconds * 1000);
    return !isNaN(date.getTime());
  }
  
  return false;
};

export const detectMissingItems = (
  profileData: ProfileData,
  onTabChange?: (tab: string) => void
): MissingItem[] => {
  const items: MissingItem[] = [];

  // Critical items (error level)
  
  // Missing Work Eligibility
  if (profileData.workEligibility === undefined || profileData.workEligibility === false) {
    items.push({
      id: 'missing_work_eligibility',
      type: 'error',
      message: 'Missing Work Eligibility Document',
      action: onTabChange ? {
        label: 'Add Work Eligibility',
        onClick: () => onTabChange('Work Eligibility'),
      } : undefined,
    });
  }

  // Missing I-9 / Work Eligibility Document
  // Note: This might need to check a specific document collection
  // For now, we'll use workEligibility boolean as proxy
  
  // Missing Date of Birth (required for eligibility)
  // Check if dateOfBirth is valid and present
  if (!hasValidDateOfBirth(profileData.dateOfBirth)) {
    items.push({
      id: 'missing_dob',
      type: 'warning',
      message: 'Missing Date of Birth',
      action: onTabChange ? {
        label: 'Add DOB',
        onClick: () => onTabChange('Overview'),
      } : undefined,
    });
  }

  // Missing Phone
  if (!profileData.phone) {
    items.push({
      id: 'missing_phone',
      type: 'warning',
      message: 'Missing Phone Number',
      action: onTabChange ? {
        label: 'Add Phone',
        onClick: () => onTabChange('Overview'),
      } : undefined,
    });
  }

  // Warning items

  // Missing Resume
  if (!profileData.resume || !profileData.resume.fileName) {
    items.push({
      id: 'missing_resume',
      type: 'warning',
      message: 'Missing Resume',
      action: onTabChange ? {
        label: 'Upload Resume',
        onClick: () => onTabChange('Resumé'),
      } : undefined,
    });
  } else {
    // Resume older than 6 months
    const resumeTimestamp = profileData.resume.timestamp;
    if (resumeTimestamp) {
      const resumeDate = resumeTimestamp instanceof Date 
        ? resumeTimestamp 
        : resumeTimestamp?.toDate 
        ? resumeTimestamp.toDate() 
        : new Date(resumeTimestamp);
      
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      
      if (resumeDate < sixMonthsAgo) {
        const monthsAgo = Math.floor(
          (new Date().getTime() - resumeDate.getTime()) / (1000 * 60 * 60 * 24 * 30)
        );
        items.push({
          id: 'resume_old',
          type: 'warning',
          message: `Resume older than 6 months (${monthsAgo} months)`,
          action: onTabChange ? {
            label: 'Update Resume',
            onClick: () => onTabChange('Resumé'),
          } : undefined,
        });
      }
    }
  }

  // Expired Certifications
  if (profileData.certifications && profileData.certifications.length > 0) {
    profileData.certifications.forEach((cert, index) => {
      if (cert.expirationDate) {
        const expirationDate = cert.expirationDate instanceof Date
          ? cert.expirationDate
          : cert.expirationDate?.toDate
          ? cert.expirationDate.toDate()
          : new Date(cert.expirationDate);
        
        const now = new Date();
        if (expirationDate < now) {
          const daysAgo = Math.floor(
            (now.getTime() - expirationDate.getTime()) / (1000 * 60 * 60 * 24)
          );
          items.push({
            id: `expired_cert_${index}`,
            type: 'warning',
            message: `Expired Certification: ${cert.name} (${daysAgo} days ago)`,
            action: onTabChange ? {
              label: 'Update Certification',
              onClick: () => onTabChange('Certifications'),
            } : undefined,
          });
        } else {
          // Cert expiring soon (within 30 days)
          const daysUntilExpiration = Math.floor(
            (expirationDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
          );
          if (daysUntilExpiration <= 30 && daysUntilExpiration > 0) {
            items.push({
              id: `expiring_cert_${index}`,
              type: 'info',
              message: `Certification expiring soon: ${cert.name} (${daysUntilExpiration} days)`,
              action: onTabChange ? {
                label: 'Update Certification',
                onClick: () => onTabChange('Certifications'),
              } : undefined,
            });
          }
        }
      }
    });
  }

  // Missing Background Check
  if (!profileData.backgroundCheckStatus || 
      profileData.backgroundCheckStatus.toLowerCase() === 'pending' ||
      profileData.backgroundCheckStatus.toLowerCase() === 'not started') {
    items.push({
      id: 'missing_background_check',
      type: 'warning',
      message: 'Background Check Not Complete',
      action: onTabChange ? {
        label: 'Start Background Check',
        onClick: () => onTabChange('Backgrounds'),
      } : undefined,
    });
  }

  return items;
};

