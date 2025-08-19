const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc } = require('firebase/firestore');

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
const db = getFirestore(app);

async function checkGoogleConnectionStatus(userId) {
  try {
    console.log(`Checking Google connection status for user: ${userId}`);
    
    const userDoc = await getDoc(doc(db, 'users', userId));
    
    if (!userDoc.exists()) {
      console.log('❌ User not found');
      return;
    }
    
    const userData = userDoc.data();
    
    console.log('\n=== Google Connection Status ===');
    console.log(`Calendar Connected: ${userData.calendarConnected || false}`);
    console.log(`Calendar Connected At: ${userData.calendarConnectedAt || 'Not set'}`);
    console.log(`Has Calendar Tokens: ${!!userData.calendarTokens?.access_token}`);
    console.log(`Calendar Email: ${userData.calendarTokens?.email || 'Not set'}`);
    console.log(`Gmail Connected: ${userData.gmailConnected || false}`);
    console.log(`Has Gmail Tokens: ${!!userData.gmailTokens?.access_token}`);
    console.log(`Gmail Email: ${userData.gmailTokens?.email || 'Not set'}`);
    
    // Check if tokens exist
    if (userData.calendarTokens) {
      console.log('\n=== Calendar Tokens ===');
      console.log(`Access Token: ${userData.calendarTokens.access_token ? '✅ Present' : '❌ Missing'}`);
      console.log(`Refresh Token: ${userData.calendarTokens.refresh_token ? '✅ Present' : '❌ Missing'}`);
      console.log(`Scope: ${userData.calendarTokens.scope || 'Not set'}`);
      console.log(`Expiry Date: ${userData.calendarTokens.expiry_date || 'Not set'}`);
    }
    
    if (userData.gmailTokens) {
      console.log('\n=== Gmail Tokens ===');
      console.log(`Access Token: ${userData.gmailTokens.access_token ? '✅ Present' : '❌ Missing'}`);
      console.log(`Refresh Token: ${userData.gmailTokens.refresh_token ? '✅ Present' : '❌ Missing'}`);
      console.log(`Scope: ${userData.gmailTokens.scope || 'Not set'}`);
      console.log(`Expiry Date: ${userData.gmailTokens.expiry_date || 'Not set'}`);
    }
    
    // Summary
    const isCalendarConnected = !!(userData.calendarConnected && userData.calendarTokens?.access_token);
    const isGmailConnected = !!(userData.gmailConnected && userData.gmailTokens?.access_token);
    
    console.log('\n=== Summary ===');
    console.log(`Calendar: ${isCalendarConnected ? '✅ Connected' : '❌ Not Connected'}`);
    console.log(`Gmail: ${isGmailConnected ? '✅ Connected' : '❌ Not Connected'}`);
    console.log(`Overall: ${(isCalendarConnected || isGmailConnected) ? '✅ Connected' : '❌ Not Connected'}`);
    
  } catch (error) {
    console.error('Error checking Google connection status:', error);
  }
}

// Usage: Replace 'your-user-id' with your actual user ID
// checkGoogleConnectionStatus('your-user-id');

module.exports = { checkGoogleConnectionStatus };
