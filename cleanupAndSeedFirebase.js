// Script to clean up existing motivation data and run initial seeding using Firebase Admin
const admin = require('firebase-admin');

// Initialize Firebase Admin SDK with service account
const serviceAccount = require('./firebase.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function cleanupExistingMotivations() {
  console.log('🧹 Cleaning up existing motivation data...');
  
  try {
    // Delete all documents from motivations collection
    const motivationsSnapshot = await db.collection('motivations').get();
    console.log(`Found ${motivationsSnapshot.size} documents in motivations collection`);
    
    if (motivationsSnapshot.size > 0) {
      const batch = db.batch();
      motivationsSnapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });
      await batch.commit();
      console.log(`✅ Deleted ${motivationsSnapshot.size} existing motivation documents`);
    } else {
      console.log('ℹ️  No existing motivation documents found');
    }
    
    // Also clean up motivationMessages collection (legacy)
    const motivationMessagesSnapshot = await db.collection('motivationMessages').get();
    console.log(`Found ${motivationMessagesSnapshot.size} documents in motivationMessages collection`);
    
    if (motivationMessagesSnapshot.size > 0) {
      const batch2 = db.batch();
      motivationMessagesSnapshot.docs.forEach((doc) => {
        batch2.delete(doc.ref);
      });
      await batch2.commit();
      console.log(`✅ Deleted ${motivationMessagesSnapshot.size} legacy motivationMessages documents`);
    } else {
      console.log('ℹ️  No legacy motivationMessages documents found');
    }
    
    return true;
  } catch (error) {
    console.error('❌ Error cleaning up motivation data:', error);
    return false;
  }
}

async function runInitialSeeding() {
  console.log('\n🌱 Running initial seeding from Quotable.io...');
  
  try {
    // Simulate the cloud function logic directly
    const fetch = require('node-fetch');
    
    let totalAdded = 0;
    let currentPage = 1;
    const limit = 20;
    const maxQuotes = 100;
    const addedQuotes = [];
    
    console.log('Fetching quotes from Quotable.io API...');
    
    while (totalAdded < maxQuotes) {
      try {
        const response = await fetch(`https://api.quotable.io/quotes?limit=${limit}&page=${currentPage}`);
        
        if (!response.ok) {
          throw new Error(`API request failed: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        const quotes = data.results || [];
        
        if (quotes.length === 0) {
          console.log('No more quotes available');
          break;
        }
        
        console.log(`Fetched ${quotes.length} quotes from page ${currentPage}`);
        
        // Process each quote
        for (const quote of quotes) {
          if (totalAdded >= maxQuotes) break;
          
          // Transform quote data to match our schema
          const motivationData = {
            text: quote.content,
            quote: quote.content,
            author: quote.author || 'Unknown',
            tags: (quote.tags || []).map((tag) => tag.toLowerCase()),
            toneTags: mapTagsToToneTags(quote.tags || []),
            roleTags: mapTagsToRoleTags(quote.tags || []),
            createdBy: 'system',
            source: 'Quotable.io',
            isActive: true,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            usageCount: 0,
            averageRating: 0,
            enabled: true
          };
          
          // Save to Firestore
          await db.collection('motivations').add(motivationData);
          addedQuotes.push(quote.content);
          totalAdded++;
          
          console.log(`✅ Added: "${quote.content.substring(0, 50)}..." — ${quote.author || 'Unknown'}`);
        }
        
        currentPage++;
        
        // Add a small delay to be respectful to the API
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        console.error(`Error fetching page ${currentPage}:`, error.message);
        break;
      }
    }
    
    console.log(`✅ Seeding completed! Added ${totalAdded} quotes`);
    return { totalAdded, addedQuotes };
    
  } catch (error) {
    console.error('❌ Error during seeding:', error);
    return null;
  }
}

// Helper functions for mapping Quotable.io tags to our schema
function mapTagsToToneTags(tags) {
  const toneMapping = {
    'inspirational': ['Uplifting', 'Encouraging'],
    'motivational': ['Energetic', 'Confident'],
    'wisdom': ['Reflective', 'Mindful'],
    'philosophy': ['Reflective', 'Calm'],
    'life': ['Reflective', 'Positive'],
    'success': ['Confident', 'Tactical'],
    'leadership': ['Confident', 'Focused'],
    'courage': ['Resilient', 'Confident'],
    'perseverance': ['Resilient', 'Disciplined'],
    'patience': ['Calm', 'Mindful'],
    'kindness': ['Empathetic', 'Positive'],
    'love': ['Empathetic', 'Positive'],
    'friendship': ['Empathetic', 'Positive'],
    'happiness': ['Positive', 'Uplifting'],
    'peace': ['Calm', 'Mindful'],
    'hope': ['Uplifting', 'Encouraging'],
    'faith': ['Reflective', 'Positive'],
    'gratitude': ['Positive', 'Reflective'],
    'humor': ['Positive', 'Uplifting'],
    'creativity': ['Energetic', 'Focused']
  };
  
  const mappedTones = [];
  for (const tag of tags) {
    const tones = toneMapping[tag.toLowerCase()];
    if (tones) {
      mappedTones.push(...tones);
    }
  }
  
  if (mappedTones.length === 0) {
    mappedTones.push('General');
  }
  
  return [...new Set(mappedTones)];
}

function mapTagsToRoleTags(tags) {
  const roleMapping = {
    'business': ['Admin', 'Leadership'],
    'leadership': ['Leadership', 'Admin'],
    'success': ['Sales', 'Admin'],
    'work': ['All'],
    'career': ['Admin', 'Sales'],
    'teamwork': ['All'],
    'communication': ['Customer Service', 'Sales'],
    'service': ['Customer Service', 'Healthcare'],
    'health': ['Healthcare'],
    'medical': ['Healthcare'],
    'education': ['Admin', 'Remote'],
    'learning': ['Admin', 'Remote'],
    'technology': ['Admin', 'Remote'],
    'innovation': ['Admin', 'Sales'],
    'creativity': ['Admin', 'Remote'],
    'art': ['Admin', 'Remote'],
    'science': ['Admin', 'Remote'],
    'research': ['Admin', 'Remote'],
    'writing': ['Admin', 'Remote'],
    'teaching': ['Admin', 'Healthcare'],
    'helping': ['Healthcare', 'Customer Service'],
    'caring': ['Healthcare', 'Customer Service'],
    'support': ['Customer Service', 'Healthcare'],
    'hospitality': ['Hospitality', 'Customer Service'],
    'food': ['Hospitality'],
    'restaurant': ['Hospitality'],
    'retail': ['Sales', 'Customer Service'],
    'sales': ['Sales'],
    'marketing': ['Sales', 'Admin'],
    'finance': ['Admin'],
    'accounting': ['Admin'],
    'legal': ['Admin'],
    'law': ['Admin'],
    'justice': ['Admin'],
    'government': ['Admin'],
    'politics': ['Admin'],
    'military': ['Field Ops'],
    'security': ['Field Ops'],
    'safety': ['Field Ops', 'Healthcare'],
    'emergency': ['Field Ops', 'Healthcare'],
    'rescue': ['Field Ops', 'Healthcare'],
    'fire': ['Field Ops'],
    'police': ['Field Ops'],
    'transportation': ['Field Ops', 'Warehouse'],
    'logistics': ['Warehouse', 'Field Ops'],
    'warehouse': ['Warehouse'],
    'manufacturing': ['Warehouse'],
    'construction': ['Field Ops'],
    'maintenance': ['Field Ops'],
    'repair': ['Field Ops'],
    'cleaning': ['Field Ops'],
    'janitorial': ['Field Ops'],
    'landscaping': ['Field Ops'],
    'agriculture': ['Field Ops'],
    'farming': ['Field Ops'],
    'fishing': ['Field Ops'],
    'mining': ['Field Ops'],
    'energy': ['Field Ops'],
    'utilities': ['Field Ops'],
    'telecommunications': ['Customer Service', 'Admin'],
    'media': ['Admin', 'Remote'],
    'entertainment': ['Hospitality', 'Admin'],
    'sports': ['Field Ops'],
    'fitness': ['Field Ops', 'Healthcare'],
    'wellness': ['Healthcare'],
    'therapy': ['Healthcare'],
    'counseling': ['Healthcare', 'Customer Service'],
    'social-work': ['Healthcare', 'Customer Service'],
    'nonprofit': ['All'],
    'volunteer': ['All'],
    'charity': ['All'],
    'community': ['All'],
    'family': ['All'],
    'parenting': ['All'],
    'children': ['All'],
    'youth': ['All'],
    'elderly': ['Healthcare', 'Customer Service'],
    'senior': ['Healthcare', 'Customer Service'],
    'disability': ['Healthcare', 'Customer Service'],
    'accessibility': ['Healthcare', 'Customer Service'],
    'diversity': ['All'],
    'inclusion': ['All'],
    'equality': ['All'],
    'human-rights': ['All'],
    'environment': ['Field Ops'],
    'sustainability': ['Field Ops', 'Admin'],
    'conservation': ['Field Ops'],
    'recycling': ['Field Ops', 'Warehouse'],
    'waste-management': ['Field Ops', 'Warehouse']
  };
  
  const mappedRoles = [];
  for (const tag of tags) {
    const roles = roleMapping[tag.toLowerCase()];
    if (roles) {
      mappedRoles.push(...roles);
    }
  }
  
  if (mappedRoles.length === 0) {
    mappedRoles.push('All');
  }
  
  return [...new Set(mappedRoles)];
}

async function verifySeeding() {
  console.log('\n🔍 Verifying seeding results...');
  
  try {
    const motivationsSnapshot = await db.collection('motivations').get();
    console.log(`📊 Total motivations in database: ${motivationsSnapshot.size}`);
    
    if (motivationsSnapshot.size > 0) {
      console.log('\n📝 Sample quotes:');
      motivationsSnapshot.docs.slice(0, 3).forEach((doc, index) => {
        const data = doc.data();
        console.log(`${index + 1}. "${data.text}"`);
        console.log(`   — ${data.author || 'Unknown'}`);
        console.log(`   Tags: ${data.tags?.join(', ') || 'None'}`);
        console.log(`   Tone: ${data.toneTags?.join(', ') || 'None'}`);
        console.log(`   Roles: ${data.roleTags?.join(', ') || 'None'}`);
        console.log('');
      });
    }
    
    return motivationsSnapshot.size;
  } catch (error) {
    console.error('❌ Error verifying seeding:', error);
    return 0;
  }
}

async function main() {
  console.log('🚀 Starting Motivation Library Cleanup and Seeding\n');
  
  // Step 1: Clean up existing data
  const cleanupSuccess = await cleanupExistingMotivations();
  if (!cleanupSuccess) {
    console.log('❌ Cleanup failed, aborting...');
    return;
  }
  
  // Step 2: Run initial seeding
  const seedingResult = await runInitialSeeding();
  if (!seedingResult) {
    console.log('❌ Seeding failed, aborting...');
    return;
  }
  
  // Step 3: Verify results
  const totalQuotes = await verifySeeding();
  
  console.log('\n🎉 Cleanup and Seeding Complete!');
  console.log(`📈 Total quotes seeded: ${totalQuotes}`);
  console.log('\nNext steps:');
  console.log('1. Check the admin interface at http://localhost:3000');
  console.log('2. Navigate to Admin → Motivation Library Seeder');
  console.log('3. Verify quotes appear in the Daily Motivation module');
}

// Run the script
main().catch(console.error); 