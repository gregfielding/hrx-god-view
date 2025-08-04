// Script to set up salespeople for CRM
// This script adds the crm_sales: true flag to selected users

const { initializeApp } = require('firebase/app');
const { getFirestore, doc, updateDoc, collection, getDocs, query, where } = require('firebase/firestore');

// Your Firebase config
const firebaseConfig = {
  // Add your Firebase config here
  apiKey: "AIzaSyBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "your-app-id"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function setupSalespeople() {
  try {
    const tenantId = "p1FxjKpOq2kDjwqmYoSS"; // Replace with your tenant ID
    
    console.log("🔍 Loading users for tenant:", tenantId);
    
    // Get all users for the tenant
    const usersQuery = query(collection(db, 'tenants', tenantId, 'users'));
    const usersSnapshot = await getDocs(usersQuery);
    const users = usersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    console.log(`📋 Found ${users.length} users in tenant`);
    
    // Display users for selection
    console.log("\n👥 Available users:");
    users.forEach((user, index) => {
      console.log(`${index + 1}. ${user.firstName} ${user.lastName} (${user.email}) - ${user.jobTitle || 'No title'}`);
    });
    
    // For demo purposes, let's mark the first 2 users as salespeople
    // In a real scenario, you'd want to select specific users
    const usersToMarkAsSalespeople = users.slice(0, 2);
    
    console.log(`\n🎯 Marking ${usersToMarkAsSalespeople.length} users as salespeople...`);
    
    for (const user of usersToMarkAsSalespeople) {
      try {
        await updateDoc(doc(db, 'tenants', tenantId, 'users', user.id), {
          crm_sales: true
        });
        console.log(`✅ Marked ${user.firstName} ${user.lastName} as salesperson`);
      } catch (error) {
        console.error(`❌ Failed to mark ${user.firstName} ${user.lastName}:`, error.message);
      }
    }
    
    console.log("\n🎉 Salespeople setup complete!");
    console.log("You can now test the salespeople dropdown in Deal Details.");
    
  } catch (error) {
    console.error("❌ Setup failed:", error.message);
  }
}

// Alternative function to mark specific users by email
async function markUserAsSalesperson(tenantId, userEmail) {
  try {
    console.log(`🔍 Looking for user with email: ${userEmail}`);
    
    const usersQuery = query(
      collection(db, 'tenants', tenantId, 'users'),
      where('email', '==', userEmail)
    );
    const usersSnapshot = await getDocs(usersQuery);
    
    if (usersSnapshot.empty) {
      console.log(`❌ No user found with email: ${userEmail}`);
      return;
    }
    
    const userDoc = usersSnapshot.docs[0];
    const userData = userDoc.data();
    
    await updateDoc(doc(db, 'tenants', tenantId, 'users', userDoc.id), {
      crm_sales: true
    });
    
    console.log(`✅ Marked ${userData.firstName} ${userData.lastName} (${userEmail}) as salesperson`);
    
  } catch (error) {
    console.error("❌ Failed to mark user as salesperson:", error.message);
  }
}

// Example usage:
// setupSalespeople();
// markUserAsSalesperson("p1FxjKpOq2kDjwqmYoSS", "john@company.com");

module.exports = { setupSalespeople, markUserAsSalesperson }; 