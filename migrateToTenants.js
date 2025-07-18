const admin = require('firebase-admin');

// Initialize Firebase Admin
const serviceAccount = require('./firebase copy.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function migrateToTenants() {
  console.log('Starting migration to unified tenant structure...');
  
  try {
    // Step 1: Migrate agencies to tenants
    console.log('Step 1: Migrating agencies to tenants...');
    const agenciesSnapshot = await db.collection('agencies').get();
    
    for (const agencyDoc of agenciesSnapshot.docs) {
      const agencyData = agencyDoc.data();
      const agencyId = agencyDoc.id;
      
      // Create tenant document
      const tenantData = {
        ...agencyData,
        type: 'Agency',
        originalId: agencyId,
        migratedAt: admin.firestore.FieldValue.serverTimestamp(),
        // Convert customerIds to customers array if it exists
        customers: agencyData.customerIds || []
      };
      
      // Remove the old customerIds field
      delete tenantData.customerIds;
      
      await db.collection('tenants').doc(agencyId).set(tenantData);
      console.log(`Migrated agency ${agencyId} to tenant`);
    }
    
    // Step 2: Migrate customers to tenant subcollections
    console.log('Step 2: Migrating customers to tenant subcollections...');
    const customersSnapshot = await db.collection('customers').get();
    
    for (const customerDoc of customersSnapshot.docs) {
      const customerData = customerDoc.data();
      const customerId = customerDoc.id;
      const agencyId = customerData.agencyId;
      
      if (agencyId) {
        // Add customer to tenant's customers subcollection
        await db.collection('tenants').doc(agencyId).collection('customers').doc(customerId).set({
          ...customerData,
          type: 'Customer',
          originalId: customerId,
          migratedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log(`Migrated customer ${customerId} to tenant ${agencyId} subcollection`);
      } else {
        // Standalone customer becomes its own tenant
        const tenantData = {
          ...customerData,
          type: 'Customer',
          originalId: customerId,
          migratedAt: admin.firestore.FieldValue.serverTimestamp(),
          customers: []
        };
        
        await db.collection('tenants').doc(customerId).set(tenantData);
        console.log(`Migrated standalone customer ${customerId} to tenant`);
      }
    }
    
    // Step 3: Update user documents
    console.log('Step 3: Updating user documents...');
    const usersSnapshot = await db.collection('users').get();
    
    for (const userDoc of usersSnapshot.docs) {
      const userData = userDoc.data();
      const userId = userDoc.id;
      
      const updateData = {};
      
      // Handle agencyId migration
      if (userData.agencyId) {
        updateData.tenantIds = [userData.agencyId];
        updateData.tenantId = userData.agencyId;
        updateData.orgType = 'Tenant';
        delete updateData.agencyId;
      }
      
      // Handle customerId migration
      if (userData.customerId) {
        // Check if customer belongs to an agency
        const customerDoc = await db.collection('customers').doc(userData.customerId).get();
        if (customerDoc.exists) {
          const customerData = customerDoc.data();
          if (customerData.agencyId) {
            // Customer belongs to agency, user gets agency tenant access
            updateData.tenantIds = [customerData.agencyId];
            updateData.tenantId = customerData.agencyId;
          } else {
            // Standalone customer, user gets customer tenant access
            updateData.tenantIds = [userData.customerId];
            updateData.tenantId = userData.customerId;
          }
        } else {
          // Fallback to customer ID as tenant
          updateData.tenantIds = [userData.customerId];
          updateData.tenantId = userData.customerId;
        }
        updateData.orgType = 'Tenant';
        delete updateData.customerId;
      }
      
      if (Object.keys(updateData).length > 0) {
        await db.collection('users').doc(userId).update(updateData);
        console.log(`Updated user ${userId} with tenant structure`);
      }
    }
    
    // Step 4: Update other collections that reference agencyId/customerId
    console.log('Step 4: Updating other collections...');
    
    // Update assignments
    const assignmentsSnapshot = await db.collection('assignments').get();
    for (const assignmentDoc of assignmentsSnapshot.docs) {
      const assignmentData = assignmentDoc.data();
      const updateData = {};
      
      if (assignmentData.agencyId) {
        updateData.tenantId = assignmentData.agencyId;
        delete updateData.agencyId;
      }
      
      if (Object.keys(updateData).length > 0) {
        await assignmentDoc.ref.update(updateData);
        console.log(`Updated assignment ${assignmentDoc.id}`);
      }
    }
    
    // Update job orders
    const jobOrdersSnapshot = await db.collection('jobOrders').get();
    for (const jobOrderDoc of jobOrdersSnapshot.docs) {
      const jobOrderData = jobOrderDoc.data();
      const updateData = {};
      
      if (jobOrderData.agencyId) {
        updateData.tenantId = jobOrderData.agencyId;
        delete updateData.agencyId;
      }
      
      if (Object.keys(updateData).length > 0) {
        await jobOrderDoc.ref.update(updateData);
        console.log(`Updated job order ${jobOrderDoc.id}`);
      }
    }
    
    // Update shifts
    const shiftsSnapshot = await db.collection('shifts').get();
    for (const shiftDoc of shiftsSnapshot.docs) {
      const shiftData = shiftDoc.data();
      const updateData = {};
      
      if (shiftData.agencyId) {
        updateData.tenantId = shiftData.agencyId;
        delete updateData.agencyId;
      }
      
      if (Object.keys(updateData).length > 0) {
        await shiftDoc.ref.update(updateData);
        console.log(`Updated shift ${shiftDoc.id}`);
      }
    }
    
    console.log('Migration completed successfully!');
    console.log('Note: Original agencies and customers collections still exist for backup.');
    console.log('You can delete them after verifying the migration was successful.');
    
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  }
}

// Run migration
migrateToTenants()
  .then(() => {
    console.log('Migration script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration script failed:', error);
    process.exit(1);
  }); 