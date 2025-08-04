// Script to fix user permissions after data restoration
// Run this in the browser console to restore proper user permissions

const fixUserPermissions = async () => {
  console.log('🔧 Fixing user permissions...');
  
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
    
    // Check current tenantIds structure
    const currentTenantIds = userData.tenantIds;
    const activeTenantId = userData.activeTenantId;
    
    console.log('🔍 Current tenantIds:', currentTenantIds);
    console.log('🔍 Active tenant ID:', activeTenantId);
    
    // Fix tenantIds structure if needed
    let fixedTenantIds = {};
    
    if (currentTenantIds) {
      if (Array.isArray(currentTenantIds)) {
        // Convert array to proper object structure
        console.log('🔄 Converting array to object structure...');
        currentTenantIds.forEach(tenantId => {
          fixedTenantIds[tenantId] = {
            role: 'Tenant',
            securityLevel: '6' // Default to admin level
          };
        });
      } else if (typeof currentTenantIds === 'object') {
        // Check if it's already in the correct format
        const firstKey = Object.keys(currentTenantIds)[0];
        if (firstKey && typeof currentTenantIds[firstKey] === 'object' && currentTenantIds[firstKey].securityLevel) {
          console.log('✅ TenantIds already in correct format');
          fixedTenantIds = currentTenantIds;
        } else {
          // Convert simple object to proper structure
          console.log('🔄 Converting simple object to proper structure...');
          Object.keys(currentTenantIds).forEach(tenantId => {
            fixedTenantIds[tenantId] = {
              role: 'Tenant',
              securityLevel: '6' // Default to admin level
            };
          });
        }
      }
    }
    
    // If no tenantIds, try to restore from HRX
    if (Object.keys(fixedTenantIds).length === 0) {
      console.log('⚠️ No tenantIds found, restoring HRX access...');
      const hrxTenantId = 'TgDJ4sIaC7x2n5cPs3rW';
      fixedTenantIds[hrxTenantId] = {
        role: 'HRX',
        securityLevel: '7'
      };
      
      if (!activeTenantId) {
        console.log('🔄 Setting active tenant to HRX...');
        await updateDoc(userRef, {
          tenantIds: fixedTenantIds,
          activeTenantId: hrxTenantId,
          orgType: 'HRX',
          role: 'HRX',
          securityLevel: '7',
          lastUpdated: serverTimestamp()
        });
      } else {
        await updateDoc(userRef, {
          tenantIds: fixedTenantIds,
          orgType: 'HRX',
          role: 'HRX',
          securityLevel: '7',
          lastUpdated: serverTimestamp()
        });
      }
    } else {
      // Update with fixed structure
      console.log('🔄 Updating user with fixed tenantIds structure...');
      console.log('📋 Fixed tenantIds:', fixedTenantIds);
      
      // Determine the proper role and security level
      let userRole = 'Tenant';
      let userSecurityLevel = '5';
      let userOrgType = 'Tenant';
      
      // Check if user has HRX access
      if (fixedTenantIds['TgDJ4sIaC7x2n5cPs3rW']) {
        userRole = 'HRX';
        userSecurityLevel = '7';
        userOrgType = 'HRX';
      } else if (activeTenantId && fixedTenantIds[activeTenantId]) {
        userRole = fixedTenantIds[activeTenantId].role || 'Tenant';
        userSecurityLevel = fixedTenantIds[activeTenantId].securityLevel || '5';
      }
      
      await updateDoc(userRef, {
        tenantIds: fixedTenantIds,
        role: userRole,
        securityLevel: userSecurityLevel,
        orgType: userOrgType,
        lastUpdated: serverTimestamp()
      });
      
      console.log('✅ User permissions updated!');
      console.log('📊 New user data:', {
        role: userRole,
        securityLevel: userSecurityLevel,
        orgType: userOrgType,
        tenantIds: fixedTenantIds
      });
    }
    
    console.log('✅ User permissions fixed! Please refresh the page.');
    
  } catch (error) {
    console.error('❌ Error fixing user permissions:', error);
  }
};

// Add the function to window for easy access
window.fixUserPermissions = fixUserPermissions;

console.log('🔧 Fix permissions script loaded! Run fixUserPermissions() in the console to fix your user permissions.'); 