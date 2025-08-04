import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineString } from 'firebase-functions/params';
import { initializeApp, getApps, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Define config parameters
const serpApiKey = defineString('SERP_API_KEY');

// Initialize Firebase Admin (only if not already initialized)
const app = !getApps().length ? initializeApp() : getApp();
const db = getFirestore(app);

export const fetchFollowedCompanyNews = onSchedule({
  schedule: '0 */12 * * *', // Every 12 hours
  timeZone: 'America/New_York',
  retryCount: 3
}, async (event) => {
  try {
    console.log('Starting scheduled news fetch for followed companies...');
    
    const apiKey = serpApiKey.value();
    if (!apiKey) {
      console.error('SERP API key not configured for news fetching');
      return;
    }

    // Get all users and their followed companies
    const usersSnap = await db.collection('users').get();
    const companyIds = new Set<string>();

    console.log(`Processing ${usersSnap.docs.length} users...`);

    for (const userDoc of usersSnap.docs) {
      try {
        const followsSnap = await db.collection(`users/${userDoc.id}/followedCompanies`).get();
        followsSnap.forEach(doc => companyIds.add(doc.id));
      } catch (error) {
        console.error(`Error getting followed companies for user ${userDoc.id}:`, error);
      }
    }

    console.log(`Found ${companyIds.size} unique followed companies`);

    // Fetch news for each company
    const today = new Date().toISOString().split('T')[0];
    let processedCount = 0;
    let errorCount = 0;

    for (const companyId of companyIds) {
      try {
        // Get company details
        const companyDoc = await db.doc(`crm_companies/${companyId}`).get();
        if (!companyDoc.exists) {
          console.log(`Company ${companyId} not found, skipping...`);
          continue;
        }

        const companyData = companyDoc.data();
        const companyName = companyData?.companyName || companyData?.name;
        
        if (!companyName) {
          console.log(`Company ${companyId} has no name, skipping...`);
          continue;
        }

        console.log(`Fetching news for: ${companyName}`);

        // Fetch news using SERP API
        const newsQuery = `"${companyName}" site:news.google.com`;
        const newsUrl = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(newsQuery)}&tbm=nws&api_key=${apiKey}&num=10`;
        
        const response = await fetch(newsUrl);
        if (!response.ok) {
          throw new Error(`SERP API request failed: ${response.status}`);
        }

        const data = await response.json();
        const articles = (data.news_results || []).slice(0, 5).map((article: any) => ({
          title: article.title,
          url: article.link,
          source: article.source,
          snippet: article.snippet,
          publishedAt: article.date,
          companyId,
          companyName
        }));

        if (articles.length > 0) {
          // Cache the articles
          await db.doc(`companyNewsCache/${companyId}/${today}`).set({ 
            articles,
            fetchedAt: new Date(),
            companyName
          });
          
          console.log(`Cached ${articles.length} articles for ${companyName}`);
          processedCount++;
        } else {
          console.log(`No news found for ${companyName}`);
        }

        // Add a small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        console.error(`Error processing company ${companyId}:`, error);
        errorCount++;
      }
    }

    console.log(`News fetch completed. Processed: ${processedCount}, Errors: ${errorCount}`);

  } catch (error) {
    console.error('Error in fetchFollowedCompanyNews:', error);
    throw error;
  }
}); 