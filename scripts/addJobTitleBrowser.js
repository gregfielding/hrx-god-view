/**
 * Browser Console Script to Add Job Title
 * 
 * Copy and paste this into your browser console while on the HRX app
 * Replace 'YOUR_TENANT_ID' with your actual tenant ID, or use the code below to auto-detect it
 * 
 * Usage:
 *   1. Open your browser console (F12)
 *   2. Make sure you're logged into the HRX app
 *   3. Paste this entire script and run it
 */

(async function() {
  // Auto-detect tenant ID from current user
  const auth = window.firebase?.auth?.();
  if (!auth) {
    console.error('Firebase not found. Make sure you are on the HRX app.');
    return;
  }

  const user = auth.currentUser;
  if (!user) {
    console.error('Not logged in. Please log in first.');
    return;
  }

  // Get tenant ID from user's custom claims or user document
  let tenantId = null;
  try {
    const token = await user.getIdTokenResult();
    const tenantIds = Object.keys(token.claims.roles || {});
    if (tenantIds.length > 0) {
      tenantId = tenantIds[0]; // Use first tenant ID
      console.log('Auto-detected tenant ID:', tenantId);
    } else {
      // Fallback: try to get from user document
      const { doc, getDoc } = await import('firebase/firestore');
      const { db } = await import('./firebase');
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      if (userDoc.exists()) {
        tenantId = userDoc.data().tenantId;
        console.log('Got tenant ID from user document:', tenantId);
      }
    }
  } catch (error) {
    console.error('Error getting tenant ID:', error);
    console.log('Please manually set tenantId in the script below');
  }

  if (!tenantId) {
    console.error('Could not determine tenant ID. Please set it manually:');
    console.log('const tenantId = "YOUR_TENANT_ID_HERE";');
    return;
  }

  // Job title to add
  const jobTitle = 'Catering Service Attendant';

  try {
    const { collection, addDoc, doc, getDoc, setDoc } = await import('firebase/firestore');
    const { db } = await import('./firebase');

    const newJobTitle = {
      title: jobTitle.trim(),
      description: '',
      experience: '',
      education: '',
      certifications: [],
      skills: [],
      licenses: [],
      languages: [],
      physicalRequirements: [],
      shiftType: [],
      payRange: '',
    };

    // Try to add to subcollection first
    try {
      const jobTitlesCollection = collection(
        db,
        'tenants',
        tenantId,
        'modules',
        'hrx-flex',
        'jobTitles'
      );
      await addDoc(jobTitlesCollection, newJobTitle);
      console.log(`✅ Successfully added "${jobTitle}" to subcollection`);
    } catch (subcollectionError) {
      console.log('⚠️  Subcollection add failed, trying module settings...');
      
      // If subcollection fails, add to module settings
      const flexModuleRef = doc(db, 'tenants', tenantId, 'modules', 'hrx-flex');
      const flexDoc = await getDoc(flexModuleRef);
      const currentData = flexDoc.exists() ? flexDoc.data() : {};
      const existingJobTitles = currentData?.jobTitles || [];
      
      // Check if job title already exists
      if (existingJobTitles.some((jt) => jt.title === jobTitle.trim())) {
        console.log(`⚠️  Job title "${jobTitle}" already exists in module settings`);
        return;
      }
      
      await setDoc(
        flexModuleRef,
        {
          ...currentData,
          jobTitles: [...existingJobTitles, newJobTitle],
        },
        { merge: true }
      );
      console.log(`✅ Successfully added "${jobTitle}" to module settings`);
    }

    console.log(`\n✅ Job title "${jobTitle}" has been added successfully!`);
    console.log('Refresh the page to see it in the dropdown.');
  } catch (error) {
    console.error('❌ Error adding job title:', error);
  }
})();

