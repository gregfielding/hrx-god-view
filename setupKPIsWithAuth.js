const { initializeApp } = require('firebase/app');
const { getFirestore, collection, addDoc, doc, getDoc, getDocs, query, where, serverTimestamp } = require('firebase/firestore');
const { getAuth, signInWithEmailAndPassword } = require('firebase/auth');

// Firebase config for HRX God View
const firebaseConfig = {
  apiKey: 'AIzaSyBQA9bc25_7ncjvY75nAtIUv47C3w5jl6c',
  authDomain: 'hrx1-d3beb.firebaseapp.com',
  projectId: 'hrx1-d3beb',
  storageBucket: 'hrx1-d3beb.firebasestorage.app',
  messagingSenderId: '143752240496',
  appId: '1:143752240496:web:e0b584983d4b04cb3983b5',
  measurementId: 'G-LL20QKNT0W',
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Sample KPI definitions
const sampleKPIs = [
  {
    name: "Daily Sales Calls",
    description: "Number of sales calls made per day",
    category: "activity",
    type: "count",
    target: 30,
    unit: "calls",
    frequency: "daily",
    priority: "high",
    tags: ["outbound", "prospecting", "calls"],
    aiSuggestions: true,
    isActive: true
  },
  {
    name: "Daily Sales Emails",
    description: "Number of sales emails sent per day",
    category: "activity",
    type: "count",
    target: 50,
    unit: "emails",
    frequency: "daily",
    priority: "medium",
    tags: ["outbound", "prospecting", "emails"],
    aiSuggestions: true,
    isActive: true
  },
  {
    name: "Weekly Meetings",
    description: "Number of sales meetings per week",
    category: "activity",
    type: "count",
    target: 8,
    unit: "meetings",
    frequency: "weekly",
    priority: "high",
    tags: ["meetings", "presentations", "demos"],
    aiSuggestions: true,
    isActive: true
  },
  {
    name: "Monthly Revenue",
    description: "Total revenue generated per month",
    category: "revenue",
    type: "currency",
    target: 50000,
    unit: "dollars",
    frequency: "monthly",
    priority: "high",
    tags: ["revenue", "sales", "target"],
    aiSuggestions: true,
    isActive: true
  },
  {
    name: "Lead Conversion Rate",
    description: "Percentage of leads converted to opportunities",
    category: "conversion",
    type: "percentage",
    target: 15,
    unit: "percent",
    frequency: "monthly",
    priority: "medium",
    tags: ["conversion", "leads", "opportunities"],
    aiSuggestions: true,
    isActive: true
  }
];

async function authenticateUser(email, password) {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    console.log('✅ Authenticated as:', userCredential.user.email);
    return userCredential.user;
  } catch (error) {
    console.error('❌ Authentication failed:', error.message);
    throw error;
  }
}

async function getUserTenants(userId) {
  try {
    const userDoc = await getDoc(doc(db, 'users', userId));
    if (userDoc.exists()) {
      const userData = userDoc.data();
      console.log('User data:', JSON.stringify(userData, null, 2));
      
      let tenantIds = [];
      if (userData.tenantIds && typeof userData.tenantIds === 'object' && !Array.isArray(userData.tenantIds)) {
        tenantIds = Object.keys(userData.tenantIds);
      } else if (Array.isArray(userData.tenantIds)) {
        tenantIds = userData.tenantIds;
      } else if (userData.tenantId) {
        tenantIds = [userData.tenantId];
      }
      
      return tenantIds;
    }
    return [];
  } catch (error) {
    console.error('Error getting user tenants:', error);
    return [];
  }
}

async function setupInitialKPIs(tenantId) {
  console.log(`Setting up initial KPIs for tenant: ${tenantId}`);
  
  try {
    // 1. Create KPI definitions
    const kpiIds = [];
    for (const kpi of sampleKPIs) {
      const kpiData = {
        ...kpi,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      
      const docRef = await addDoc(collection(db, 'tenants', tenantId, 'kpi_definitions'), kpiData);
      kpiIds.push(docRef.id);
      console.log(`Created KPI: ${kpi.name} with ID: ${docRef.id}`);
    }
    
    // 2. Find salespeople in the tenant
    const salespeopleQuery = query(
      collection(db, 'tenants', tenantId, 'crm_contacts'),
      where('role', '==', 'salesperson')
    );
    
    const salespeopleSnapshot = await getDocs(salespeopleQuery);
    const salespeople = [];
    
    salespeopleSnapshot.forEach(doc => {
      salespeople.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    console.log(`Found ${salespeople.length} salespeople in tenant`);
    
    if (salespeople.length === 0) {
      console.log('⚠️  No salespeople found. Creating sample salesperson...');
      // Create a sample salesperson for testing
      const sampleSalesperson = {
        firstName: 'Sample',
        lastName: 'Salesperson',
        fullName: 'Sample Salesperson',
        email: 'sample@example.com',
        role: 'salesperson',
        isActive: true,
        createdAt: serverTimestamp()
      };
      
      const salespersonRef = await addDoc(collection(db, 'tenants', tenantId, 'crm_contacts'), sampleSalesperson);
      salespeople.push({
        id: salespersonRef.id,
        ...sampleSalesperson
      });
      console.log('Created sample salesperson for testing');
    }
    
    // 3. Assign KPIs to salespeople
    for (const salesperson of salespeople) {
      // Assign first 3 KPIs (most important) to each salesperson
      for (let i = 0; i < Math.min(3, kpiIds.length); i++) {
        const assignmentData = {
          kpiId: kpiIds[i],
          salespersonId: salesperson.id,
          salespersonName: salesperson.fullName || `${salesperson.firstName} ${salesperson.lastName}`,
          target: sampleKPIs[i].target,
          startDate: new Date().toISOString().split('T')[0],
          isActive: true,
          notes: `Initial assignment for ${sampleKPIs[i].name}`,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        };
        
        await addDoc(collection(db, 'tenants', tenantId, 'kpi_assignments'), assignmentData);
        console.log(`Assigned ${sampleKPIs[i].name} to ${salesperson.fullName || salesperson.firstName}`);
      }
    }
    
    // 4. Create initial tracking records
    const currentPeriod = new Date().toISOString().split('T')[0];
    
    for (const salesperson of salespeople) {
      for (let i = 0; i < Math.min(3, kpiIds.length); i++) {
        const trackingData = {
          kpiAssignmentId: '', // Will be set when we get the assignment ID
          salespersonId: salesperson.id,
          kpiId: kpiIds[i],
          period: currentPeriod,
          currentValue: 0,
          targetValue: sampleKPIs[i].target,
          percentageComplete: 0,
          status: 'behind',
          lastUpdated: serverTimestamp(),
          createdAt: serverTimestamp()
        };
        
        await addDoc(collection(db, 'tenants', tenantId, 'kpi_tracking'), trackingData);
        console.log(`Created tracking record for ${salesperson.fullName || salesperson.firstName} - ${sampleKPIs[i].name}`);
      }
    }
    
    // 5. Create sample AI task suggestions
    for (const salesperson of salespeople) {
      for (let i = 0; i < Math.min(3, kpiIds.length); i++) {
        const suggestionData = {
          salespersonId: salesperson.id,
          kpiId: kpiIds[i],
          title: `Complete ${sampleKPIs[i].name.toLowerCase()}`,
          description: `Work on achieving your ${sampleKPIs[i].name.toLowerCase()} target`,
          type: sampleKPIs[i].name.includes('Call') ? 'call' : 
                sampleKPIs[i].name.includes('Email') ? 'email' : 
                sampleKPIs[i].name.includes('Meeting') ? 'meeting' : 'research',
          priority: sampleKPIs[i].priority,
          suggestedDate: new Date().toISOString().split('T')[0],
          estimatedValue: 1,
          reason: `You're starting fresh with ${sampleKPIs[i].name.toLowerCase()}. This will help you get on track.`,
          isAccepted: false,
          isCompleted: false,
          createdAt: serverTimestamp()
        };
        
        await addDoc(collection(db, 'tenants', tenantId, 'kpi_task_suggestions'), suggestionData);
        console.log(`Created AI suggestion for ${salesperson.fullName || salesperson.firstName} - ${sampleKPIs[i].name}`);
      }
    }
    
    console.log('✅ KPI setup completed successfully!');
    console.log(`Created ${kpiIds.length} KPIs`);
    console.log(`Assigned KPIs to ${salespeople.length} salespeople`);
    console.log(`Created tracking records and AI suggestions`);
    
  } catch (error) {
    console.error('❌ Error setting up KPIs:', error);
    throw error;
  }
}

// Main execution function
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: node setupKPIsWithAuth.js <email> <password> [tenantId]');
    console.log('Or: node setupKPIsWithAuth.js <email> <password> --all');
    return;
  }
  
  const email = args[0];
  const password = args[1];
  const tenantId = args[2];
  
  try {
    // Authenticate user
    const user = await authenticateUser(email, password);
    
    if (tenantId === '--all') {
      // Get all user tenants
      const userTenants = await getUserTenants(user.uid);
      
      if (userTenants.length === 0) {
        console.log('❌ No tenants found for this user');
        return;
      }
      
      console.log(`Found ${userTenants.length} tenants for user`);
      
      for (const tenant of userTenants) {
        console.log(`\n--- Setting up KPIs for tenant: ${tenant} ---`);
        try {
          await setupInitialKPIs(tenant);
        } catch (error) {
          console.error(`Failed to setup KPIs for tenant ${tenant}:`, error);
        }
      }
    } else if (tenantId) {
      // Setup for specific tenant
      await setupInitialKPIs(tenantId);
    } else {
      // Get user's tenants and ask which one to use
      const userTenants = await getUserTenants(user.uid);
      
      if (userTenants.length === 0) {
        console.log('❌ No tenants found for this user');
        return;
      }
      
      console.log(`Found ${userTenants.length} tenants for user:`);
      userTenants.forEach((tenant, index) => {
        console.log(`${index + 1}. ${tenant}`);
      });
      
      console.log('\nTo setup KPIs for a specific tenant, run:');
      console.log(`node setupKPIsWithAuth.js ${email} ${password} <tenant-id>`);
    }
    
  } catch (error) {
    console.error('❌ Setup failed:', error.message);
  }
}

// Run the script
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { setupInitialKPIs, sampleKPIs }; 