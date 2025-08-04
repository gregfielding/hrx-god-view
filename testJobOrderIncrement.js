const { initializeApp } = require('firebase/app');
const { getFirestore, collection, query, where, orderBy, limit, getDocs, addDoc, serverTimestamp } = require('firebase/firestore');

// Your Firebase config
const firebaseConfig = {
  // Add your Firebase config here
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const testTenantId = 'BCiP2bQ9CgVOCTfV6MhD'; // C1 Staffing

async function getNextJobOrderId(tenantId) {
  try {
    console.log('🔍 Getting next job order ID for tenant:', tenantId);
    const q = query(
      collection(db, 'jobOrders'),
      where('tenantId', '==', tenantId),
      orderBy('jobOrderId', 'desc'),
      limit(1),
    );
    const snapshot = await getDocs(q);
    if (!snapshot.empty) {
      const lastId = snapshot.docs[0].data().jobOrderId;
      console.log('✅ Found last job order ID:', lastId, 'Next will be:', lastId + 1);
      return lastId + 1;
    }
    console.log('✅ No existing job orders found, starting with 1000');
    return 1000;
  } catch (error) {
    console.error('❌ Error in getNextJobOrderId:', error);
    throw error;
  }
}

async function createTestJobOrder(tenantId, jobOrderId) {
  try {
    const jobOrderData = {
      title: `Test Job Order ${jobOrderId}`,
      description: `Test Description for Job Order ${jobOrderId}`,
      tenantId: tenantId,
      customerId: 'PkiPt91zVCIfwwmsvQ86',
      worksiteId: 'LRPGIHFuQC8A8eNT3HGW',
      jobOrderId: jobOrderId,
      createdAt: serverTimestamp(),
      status: 'Active',
      startDate: '2025-07-20',
      endDate: '2025-07-26',
      jobTitleIds: ['Ushers, Lobby Attendants, and Ticket Takers'],
      poNum: `TEST PO ${jobOrderId}`,
      type: 'Gig',
      visibility: 'Hidden',
      aiInstructions: 'Special AI Instructions'
    };

    const docRef = await addDoc(collection(db, 'jobOrders'), jobOrderData);
    console.log('✅ Created job order with ID:', docRef.id, 'Job Order Number:', jobOrderId);
    return docRef.id;
  } catch (error) {
    console.error('❌ Error creating job order:', error);
    throw error;
  }
}

async function testJobOrderIncrement() {
  try {
    console.log('🧪 Testing Job Order Auto-Increment System');
    console.log('==========================================');
    
    // Test 1: Get next job order ID
    console.log('\n📋 Test 1: Getting next job order ID');
    const nextId = await getNextJobOrderId(testTenantId);
    console.log('Next job order ID:', nextId);
    
    // Test 2: Create a test job order
    console.log('\n📋 Test 2: Creating test job order');
    const docId = await createTestJobOrder(testTenantId, nextId);
    
    // Test 3: Verify the next ID is incremented
    console.log('\n📋 Test 3: Verifying next ID is incremented');
    const nextIdAfter = await getNextJobOrderId(testTenantId);
    console.log('Next job order ID after creation:', nextIdAfter);
    
    if (nextIdAfter === nextId + 1) {
      console.log('✅ SUCCESS: Job order ID auto-increment is working correctly!');
    } else {
      console.log('❌ FAILURE: Job order ID auto-increment is not working correctly!');
      console.log('Expected:', nextId + 1, 'Got:', nextIdAfter);
    }
    
    console.log('\n🎉 Test completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testJobOrderIncrement(); 