const { initializeApp } = require('firebase/app');
const { getFunctions, httpsCallable } = require('firebase/functions');

// Initialize Firebase (you'll need to add your config)
const firebaseConfig = {
  // Add your Firebase config here
  // apiKey: "your-api-key",
  // authDomain: "your-auth-domain",
  // projectId: "your-project-id",
  // storageBucket: "your-storage-bucket",
  // messagingSenderId: "your-messaging-sender-id",
  // appId: "your-app-id"
};

const app = initializeApp(firebaseConfig);
const functions = getFunctions(app);

async function debugCalendarSync(userId, tenantId) {
  try {
    console.log(`🔍 Debugging Calendar Sync for user: ${userId}, tenant: ${tenantId}`);
    
    // 1. Check Calendar Status
    console.log('\n1. Checking Calendar Status...');
    const getCalendarStatus = httpsCallable(functions, 'getCalendarStatus');
    const statusResult = await getCalendarStatus({ userId });
    console.log('Calendar Status:', statusResult.data);
    
    // 2. List Calendar Events (this is the failing function)
    console.log('\n2. Testing listCalendarEvents function...');
    const listCalendarEvents = httpsCallable(functions, 'listCalendarEvents');
    try {
      const eventsResult = await listCalendarEvents({
        userId,
        maxResults: 10,
        timeMin: new Date().toISOString(),
        timeMax: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      });
      console.log('✅ listCalendarEvents SUCCESS:', eventsResult.data);
    } catch (error) {
      console.error('❌ listCalendarEvents FAILED:', error);
      console.error('Error details:', {
        code: error.code,
        message: error.message,
        details: error.details
      });
    }
    
    // 3. Check User's Calendar Tokens
    console.log('\n3. Checking User Calendar Tokens...');
    const { getFirestore, doc, getDoc } = require('firebase/firestore');
    const db = getFirestore(app);
    
    const userDoc = await getDoc(doc(db, 'users', userId));
    if (userDoc.exists()) {
      const userData = userDoc.data();
      console.log('User Calendar Data:', {
        calendarConnected: userData.calendarConnected,
        hasCalendarTokens: !!userData.calendarTokens,
        calendarTokensKeys: userData.calendarTokens ? Object.keys(userData.calendarTokens) : null,
        hasAccessToken: !!userData.calendarTokens?.access_token,
        email: userData.calendarTokens?.email || userData.email
      });
    } else {
      console.log('❌ User not found');
    }
    
  } catch (error) {
    console.error('❌ Debug failed:', error);
  }
}

// Usage: debugCalendarSync('your-user-id', 'your-tenant-id');
module.exports = { debugCalendarSync };
