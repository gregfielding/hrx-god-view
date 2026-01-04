/**
 * Utility function to check if a user is missing any required licenses/certifications for a job posting
 * 
 * @param requiredCerts - Array of required certifications from job posting (e.g., ["Food Handler's License (License)", "CPR Certification (Certification)"])
 * @param userCerts - Array of user's certifications from their profile (objects with `name` property)
 * @returns Array of missing certification names
 */
export function checkMissingCertifications(
  requiredCerts: string[] | undefined,
  userCerts: Array<{ name?: string }> | undefined
): string[] {
  if (!requiredCerts || requiredCerts.length === 0) {
    return [];
  }

  if (!userCerts || userCerts.length === 0) {
    return requiredCerts;
  }

  // Normalize user cert names for comparison
  const userCertNames = userCerts
    .map(cert => {
      const name = typeof cert === 'string' ? cert : cert?.name;
      return name ? name.toLowerCase().trim() : '';
    })
    .filter(Boolean);

  // Check each required cert against user's certs
  const missing: string[] = [];
  
  for (const requiredCert of requiredCerts) {
    const requiredCertLower = requiredCert.toLowerCase().trim();
    
    // Check for exact match
    let found = userCertNames.some(userCert => userCert === requiredCertLower);
    
    // If not found, try partial matching (e.g., "Food Handler" matches "Food Handler's License")
    if (!found) {
      // Extract the main part of the cert name (before parentheses)
      const mainPart = requiredCertLower.split('(')[0].trim();
      found = userCertNames.some(userCert => {
        // Check if user cert contains the main part or vice versa
        return userCert.includes(mainPart) || mainPart.includes(userCert);
      });
    }
    
    if (!found) {
      missing.push(requiredCert);
    }
  }

  return missing;
}

