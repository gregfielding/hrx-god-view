const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, getDoc, writeBatch, updateDoc } = require('firebase/firestore');

// Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyBxQJqXqXqXqXqXqXqXqXqXqXqXqXqXqXqXq",
  authDomain: "hrx-god-view.firebaseapp.com",
  projectId: "hrx-god-view",
  storageBucket: "hrx-god-view.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdefghijklmnop"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const optimizeTasksWithNames = async () => {
  try {
    console.log('🚀 Starting task optimization with user names...');
    
    // Get all tenants
    const tenantsSnapshot = await getDocs(collection(db, 'tenants'));
    console.log(`Found ${tenantsSnapshot.docs.length} tenants`);
    
    let totalTasksUpdated = 0;
    let totalErrors = 0;
    
    for (const tenantDoc of tenantsSnapshot.docs) {
      const tenantId = tenantDoc.id;
      console.log(`\n🔍 Processing tenant: ${tenantId}`);
      
      try {
        // Get all tasks in this tenant
        const tasksSnapshot = await getDocs(collection(db, 'tenants', tenantId, 'tasks'));
        console.log(`Found ${tasksSnapshot.docs.length} tasks in tenant ${tenantId}`);
        
        for (const taskDoc of tasksSnapshot.docs) {
          const taskId = taskDoc.id;
          const taskData = taskDoc.data();
          
          console.log(`\n📋 Processing task: ${taskId} - ${taskData.title || 'Untitled'}`);
          
          let updated = false;
          const updates = {};
          
          // Check if task has assignedTo field with just an ID
          if (taskData.assignedTo && typeof taskData.assignedTo === 'string' && !taskData.assignedToName) {
            try {
              // Get user data
              const userDoc = await getDoc(doc(db, 'tenants', tenantId, 'users', taskData.assignedTo));
              if (userDoc.exists()) {
                const userData = userDoc.data();
                const userName = userData.displayName || userData.fullName || userData.firstName + ' ' + userData.lastName || userData.email || 'Unknown User';
                
                updates.assignedToName = userName;
                console.log(`✅ Added user name: ${userName} for task ${taskId}`);
                updated = true;
              } else {
                console.log(`⚠️ User ${taskData.assignedTo} not found for task ${taskId}`);
                updates.assignedToName = 'Unknown User';
                updated = true;
              }
            } catch (userError) {
              console.error(`❌ Error fetching user ${taskData.assignedTo}:`, userError.message);
              updates.assignedToName = 'Unknown User';
              updated = true;
            }
          }
          
          // Check if task has createdBy field with just an ID
          if (taskData.createdBy && typeof taskData.createdBy === 'string' && !taskData.createdByName) {
            try {
              // Get user data
              const userDoc = await getDoc(doc(db, 'tenants', tenantId, 'users', taskData.createdBy));
              if (userDoc.exists()) {
                const userData = userDoc.data();
                const userName = userData.displayName || userData.fullName || userData.firstName + ' ' + userData.lastName || userData.email || 'Unknown User';
                
                updates.createdByName = userName;
                console.log(`✅ Added creator name: ${userName} for task ${taskId}`);
                updated = true;
              } else {
                console.log(`⚠️ Creator ${taskData.createdBy} not found for task ${taskId}`);
                updates.createdByName = 'Unknown User';
                updated = true;
              }
            } catch (userError) {
              console.error(`❌ Error fetching creator ${taskData.createdBy}:`, userError.message);
              updates.createdByName = 'Unknown User';
              updated = true;
            }
          }
          
          // Check if task has relatedTo field with entity references
          if (taskData.relatedTo && taskData.relatedTo.type && taskData.relatedTo.id && !taskData.relatedToName) {
            try {
              let entityName = 'Unknown';
              
              if (taskData.relatedTo.type === 'deal') {
                const dealDoc = await getDoc(doc(db, 'tenants', tenantId, 'crm_deals', taskData.relatedTo.id));
                if (dealDoc.exists()) {
                  const dealData = dealDoc.data();
                  entityName = dealData.name || dealData.title || 'Untitled Deal';
                }
              } else if (taskData.relatedTo.type === 'company') {
                const companyDoc = await getDoc(doc(db, 'tenants', tenantId, 'crm_companies', taskData.relatedTo.id));
                if (companyDoc.exists()) {
                  const companyData = companyDoc.data();
                  entityName = companyData.name || 'Untitled Company';
                }
              } else if (taskData.relatedTo.type === 'contact') {
                const contactDoc = await getDoc(doc(db, 'tenants', tenantId, 'crm_contacts', taskData.relatedTo.id));
                if (contactDoc.exists()) {
                  const contactData = contactDoc.data();
                  entityName = contactData.fullName || contactData.name || contactData.firstName + ' ' + contactData.lastName || 'Untitled Contact';
                }
              }
              
              updates.relatedToName = entityName;
              console.log(`✅ Added related entity name: ${entityName} for task ${taskId}`);
              updated = true;
            } catch (entityError) {
              console.error(`❌ Error fetching related entity:`, entityError.message);
              updates.relatedToName = 'Unknown';
              updated = true;
            }
          }
          
          // Update the task if any changes were made
          if (updated) {
            try {
              await updateDoc(doc(db, 'tenants', tenantId, 'tasks', taskId), updates);
              console.log(`✅ Updated task ${taskId} with names`);
              totalTasksUpdated++;
            } catch (updateError) {
              console.error(`❌ Error updating task ${taskId}:`, updateError.message);
              totalErrors++;
            }
          } else {
            console.log(`ℹ️ Task ${taskId} already has names or no updates needed`);
          }
        }
        
        // Also process CRM tasks
        const crmTasksSnapshot = await getDocs(collection(db, 'tenants', tenantId, 'crm_tasks'));
        console.log(`Found ${crmTasksSnapshot.docs.length} CRM tasks in tenant ${tenantId}`);
        
        for (const taskDoc of crmTasksSnapshot.docs) {
          const taskId = taskDoc.id;
          const taskData = taskDoc.data();
          
          console.log(`\n📋 Processing CRM task: ${taskId} - ${taskData.title || 'Untitled'}`);
          
          let updated = false;
          const updates = {};
          
          // Check if task has assignedTo field with just an ID
          if (taskData.assignedTo && typeof taskData.assignedTo === 'string' && !taskData.assignedToName) {
            try {
              // Get user data
              const userDoc = await getDoc(doc(db, 'tenants', tenantId, 'users', taskData.assignedTo));
              if (userDoc.exists()) {
                const userData = userDoc.data();
                const userName = userData.displayName || userData.fullName || userData.firstName + ' ' + userData.lastName || userData.email || 'Unknown User';
                
                updates.assignedToName = userName;
                console.log(`✅ Added user name: ${userName} for CRM task ${taskId}`);
                updated = true;
              } else {
                console.log(`⚠️ User ${taskData.assignedTo} not found for CRM task ${taskId}`);
                updates.assignedToName = 'Unknown User';
                updated = true;
              }
            } catch (userError) {
              console.error(`❌ Error fetching user ${taskData.assignedTo}:`, userError.message);
              updates.assignedToName = 'Unknown User';
              updated = true;
            }
          }
          
          // Check if task has createdBy field with just an ID
          if (taskData.createdBy && typeof taskData.createdBy === 'string' && !taskData.createdByName) {
            try {
              // Get user data
              const userDoc = await getDoc(doc(db, 'tenants', tenantId, 'users', taskData.createdBy));
              if (userDoc.exists()) {
                const userData = userDoc.data();
                const userName = userData.displayName || userData.fullName || userData.firstName + ' ' + userData.lastName || userData.email || 'Unknown User';
                
                updates.createdByName = userName;
                console.log(`✅ Added creator name: ${userName} for CRM task ${taskId}`);
                updated = true;
              } else {
                console.log(`⚠️ Creator ${taskData.createdBy} not found for CRM task ${taskId}`);
                updates.createdByName = 'Unknown User';
                updated = true;
              }
            } catch (userError) {
              console.error(`❌ Error fetching creator ${taskData.createdBy}:`, userError.message);
              updates.createdByName = 'Unknown User';
              updated = true;
            }
          }
          
          // Check if task has relatedTo field with entity references
          if (taskData.relatedTo && taskData.relatedTo.type && taskData.relatedTo.id && !taskData.relatedToName) {
            try {
              let entityName = 'Unknown';
              
              if (taskData.relatedTo.type === 'deal') {
                const dealDoc = await getDoc(doc(db, 'tenants', tenantId, 'crm_deals', taskData.relatedTo.id));
                if (dealDoc.exists()) {
                  const dealData = dealDoc.data();
                  entityName = dealData.name || dealData.title || 'Untitled Deal';
                }
              } else if (taskData.relatedTo.type === 'company') {
                const companyDoc = await getDoc(doc(db, 'tenants', tenantId, 'crm_companies', taskData.relatedTo.id));
                if (companyDoc.exists()) {
                  const companyData = companyDoc.data();
                  entityName = companyData.name || 'Untitled Company';
                }
              } else if (taskData.relatedTo.type === 'contact') {
                const contactDoc = await getDoc(doc(db, 'tenants', tenantId, 'crm_contacts', taskData.relatedTo.id));
                if (contactDoc.exists()) {
                  const contactData = contactDoc.data();
                  entityName = contactData.fullName || contactData.name || contactData.firstName + ' ' + contactData.lastName || 'Untitled Contact';
                }
              }
              
              updates.relatedToName = entityName;
              console.log(`✅ Added related entity name: ${entityName} for CRM task ${taskId}`);
              updated = true;
            } catch (entityError) {
              console.error(`❌ Error fetching related entity:`, entityError.message);
              updates.relatedToName = 'Unknown';
              updated = true;
            }
          }
          
          // Update the task if any changes were made
          if (updated) {
            try {
              await updateDoc(doc(db, 'tenants', tenantId, 'crm_tasks', taskId), updates);
              console.log(`✅ Updated CRM task ${taskId} with names`);
              totalTasksUpdated++;
            } catch (updateError) {
              console.error(`❌ Error updating CRM task ${taskId}:`, updateError.message);
              totalErrors++;
            }
          } else {
            console.log(`ℹ️ CRM task ${taskId} already has names or no updates needed`);
          }
        }
        
      } catch (tenantError) {
        console.error(`❌ Error processing tenant ${tenantId}:`, tenantError.message);
        totalErrors++;
      }
    }
    
    console.log(`\n✅ Task optimization complete!`);
    console.log(`📊 Summary:`);
    console.log(`   - Total tasks updated: ${totalTasksUpdated}`);
    console.log(`   - Total errors: ${totalErrors}`);
    
  } catch (error) {
    console.error('❌ Error in optimizeTasksWithNames:', error);
  }
};

// Run the script
console.log('🚀 Starting task optimization script...');
optimizeTasksWithNames().then(() => {
  console.log('✅ Script completed');
  process.exit(0);
}).catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});
