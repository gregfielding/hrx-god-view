// Script to fix HRX user permissions and module access
// Run this in the browser console to fix HRX permissions

const fixHRXPermissions = async () => {
  console.log('🔧 Fixing HRX permissions...');
  
  try {
    // Try to get Firebase from the app's scope
    // Look for Firebase instances in various possible locations
    let auth, db;
    
    // Method 1: Check if Firebase is available in the app's scope
    if (typeof window !== 'undefined') {
      // Try to get from the app's React context or global variables
      auth = window.auth || window.firebaseAuth || window.__FIREBASE_AUTH__;
      db = window.db || window.firebaseDb || window.__FIREBASE_DB__;
      
      // Method 2: Try to get from the app's Firebase config
      if (!auth || !db) {
        // Look for Firebase instances in the app's modules
        const appModules = Object.keys(window).filter(key => 
          key.includes('firebase') || key.includes('auth') || key.includes('db')
        );
        console.log('🔍 Available Firebase-related modules:', appModules);
        
        // Try to access Firebase from the app's React components
        if (window.React && window.React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED) {
          console.log('🔍 React is available, trying to access Firebase from app context...');
        }
      }
    }
    
    // Method 3: Try to import Firebase dynamically
    if (!auth || !db) {
      try {
        console.log('🔍 Trying to import Firebase dynamically...');
        const firebaseApp = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const firebaseAuth = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const firebaseFirestore = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
        
        // Initialize Firebase if not already initialized
        if (!firebaseApp.getApps().length) {
          console.log('🔍 Initializing Firebase...');
          // You'll need to provide your Firebase config here
          // For now, let's try to get it from the app
          const config = window.FIREBASE_CONFIG || {
            // Add your Firebase config here if needed
          };
          firebaseApp.initializeApp(config);
        }
        
        auth = firebaseAuth.getAuth();
        db = firebaseFirestore.getFirestore();
        
      } catch (importError) {
        console.error('❌ Could not import Firebase:', importError);
      }
    }
    
    if (!auth || !db) {
      console.error('❌ Could not access Firebase instances');
      console.log('💡 Please try one of these alternatives:');
      console.log('1. Run this script from the app console (not browser console)');
      console.log('2. Manually update your user document in Firebase Console');
      console.log('3. Use the manual fix instructions below');
      return;
    }
    
    // Get current user
    const user = auth.currentUser;
    if (!user) {
      console.error('❌ No user logged in');
      return;
    }
    
    console.log('👤 Current user:', user.uid);
    
    // Get user document
    const userRef = db.collection('users').doc(user.uid);
    const userSnap = await userRef.get();
    
    if (!userSnap.exists) {
      console.error('❌ User document not found');
      return;
    }
    
    const userData = userSnap.data();
    console.log('📄 Current user data:', userData);
    
    // Check if user has HRX access
    const hasHRXAccess = userData.tenantIds && 
                        (userData.tenantIds['TgDJ4sIaC7x2n5cPs3rW'] || 
                         userData.tenantIds['BCiP2bQ9CgV0CTfV6MhD']);
    
    if (!hasHRXAccess) {
      console.error('❌ User does not have HRX access');
      return;
    }
    
    console.log('✅ User has HRX access, fixing permissions...');
    
    // Fix tenantIds structure for HRX
    const fixedTenantIds = {
      'TgDJ4sIaC7x2n5cPs3rW': {
        role: 'HRX',
        securityLevel: '7'
      },
      'BCiP2bQ9CgV0CTfV6MhD': {
        role: 'HRX', 
        securityLevel: '7'
      }
    };
    
    // Update user with proper HRX permissions
    await userRef.update({
      tenantIds: fixedTenantIds,
      role: 'HRX',
      securityLevel: '7',
      orgType: 'HRX',
      activeTenantId: 'TgDJ4sIaC7x2n5cPs3rW',
      lastUpdated: db.FieldValue.serverTimestamp()
    });
    
    console.log('✅ HRX permissions updated!');
    console.log('📊 New user data:', {
      role: 'HRX',
      securityLevel: '7',
      orgType: 'HRX',
      accessRole: 'hrx_7',
      tenantIds: fixedTenantIds
    });
    
    console.log('🔄 Please refresh the page to see the changes.');
    
  } catch (error) {
    console.error('❌ Error fixing HRX permissions:', error);
    console.log('💡 Manual fix instructions:');
    console.log('1. Go to Firebase Console → Firestore Database');
    console.log('2. Find your user document in the users collection');
    console.log('3. Update these fields:');
    console.log('   - role: "HRX"');
    console.log('   - securityLevel: "7"');
    console.log('   - orgType: "HRX"');
    console.log('   - tenantIds: { "TgDJ4sIaC7x2n5cPs3rW": { role: "HRX", securityLevel: "7" }, "BCiP2bQ9CgV0CTfV6MhD": { role: "HRX", securityLevel: "7" } }');
    console.log('4. Refresh the app');
  }
};

// Add the function to window for easy access
window.fixHRXPermissions = fixHRXPermissions;

console.log('🔧 Fix HRX permissions script loaded! Run fixHRXPermissions() in the console to fix your HRX permissions.'); 