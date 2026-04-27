import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { logger } from './utils/logger';

const db = admin.firestore();

/**
 * Callable function to add a job title to a tenant's job titles collection
 * 
 * @param request.data.tenantId - The tenant ID
 * @param request.data.jobTitle - The job title to add
 * @param request.data.description - Optional description
 * @param request.data.experience - Optional experience requirements
 * @param request.data.education - Optional education requirements
 * @param request.data.certifications - Optional certifications array
 * @param request.data.skills - Optional skills array
 * @param request.data.licenses - Optional licenses array
 * @param request.data.languages - Optional languages array
 * @param request.data.physicalRequirements - Optional physical requirements array
 * @param request.data.shiftType - Optional shift types array
 * @param request.data.payRange - Optional pay range
 */
export const addJobTitle = onCall(
  {
    cors: true,
    region: 'us-central1',
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async (request) => {
    try {
      const { tenantId, jobTitle, description, experience, education, certifications, skills, licenses, languages, physicalRequirements, shiftType, payRange } = request.data;

      if (!tenantId || !jobTitle) {
        throw new HttpsError('invalid-argument', 'tenantId and jobTitle are required');
      }

      logger.info('Adding job title', {
        context: 'addJobTitle',
        extra: { tenantId, jobTitle },
      });

      const newJobTitle = {
        title: jobTitle.trim(),
        description: description?.trim() || '',
        experience: experience?.trim() || '',
        education: education?.trim() || '',
        certifications: certifications || [],
        skills: skills || [],
        licenses: licenses || [],
        languages: languages || [],
        physicalRequirements: physicalRequirements || [],
        shiftType: shiftType || [],
        payRange: payRange?.trim() || '',
      };

      // Try to add to subcollection first
      try {
        const jobTitlesCollection = db
          .collection('tenants')
          .doc(tenantId)
          .collection('modules')
          .doc('hrx-flex')
          .collection('jobTitles');
        
        await jobTitlesCollection.add(newJobTitle);
        
        logger.info('Job title added to subcollection', {
          context: 'addJobTitle',
          extra: { tenantId, jobTitle },
        });

        return {
          success: true,
          message: `Job title "${jobTitle}" added successfully`,
          location: 'subcollection',
        };
      } catch (subcollectionError: any) {
        logger.info('Subcollection add failed, trying module settings', {
          context: 'addJobTitle',
          extra: { tenantId, jobTitle, error: subcollectionError.message },
        });
        
        // If subcollection fails, add to module settings
        const flexModuleRef = db
          .collection('tenants')
          .doc(tenantId)
          .collection('modules')
          .doc('hrx-flex');
        
        const flexDoc = await flexModuleRef.get();
        const currentData = flexDoc.exists ? flexDoc.data() : {};
        const existingJobTitles = currentData?.jobTitles || [];
        
        // Check if job title already exists
        if (existingJobTitles.some((jt: any) => jt.title === jobTitle.trim())) {
          return {
            success: false,
            message: `Job title "${jobTitle}" already exists`,
            location: 'module_settings',
          };
        }
        
        await flexModuleRef.set(
          {
            ...currentData,
            jobTitles: [...existingJobTitles, newJobTitle],
          },
          { merge: true }
        );

        logger.info('Job title added to module settings', {
          context: 'addJobTitle',
          extra: { tenantId, jobTitle },
        });

        return {
          success: true,
          message: `Job title "${jobTitle}" added successfully`,
          location: 'module_settings',
        };
      }
    } catch (error: any) {
      logger.error('Error adding job title', {
        context: 'addJobTitle',
        error: error.message,
        extra: request.data,
      });
      throw new HttpsError('internal', error.message || 'Failed to add job title');
    }
  }
);

