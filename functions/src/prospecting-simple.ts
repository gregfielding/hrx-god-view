import * as admin from 'firebase-admin';
import { onCall } from 'firebase-functions/v2/https';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

// Simple test function without secrets
export const testProspecting = onCall(
  {
    cors: true,
    maxInstances: 10,
  },
  async (request) => {
    const { prompt, tenantId } = request.data;
    const { uid } = request.auth!;

    if (!uid || !tenantId) {
      throw new Error('Unauthorized');
    }

    try {
      // Return mock data for testing
      const mockResults = [
        {
          id: 'test_1',
          contact: {
            firstName: 'John',
            lastName: 'Doe',
            title: 'Operations Manager',
            email: 'john.doe@example.com',
            phone: '+1-555-0123',
            linkedinUrl: 'https://linkedin.com/in/johndoe'
          },
          company: {
            name: 'Example Manufacturing Co.',
            domain: 'example.com',
            location: 'Dallas, TX',
            industry: 'Manufacturing',
            size: '201-1000'
          },
          scores: {
            staffingFit: 85,
            callPriority: 75,
            rationale: 'Manufacturing company with seasonal hiring needs'
          },
          opener: 'Hi John, I noticed Example Manufacturing Co. has been growing in Dallas. I help companies like yours find temporary staffing solutions during peak periods.',
          status: 'new'
        },
        {
          id: 'test_2',
          contact: {
            firstName: 'Jane',
            lastName: 'Smith',
            title: 'HR Director',
            email: 'jane.smith@testcorp.com',
            phone: '+1-555-0456',
            linkedinUrl: 'https://linkedin.com/in/janesmith'
          },
          company: {
            name: 'Test Corporation',
            domain: 'testcorp.com',
            location: 'Dallas, TX',
            industry: 'Technology',
            size: '51-200'
          },
          scores: {
            staffingFit: 70,
            callPriority: 60,
            rationale: 'Tech company with project-based hiring needs'
          },
          opener: 'Hi Jane, I help technology companies like Test Corporation find skilled temporary professionals for project-based work.',
          status: 'new'
        }
      ];

      const summary = {
        totalResults: mockResults.length,
        hotProspects: 1,
        goodProspects: 1,
        unclearProspects: 0,
        companiesFound: 2,
      };

      // Store the test run (commented out for debugging)
      // const runRef = await db
      //   .collection('tenants')
      //   .doc(tenantId)
      //   .collection('prospecting_runs')
      //   .add({
      //     createdAt: admin.firestore.FieldValue.serverTimestamp(),
      //     createdByUid: uid,
      //     originalPrompt: prompt,
      //     results: mockResults,
      //     summary,
      //     counts: {
      //       results: mockResults.length,
      //       hot: 1,
      //       good: 1,
      //       unclear: 0
      //     }
      //   });

      // For now, just return a mock run ID
      const runRef = { id: `test_run_${Date.now()}` };

      return {
        results: mockResults,
        summary,
        runId: runRef.id,
        message: 'Test data returned successfully'
      };

    } catch (error) {
      console.error('Error in test prospecting:', error);
      throw new Error(`Test prospecting failed: ${error.message}`);
    }
  }
);

// Simple save function
export const testSaveSearch = onCall(
  {
    cors: true,
    maxInstances: 10,
  },
  async (request) => {
    const { name, prompt, tenantId } = request.data;
    const { uid } = request.auth!;

    if (!uid || !tenantId) {
      throw new Error('Unauthorized');
    }

    try {
      // const searchRef = await db
      //   .collection('tenants')
      //   .doc(tenantId)
      //   .collection('prospecting_saved_searches')
      //   .add({
      //     name,
      //     prompt,
      //     createdByUid: uid,
      //     visibility: 'private',
      //     createdAt: admin.firestore.FieldValue.serverTimestamp(),
      //     updatedAt: admin.firestore.FieldValue.serverTimestamp()
      //   });

      // For now, just return a mock search ID
      const searchRef = { id: `test_search_${Date.now()}` };

      return { searchId: searchRef.id, message: 'Test search saved successfully' };

    } catch (error) {
      console.error('Error saving test search:', error);
      throw new Error(`Failed to save test search: ${error.message}`);
    }
  }
);
