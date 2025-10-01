// Script to clean up duplicate fields in tenantIds structure
// Run this in the browser console while on the user profile page

const cleanupDuplicateFields = async () => {
  const { getFirestore, doc, getDoc, updateDoc } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
  const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
  
  const auth = getAuth();
  const db = getFirestore();
  
  if (!auth.currentUser) {
    console.error('❌ Not authenticated');
    return;
  }
  
  // Get the current user ID from the URL
  const currentPath = window.location.pathname;
  const userId = currentPath.split('/').pop();
  
  if (!userId) {
    console.error('❌ Could not determine user ID from URL');
    return;
  }
  
  console.log(`🧹 Cleaning up duplicate fields for user: ${userId}`);
  
  try {
    const userRef = doc(db, 'users', userId);
    const userDoc = await getDoc(userRef);
    
    if (!userDoc.exists()) {
      console.error('❌ User document not found');
      return;
    }
    
    const userData = userDoc.data();
    const tenantIds = userData.tenantIds || {};
    
    let hasChanges = false;
    const updateData = {};
    
    // Clean up each tenant's data
    for (const [tenantId, tenantData] of Object.entries(tenantIds)) {
      console.log(`🔍 Checking tenant: ${tenantId}`);
      
      // Clean up department/departmentId duplication
      if (tenantData.department && tenantData.departmentId) {
        console.log(`🧹 Found duplicate: department="${tenantData.department}" and departmentId="${tenantData.departmentId}"`);
        // Keep departmentId, remove department
        updateData[`tenantIds.${tenantId}.department`] = null;
        hasChanges = true;
      }
      
      // Clean up region/regionId duplication
      if (tenantData.region && tenantData.regionId) {
        console.log(`🧹 Found duplicate: region="${tenantData.region}" and regionId="${tenantData.regionId}"`);
        // Keep regionId, remove region
        updateData[`tenantIds.${tenantId}.region`] = null;
        hasChanges = true;
      }
    }
    
    if (hasChanges) {
      console.log('💾 Applying cleanup...');
      await updateDoc(userRef, updateData);
      console.log('✅ Cleanup completed successfully!');
      console.log('🔄 Please refresh the page to see the changes');
    } else {
      console.log('✅ No duplicate fields found - data is already clean!');
    }
    
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
  }
};

// Run the cleanup
cleanupDuplicateFields();
