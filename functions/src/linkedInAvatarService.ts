import { onCall } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { logger } from 'firebase-functions';

const db = getFirestore();
const storage = getStorage();

export const fetchLinkedInAvatar = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  try {
    const { profileUrl, contactId, tenantId } = request.data;
    
    if (!profileUrl || !contactId || !tenantId) {
      throw new Error('Missing required parameters: profileUrl, contactId, tenantId');
    }

    logger.info('Processing LinkedIn avatar request', { profileUrl, contactId, tenantId });

    // Get contact data to extract name for avatar generation
    const contactDoc = await db.collection('tenants').doc(tenantId).collection('crm_contacts').doc(contactId).get();
    
    if (!contactDoc.exists) {
      throw new Error('Contact not found');
    }

    const contactData = contactDoc.data();
    const contactName = contactData?.fullName || `${contactData?.firstName || ''} ${contactData?.lastName || ''}`.trim();
    
    if (!contactName) {
      throw new Error('Contact name not available');
    }

    // Generate initials for the avatar
    const initials = contactName
      .split(' ')
      .map(word => word.charAt(0))
      .join('')
      .toUpperCase()
      .slice(0, 2);

    // Create a professional-looking avatar using a service like DiceBear or similar
    // For now, we'll use a simple approach with a placeholder service
    const avatarUrl = await generateProfessionalAvatar(contactName, initials);
    
    if (!avatarUrl) {
      return {
        success: false,
        message: 'Could not generate professional avatar'
      };
    }

    // Download the generated avatar and upload to Firebase Storage
    const imageBuffer = await downloadImage(avatarUrl);
    const storageRef = storage.bucket().file(`contact-avatars/${tenantId}/${contactId}.jpg`);
    
    await storageRef.save(imageBuffer, {
      metadata: {
        contentType: 'image/jpeg',
        cacheControl: 'public, max-age=31536000'
      }
    });

    // Get the public URL
    const publicUrl = `https://storage.googleapis.com/${storage.bucket().name}/contact-avatars/${tenantId}/${contactId}.jpg`;
    
    // Update the contact record with the new avatar URL
    await db.collection('tenants').doc(tenantId).collection('crm_contacts').doc(contactId).update({
      avatar: publicUrl,
      updatedAt: new Date()
    });

    logger.info('Professional avatar generated and updated successfully', { contactId, tenantId, avatarUrl: publicUrl });

    return {
      success: true,
      avatarUrl: publicUrl,
      message: 'Professional avatar generated and updated successfully'
    };

  } catch (error) {
    logger.error('Error generating professional avatar:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
});

async function generateProfessionalAvatar(name: string, initials: string): Promise<string | null> {
  try {
    // Use DiceBear API to generate a professional-looking avatar
    // This is a free service that generates consistent, professional avatars
    const encodedName = encodeURIComponent(name);
    const avatarUrl = `https://api.dicebear.com/7.x/initials/svg?seed=${encodedName}&backgroundColor=1976d2&textColor=ffffff&fontSize=40&fontWeight=600&size=200`;
    
    logger.info('Generated professional avatar URL', { name, initials, avatarUrl });
    return avatarUrl;
    
  } catch (error) {
    logger.error('Error generating professional avatar:', error);
    return null;
  }
}

async function downloadImage(url: string): Promise<Buffer> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.statusText}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    logger.error('Error downloading image:', error);
    throw error;
  }
}
