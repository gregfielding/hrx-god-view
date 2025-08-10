const { execSync } = require('child_process');

console.log('🔧 Gmail OAuth Setup Instructions');
console.log('==================================\n');

console.log('1. Go to Google Cloud Console:');
console.log('   https://console.cloud.google.com/apis/credentials\n');

console.log('2. Create OAuth 2.0 credentials:');
console.log('   - Click "Create Credentials" > "OAuth 2.0 Client IDs"');
console.log('   - Application type: "Web application"');
console.log('   - Name: "HRX Gmail Integration"');
console.log('   - Authorized redirect URIs:');
console.log('     * https://us-central1-hrx1-d3beb.cloudfunctions.net/gmailOAuthCallback');
console.log('     * https://app.hrxone.com/gmail-callback (if you have a custom domain)');
console.log('   - Click "Create"\n');

console.log('3. Copy the Client ID and Client Secret\n');

console.log('4. Set Firebase Functions config:');
console.log('   firebase functions:config:set gmail.client_id="YOUR_CLIENT_ID"');
console.log('   firebase functions:config:set gmail.client_secret="YOUR_CLIENT_SECRET"');
console.log('   firebase functions:config:set gmail.redirect_uri="https://us-central1-hrx1-d3beb.cloudfunctions.net/gmailOAuthCallback"\n');

console.log('5. Deploy the functions:');
console.log('   firebase deploy --only functions:authenticateGmail,functions:gmailOAuthCallback\n');

console.log('6. Test the integration in the app\n');

console.log('⚠️  Note: You need to replace "YOUR_CLIENT_ID" and "YOUR_CLIENT_SECRET" with the actual values from Google Cloud Console.\n');

console.log('🔗 Helpful Links:');
console.log('- Google Cloud Console: https://console.cloud.google.com/apis/credentials');
console.log('- Gmail API Documentation: https://developers.google.com/gmail/api/guides');
console.log('- Firebase Functions Config: https://firebase.google.com/docs/functions/config-env'); 