export function cleanPhoneNumber(phone: string): string {
  if (!phone || typeof phone !== 'string') {
    return '';
  }

  // Remove all non-digit characters except for the digits themselves
  let cleaned = phone.replace(/[^\d]/g, '');
  
  // Remove leading +1 or 1 if the number is 11 digits (US format)
  if (cleaned.length === 11 && (cleaned.startsWith('1') || cleaned.startsWith('11'))) {
    cleaned = cleaned.substring(1);
  }
  
  // Remove leading +1 if it's still there (shouldn't happen after above, but just in case)
  if (cleaned.startsWith('1') && cleaned.length === 10) {
    cleaned = cleaned.substring(1);
  }
  
  return cleaned;
}

export function cleanCompanyData(companies: any[]): any[] {
  let cleanedCount = 0;
  
  const cleanedCompanies = companies.map(company => {
    const originalPhone = company['Phone'] || '';
    const originalDisplayPhone = company['Display phone'] || '';
    const cleanedPhone = cleanPhoneNumber(originalPhone);
    const cleanedDisplayPhone = cleanPhoneNumber(originalDisplayPhone);
    
    // Log if phone numbers were cleaned
    if (originalPhone && originalPhone !== cleanedPhone) {
      console.log(`Cleaned company phone: "${originalPhone}" → "${cleanedPhone}"`);
      cleanedCount++;
    }
    if (originalDisplayPhone && originalDisplayPhone !== cleanedDisplayPhone) {
      console.log(`Cleaned company display phone: "${originalDisplayPhone}" → "${cleanedDisplayPhone}"`);
      cleanedCount++;
    }
    
    return {
      ...company,
      'Phone': cleanedPhone,
      'Display phone': cleanedDisplayPhone,
    };
  });
  
  if (cleanedCount > 0) {
    console.log(`Cleaned ${cleanedCount} phone numbers in companies`);
  }
  
  return cleanedCompanies;
}

export function cleanContactData(contacts: any[]): any[] {
  let cleanedCount = 0;
  
  const cleanedContacts = contacts.map(contact => {
    const originalPhone = contact['Phone'] || '';
    const originalMobile = contact['Mobile'] || '';
    const cleanedPhone = cleanPhoneNumber(originalPhone);
    const cleanedMobile = cleanPhoneNumber(originalMobile);
    
    // Log if phone numbers were cleaned
    if (originalPhone && originalPhone !== cleanedPhone) {
      console.log(`Cleaned contact phone: "${originalPhone}" → "${cleanedPhone}"`);
      cleanedCount++;
    }
    if (originalMobile && originalMobile !== cleanedMobile) {
      console.log(`Cleaned contact mobile: "${originalMobile}" → "${cleanedMobile}"`);
      cleanedCount++;
    }
    
    return {
      ...contact,
      'Phone': cleanedPhone,
      'Mobile': cleanedMobile,
    };
  });
  
  if (cleanedCount > 0) {
    console.log(`Cleaned ${cleanedCount} phone numbers in contacts`);
  }
  
  return cleanedContacts;
} 