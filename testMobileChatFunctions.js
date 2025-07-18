const { initializeApp } = require('firebase/app');
const { getFunctions, httpsCallable } = require('firebase/functions');

// Initialize Firebase (you'll need to add your config)
const firebaseConfig = {
  // Add your Firebase config here
};

const app = initializeApp(firebaseConfig);
const functions = getFunctions(app);

async function testMobileChatFunctions() {
  console.log('🧪 Testing Mobile Chat Functions...\n');

  try {
    // Test 1: Get Hello Message Settings
    console.log('1. Testing getHelloMessageSettings...');
    const getHelloMessageSettings = httpsCallable(functions, 'getHelloMessageSettings');
    const settingsResult = await getHelloMessageSettings();
    console.log('✅ Hello message settings retrieved:', settingsResult.data);
    console.log('   - Templates (EN):', settingsResult.data.templates.en.length);
    console.log('   - Templates (ES):', settingsResult.data.templates.es.length);
    console.log('   - Enabled:', settingsResult.data.enabled);
    console.log('');

    // Test 2: Update User Login Info
    console.log('2. Testing updateUserLoginInfo...');
    const updateUserLoginInfo = httpsCallable(functions, 'updateUserLoginInfo');
    const loginResult = await updateUserLoginInfo({
      userId: 'test-user-123',
      loginData: {
        deviceInfo: {
          platform: 'iOS',
          version: '1.0.0'
        }
      }
    });
    console.log('✅ User login info updated:', loginResult.data);
    console.log('');

    // Test 3: Translate Content
    console.log('3. Testing translateContent...');
    const translateContent = httpsCallable(functions, 'translateContent');
    const translateResult = await translateContent({
      content: 'Hello, how are you today?',
      targetLanguage: 'es',
      sourceLanguage: 'en'
    });
    console.log('✅ Content translated:', translateResult.data);
    console.log('   - Original: Hello, how are you today?');
    console.log('   - Translated:', translateResult.data.translatedContent);
    console.log('');

    // Test 4: Get Mobile Chat Data
    console.log('4. Testing getMobileChatData...');
    const getMobileChatData = httpsCallable(functions, 'getMobileChatData');
    const chatDataResult = await getMobileChatData({
      userId: 'test-user-123',
      language: 'en'
    });
    console.log('✅ Mobile chat data retrieved:', chatDataResult.data);
    console.log('   - User language:', chatDataResult.data.userLanguage);
    console.log('   - Broadcast count:', chatDataResult.data.broadcastCount);
    console.log('   - Hello settings enabled:', chatDataResult.data.helloSettings.enabled);
    console.log('');

    // Test 5: Send Hello Message
    console.log('5. Testing sendHelloMessage...');
    const sendHelloMessage = httpsCallable(functions, 'sendHelloMessage');
    const helloResult = await sendHelloMessage({
      userId: 'test-user-123',
      language: 'en'
    });
    console.log('✅ Hello message sent:', helloResult.data);
    console.log('   - Message ID:', helloResult.data.messageId);
    console.log('   - Message:', helloResult.data.message);
    console.log('');

    console.log('🎉 All tests completed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Error details:', error);
  }
}

// Run the tests
testMobileChatFunctions(); 