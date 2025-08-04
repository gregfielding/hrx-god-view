// Script to reset user authentication state
// Run this in the browser console if you're having authentication issues

const resetUserAuth = async () => {
  console.log('🔧 Resetting user authentication state...');
  
  try {
    // Get current user
    const user = auth.currentUser;
    if (!user) {
      console.error('❌ No user logged in');
      return;
    }
    
    console.log('👤 Current user:', user.uid);
    
    // Get user document
    const userRef = doc(db, 'users', user.uid);
    const userSnap = await getDoc(userRef);
    
    if (!userSnap.exists()) {
      console.error('❌ User document not found');
      return;
    }
    
    const userData = userSnap.data();
    console.log('📄 Current user data:', userData);
    
    // Check if user has proper tenant data
    if (!userData.tenantIds || Object.keys(userData.tenantIds).length === 0) {
      console.log('⚠️ User has no tenant data, attempting to restore...');
      
      // Try to restore from HRX tenant
      const hrxTenantId = 'TgDJ4sIaC7x2n5cPs3rW';
      const hrxTenantRef = doc(db, 'tenants', hrxTenantId);
      const hrxTenantSnap = await getDoc(hrxTenantRef);
      
      if (hrxTenantSnap.exists()) {
        console.log('✅ HRX tenant found, restoring user access...');
        
        // Update user with HRX access
        await updateDoc(userRef, {
          tenantIds: {
            [hrxTenantId]: {
              role: 'HRX',
              securityLevel: '7'
            }
          },
          activeTenantId: hrxTenantId,
          orgType: 'HRX',
          role: 'HRX',
          securityLevel: '7',
          lastUpdated: serverTimestamp()
        });
        
        console.log('✅ User authentication restored! Please refresh the page.');
      } else {
        console.error('❌ HRX tenant not found');
      }
    } else {
      console.log('✅ User has tenant data:', userData.tenantIds);
      
      // Check if active tenant is valid
      const activeTenantId = userData.activeTenantId;
      if (activeTenantId && userData.tenantIds[activeTenantId]) {
        console.log('✅ Active tenant is valid:', activeTenantId);
        
        // Force refresh the user document
        await updateDoc(userRef, {
          lastUpdated: serverTimestamp()
        });
        
        console.log('✅ User data refreshed! Please refresh the page.');
      } else {
        console.log('⚠️ Active tenant is invalid, setting to first available tenant...');
        
        const firstTenantId = Object.keys(userData.tenantIds)[0];
        if (firstTenantId) {
          await updateDoc(userRef, {
            activeTenantId: firstTenantId,
            lastUpdated: serverTimestamp()
          });
          
          console.log('✅ Active tenant updated to:', firstTenantId);
          console.log('🔄 Please refresh the page.');
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Error resetting user auth:', error);
  }
};

// Add the function to window for easy access
window.resetUserAuth = resetUserAuth;

console.log('🔧 Reset script loaded! Run resetUserAuth() in the console to reset your authentication state.'); 