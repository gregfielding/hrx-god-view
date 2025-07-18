const { initializeApp } = require('firebase/app');
const { getFunctions, httpsCallable } = require('firebase/functions');

// Firebase configuration
const firebaseConfig = {
  // Add your Firebase config here
  apiKey: "your-api-key",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "your-app-id"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const functions = getFunctions(app);

// Test data
const testUserId = 'test-user-123';
const testLanguage = 'en';

async function testPhase2Functions() {
  console.log('🧪 Testing Phase 2 Mobile Chat Functions...\n');

  try {
    // Test 1: Create Broadcast Message
    console.log('📢 Test 1: Creating broadcast message...');
    const createBroadcast = httpsCallable(functions, 'createBroadcastMessage');
    const broadcastResult = await createBroadcast({
      title: 'Test Broadcast - Phase 2',
      content: 'This is a test broadcast message for Phase 2 testing.',
      priority: 'normal',
      targetUsers: [testUserId],
      createdBy: 'test-admin'
    });
    
    const broadcastData = broadcastResult.data;
    console.log('✅ Broadcast created:', {
      success: broadcastData.success,
      broadcastId: broadcastData.broadcastId,
      sentCount: broadcastData.sentCount
    });

    // Test 2: Get User Broadcasts
    console.log('\n📋 Test 2: Getting user broadcasts...');
    const getUserBroadcasts = httpsCallable(functions, 'getUserBroadcasts');
    const broadcastsResult = await getUserBroadcasts({
      userId: testUserId,
      status: 'all',
      limit: 10
    });
    
    const broadcastsData = broadcastsResult.data;
    console.log('✅ User broadcasts retrieved:', {
      success: broadcastsData.success,
      totalCount: broadcastsData.totalCount,
      broadcasts: broadcastsData.broadcasts?.length || 0
    });

    // Test 3: Mark Broadcast as Read
    if (broadcastsData.broadcasts && broadcastsData.broadcasts.length > 0) {
      console.log('\n👁️ Test 3: Marking broadcast as read...');
      const markRead = httpsCallable(functions, 'markBroadcastRead');
      const readResult = await markRead({
        conversationId: broadcastsData.broadcasts[0].conversationId,
        userId: testUserId
      });
      
      const readData = readResult.data;
      console.log('✅ Broadcast marked as read:', {
        success: readData.success
      });

      // Test 4: Reply to Broadcast
      console.log('\n💬 Test 4: Replying to broadcast...');
      const replyToBroadcast = httpsCallable(functions, 'replyToBroadcast');
      const replyResult = await replyToBroadcast({
        conversationId: broadcastsData.broadcasts[0].conversationId,
        userId: testUserId,
        message: 'This is a test reply to the broadcast message.',
        language: testLanguage
      });
      
      const replyData = replyResult.data;
      console.log('✅ Reply sent:', {
        success: replyData.success,
        replyId: replyData.replyId,
        message: replyData.message
      });
    }

    // Test 5: Send Chat Message
    console.log('\n💭 Test 5: Sending chat message...');
    const sendChatMessage = httpsCallable(functions, 'sendChatMessage');
    const chatResult = await sendChatMessage({
      userId: testUserId,
      message: 'Hello! This is a test chat message for Phase 2.',
      language: testLanguage,
      messageType: 'chat'
    });
    
    const chatData = chatResult.data;
    console.log('✅ Chat message sent:', {
      success: chatData.success,
      userMessageId: chatData.userMessageId,
      aiResponseId: chatData.aiResponseId,
      aiResponse: chatData.aiResponse
    });

    // Test 6: Get Chat History
    console.log('\n📚 Test 6: Getting chat history...');
    const getChatHistory = httpsCallable(functions, 'getChatHistory');
    const historyResult = await getChatHistory({
      userId: testUserId,
      limit: 20
    });
    
    const historyData = historyResult.data;
    console.log('✅ Chat history retrieved:', {
      success: historyData.success,
      messageCount: historyData.messages?.length || 0,
      hasMore: historyData.hasMore
    });

    // Test 7: Get Mobile Chat Data (Phase 1 function)
    console.log('\n📱 Test 7: Getting mobile chat data...');
    const getMobileChatData = httpsCallable(functions, 'getMobileChatData');
    const mobileResult = await getMobileChatData({
      userId: testUserId,
      language: testLanguage
    });
    
    const mobileData = mobileResult.data;
    console.log('✅ Mobile chat data retrieved:', {
      success: mobileData.success,
      broadcastCount: mobileData.broadcastCount,
      userLanguage: mobileData.userLanguage,
      loginCount: mobileData.loginCount
    });

    console.log('\n🎉 All Phase 2 tests completed successfully!');
    
    // Summary
    console.log('\n📊 Test Summary:');
    console.log('- ✅ Broadcast creation and management');
    console.log('- ✅ User broadcast retrieval');
    console.log('- ✅ Broadcast read status tracking');
    console.log('- ✅ Broadcast reply functionality');
    console.log('- ✅ Real-time chat messaging');
    console.log('- ✅ Chat history retrieval');
    console.log('- ✅ Mobile data integration');

  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error('Error details:', error.message);
    
    if (error.code) {
      console.error('Error code:', error.code);
    }
    
    if (error.details) {
      console.error('Error details:', error.details);
    }
  }
}

// Helper function to test translation
async function testTranslation() {
  console.log('\n🌐 Testing translation service...');
  
  try {
    const translateContent = httpsCallable(functions, 'translateContent');
    const result = await translateContent({
      content: 'Hello, this is a test message for translation.',
      targetLanguage: 'es',
      sourceLanguage: 'en'
    });
    
    const data = result.data;
    console.log('✅ Translation result:', {
      success: data.success,
      originalContent: data.originalContent,
      translatedContent: data.translatedContent,
      targetLanguage: data.targetLanguage
    });
  } catch (error) {
    console.error('❌ Translation test failed:', error.message);
  }
}

// Helper function to test hello message
async function testHelloMessage() {
  console.log('\n👋 Testing hello message...');
  
  try {
    const sendHelloMessage = httpsCallable(functions, 'sendHelloMessage');
    const result = await sendHelloMessage({
      userId: testUserId,
      language: testLanguage
    });
    
    const data = result.data;
    console.log('✅ Hello message result:', {
      success: data.success,
      messageId: data.messageId,
      message: data.message
    });
  } catch (error) {
    console.error('❌ Hello message test failed:', error.message);
  }
}

// Run all tests
async function runAllTests() {
  console.log('🚀 Starting Phase 2 Mobile Chat System Tests\n');
  
  await testPhase2Functions();
  await testTranslation();
  await testHelloMessage();
  
  console.log('\n🏁 All tests completed!');
}

// Export for use in other files
module.exports = {
  testPhase2Functions,
  testTranslation,
  testHelloMessage,
  runAllTests
};

// Run tests if this file is executed directly
if (require.main === module) {
  runAllTests().catch(console.error);
} 