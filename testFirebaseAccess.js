// Test to check what Firebase objects are available in the browser
// Run this in the browser console on the Deal Details page

console.log('🔍 Testing Firebase Access...');

// Check what's available globally
console.log('📊 Global Firebase objects:');
console.log('window.firebase:', window.firebase);
console.log('window.firebase?.firestore:', window.firebase?.firestore);
console.log('window.firebase?.app:', window.firebase?.app);

// Check if we can access the React app's Firebase instance
console.log('📊 React app Firebase access:');
try {
  // Try to access the Firebase instance from the React app
  const reactApp = document.querySelector('#root')?._reactInternalFiber;
  console.log('React app found:', !!reactApp);
  
  // Try to find Firebase in the global scope
  const firebaseKeys = Object.keys(window).filter(key => key.toLowerCase().includes('firebase'));
  console.log('Firebase-related globals:', firebaseKeys);
  
  // Check if there's a Firebase instance in the React context
  const firebaseContext = window.__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers?.get(1)?.getCurrentFiber();
  console.log('Firebase context found:', !!firebaseContext);
  
} catch (error) {
  console.error('❌ Error checking React Firebase access:', error);
}

// Try to access Firebase through the app's global variables
console.log('📊 App Firebase access:');
try {
  // Check if the app has exposed Firebase globally
  if (window.__FIREBASE_APP__) {
    console.log('✅ Firebase app found in __FIREBASE_APP__');
    console.log('Firebase app:', window.__FIREBASE_APP__);
  }
  
  if (window.__FIREBASE_DB__) {
    console.log('✅ Firebase DB found in __FIREBASE_DB__');
    console.log('Firebase DB:', window.__FIREBASE_DB__);
  }
  
} catch (error) {
  console.error('❌ Error checking app Firebase access:', error);
}

// Try to access Firebase through the React component tree
console.log('📊 React component Firebase access:');
try {
  // This is a bit hacky, but let's try to find Firebase in the component tree
  const rootElement = document.querySelector('#root');
  if (rootElement && rootElement._reactInternalFiber) {
    console.log('✅ React root found');
    
    // Try to traverse the component tree to find Firebase
    let current = rootElement._reactInternalFiber;
    let depth = 0;
    const maxDepth = 10;
    
    while (current && depth < maxDepth) {
      if (current.memoizedState && current.memoizedState.firebase) {
        console.log('✅ Firebase found in component state at depth:', depth);
        console.log('Firebase state:', current.memoizedState.firebase);
        break;
      }
      
      if (current.stateNode && current.stateNode.firebase) {
        console.log('✅ Firebase found in component instance at depth:', depth);
        console.log('Firebase instance:', current.stateNode.firebase);
        break;
      }
      
      current = current.child;
      depth++;
    }
  }
} catch (error) {
  console.error('❌ Error checking React component Firebase access:', error);
}

console.log('✅ Firebase access test completed!'); 