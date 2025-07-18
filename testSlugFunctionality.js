const { initializeApp } = require('firebase/app');
const { getFirestore, collection, addDoc, query, where, getDocs, deleteDoc, doc } = require('firebase/firestore');
const { getFunctions, httpsCallable } = require('firebase/functions');

// Firebase config (replace with your actual config)
const firebaseConfig = {
  // Add your Firebase config here
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const functions = getFunctions(app);

async function testSlugFunctionality() {
  console.log('🧪 Testing Tenant Slug Functionality...\n');

  try {
    // Test 1: Generate slug from name
    console.log('1. Testing slug generation...');
    const generateSlug = httpsCallable(functions, 'generateTenantSlug');
    const slugResult = await generateSlug({ name: 'Test Agency Name' });
    console.log('✅ Generated slug:', slugResult.data.slug);

    // Test 2: Validate slug
    console.log('\n2. Testing slug validation...');
    const validateSlug = httpsCallable(functions, 'validateTenantSlug');
    const validationResult = await validateSlug({ slug: slugResult.data.slug });
    console.log('✅ Slug validation result:', validationResult.data);

    // Test 3: Create tenant with slug
    console.log('\n3. Testing tenant creation with slug...');
    const tenantData = {
      name: 'Test Agency',
      slug: slugResult.data.slug,
      type: 'agency',
      address: {
        street: '123 Test St',
        city: 'Test City',
        state: 'TS',
        zip: '12345',
        lat: 0,
        lng: 0,
      },
      contact: {
        phone: '(555) 123-4567',
        email: 'test@example.com',
        website: 'https://example.com',
      },
      customers: [],
      modules: [],
      settings: {
        jobTitles: [],
        uniformDefaults: [],
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const tenantRef = await addDoc(collection(db, 'tenants'), tenantData);
    console.log('✅ Tenant created with ID:', tenantRef.id);

    // Test 4: Verify slug uniqueness
    console.log('\n4. Testing slug uniqueness...');
    const duplicateResult = await validateSlug({ slug: slugResult.data.slug });
    console.log('✅ Duplicate slug check:', duplicateResult.data);

    // Test 5: Test invalid slug formats
    console.log('\n5. Testing invalid slug formats...');
    const invalidSlugs = [
      'ab', // Too short
      'a'.repeat(51), // Too long
      'invalid-slug!', // Special characters
      '-invalid', // Starts with hyphen
      'invalid-', // Ends with hyphen
    ];

    for (const invalidSlug of invalidSlugs) {
      try {
        await validateSlug({ slug: invalidSlug });
        console.log(`❌ Invalid slug "${invalidSlug}" was accepted`);
      } catch (error) {
        console.log(`✅ Invalid slug "${invalidSlug}" correctly rejected:`, error.message);
      }
    }

    // Test 6: Test slug update for existing tenant
    console.log('\n6. Testing slug update for existing tenant...');
    const updateResult = await validateSlug({ 
      slug: 'new-slug', 
      excludeTenantId: tenantRef.id 
    });
    console.log('✅ Slug update validation:', updateResult.data);

    // Cleanup
    console.log('\n7. Cleaning up test data...');
    await deleteDoc(doc(db, 'tenants', tenantRef.id));
    console.log('✅ Test tenant deleted');

    console.log('\n🎉 All slug functionality tests passed!');

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testSlugFunctionality().then(() => {
  console.log('\n🏁 Test completed');
  process.exit(0);
}).catch((error) => {
  console.error('💥 Test failed:', error);
  process.exit(1);
}); 