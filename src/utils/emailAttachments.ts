/**
 * Email Attachment Utilities
 * 
 * Handles attachment thumbnails, PDF viewing, and batch operations
 */

import { getStorage, ref, getDownloadURL } from 'firebase/storage';
import { storage } from '../firebase';

export interface EmailAttachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  storagePath: string;
  downloadUrl?: string;
  thumbnailUrl?: string;
}

/**
 * Check if attachment is an image
 */
export function isImageAttachment(attachment: EmailAttachment): boolean {
  return attachment.contentType?.startsWith('image/') || false;
}

/**
 * Check if attachment is a PDF
 */
export function isPdfAttachment(attachment: EmailAttachment): boolean {
  return attachment.contentType === 'application/pdf' || attachment.name?.toLowerCase().endsWith('.pdf');
}

/**
 * Generate thumbnail URL for image attachment
 */
export async function getThumbnailUrl(attachment: EmailAttachment): Promise<string | null> {
  if (!isImageAttachment(attachment)) {
    return null;
  }

  try {
    // If thumbnailUrl already exists, return it
    if (attachment.thumbnailUrl) {
      return attachment.thumbnailUrl;
    }

    // For Firebase Storage, we can use image resizing
    // This is a placeholder - actual implementation depends on your storage setup
    const storageRef = ref(storage, attachment.storagePath);
    const downloadUrl = await getDownloadURL(storageRef);
    
    // If using Cloudinary or similar, you could resize here
    // For now, return the full image URL
    return downloadUrl;
  } catch (error) {
    console.error('Error generating thumbnail:', error);
    return null;
  }
}

/**
 * Download all attachments as a zip
 */
export async function downloadAllAttachments(
  attachments: EmailAttachment[]
): Promise<void> {
  try {
    // This would require a backend function to create a zip
    // For now, download individually
    for (const attachment of attachments) {
      if (attachment.downloadUrl) {
        const link = document.createElement('a');
        link.href = attachment.downloadUrl;
        link.download = attachment.name;
        link.click();
        // Small delay between downloads
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  } catch (error) {
    console.error('Error downloading attachments:', error);
    throw error;
  }
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Get file icon based on content type
 */
export function getFileIcon(contentType: string): string {
  if (contentType.startsWith('image/')) return '🖼️';
  if (contentType === 'application/pdf') return '📄';
  if (contentType.includes('word')) return '📝';
  if (contentType.includes('excel') || contentType.includes('spreadsheet')) return '📊';
  if (contentType.includes('zip') || contentType.includes('compressed')) return '📦';
  return '📎';
}

