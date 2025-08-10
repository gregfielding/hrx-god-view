const { getFunctions, httpsCallable } = require('firebase/functions');
const { initializeApp } = require('firebase/app');

// Initialize Firebase (you'll need to add your config)
const firebaseConfig = {
  // Add your Firebase config here
};

const app = initializeApp(firebaseConfig);
const functions = getFunctions(app, 'us-central1');

async function testProactiveDealCoach() {
  try {
    console.log('Testing proactive Deal Coach...');
    
    const proactiveFn = httpsCallable(functions, 'dealCoachProactiveCallable');
    const result = await proactiveFn({ 
      tenantId: 'BCiP2bQ9CgVOCTfV6MhD', 
      dealId: '1xEcA2JdEdr20kjBSnKa', 
      trigger: 'auto_check' 
    });
    
    const data = result.data;
    console.log('Proactive response:', data);
    
    if (data.success && data.message) {
      console.log('✅ Proactive message generated:', data.message);
      console.log('Urgency level:', data.urgency);
    } else {
      console.log('ℹ️ No proactive message needed (deal is progressing well)');
    }
    
  } catch (error) {
    console.error('❌ Error testing proactive Deal Coach:', error);
  }
}

testProactiveDealCoach();
