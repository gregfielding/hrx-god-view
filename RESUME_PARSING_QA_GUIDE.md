# Resume Parsing System - QA Testing Guide

## Overview
This document outlines comprehensive testing scenarios for the enhanced resume parsing system with versioning, duplicate detection, OCR fallback, and confidence-based merging.

## Test Scenarios

### 1. File Upload and Basic Parsing

#### 1.1 Supported File Types
- [ ] **PDF (Text-based)**: Upload a standard PDF with selectable text
- [ ] **PDF (Scanned/Image-based)**: Upload a scanned PDF (should trigger OCR)
- [ ] **Word Document (.docx)**: Upload a modern Word document
- [ ] **Word Document (.doc)**: Upload a legacy Word document
- [ ] **Text File (.txt)**: Upload a plain text resume

#### 1.2 File Validation
- [ ] **File Size Limit**: Try uploading files > 10MB (should be rejected)
- [ ] **Invalid File Types**: Try uploading images, videos, etc. (should be rejected)
- [ ] **Corrupted Files**: Try uploading corrupted PDF/Word files (should handle gracefully)

### 2. Duplicate Detection

#### 2.1 Same File Upload
- [ ] **Identical File**: Upload the same resume file twice
  - First upload should parse normally
  - Second upload should detect duplicate and return existing results
  - Should show "Resume already parsed - returning existing results" message

#### 2.2 Similar Files
- [ ] **Same Content, Different Name**: Upload same resume with different filename
  - Should detect duplicate based on file hash
  - Should return existing parsed data

#### 2.3 Different Files
- [ ] **Different Content**: Upload completely different resume
  - Should parse as new resume
  - Should archive previous resume
  - Should create new version

### 3. Resume Versioning

#### 3.1 Version Management
- [ ] **First Upload**: Upload initial resume
  - Should create new version
  - Should be marked as active (not archived)
  - Should be visible in "Current Resume" section

- [ ] **Second Upload**: Upload new resume
  - Should archive previous resume
  - Should create new active version
  - Previous resume should show in history (if implemented)

#### 3.2 Version History
- [ ] **View Previous Resume**: Click "View" on archived resume
  - Should generate signed URL
  - Should open resume in new tab

- [ ] **Download Previous Resume**: Click "Download" on archived resume
  - Should generate signed URL for download
  - Should trigger file download

### 4. OCR Fallback for Scanned PDFs

#### 4.1 Scanned Document Detection
- [ ] **Low Text Content**: Upload PDF with < 10 meaningful words
  - Should trigger OCR automatically
  - Should log "PDF appears to be scanned, attempting OCR..."

#### 4.2 OCR Processing
- [ ] **Successful OCR**: Upload clear scanned resume
  - Should extract text using Google Cloud Vision
  - Should log character count extracted
  - Should proceed with normal parsing

- [ ] **Failed OCR**: Upload poor quality scanned document
  - Should handle OCR failure gracefully
  - Should show appropriate error message
  - Should not crash the system

### 5. Confidence-Based Data Merging

#### 5.1 High Confidence Auto-Merge (≥ 0.8)
- [ ] **Name Extraction**: Resume with clear name
  - Should auto-fill firstName and lastName
  - Should show green "Suggested by Resume" badge
  - Should have confidence score ≥ 0.8

- [ ] **Email Extraction**: Resume with clear email
  - Should auto-fill email field
  - Should show green badge
  - Should have high confidence

#### 5.2 Medium Confidence Suggestions (0.5-0.79)
- [ ] **Phone Number**: Resume with unclear phone format
  - Should suggest phone number
  - Should show yellow badge
  - Should allow user to accept/reject

#### 5.3 Low Confidence Warnings (< 0.5)
- [ ] **Unclear Data**: Resume with poor formatting
  - Should show red badge
  - Should warn user about low confidence
  - Should not auto-fill without user confirmation

### 6. Form Integration and Badges

#### 6.1 Resume Suggestion Badges
- [ ] **Badge Display**: Fields filled from resume should show badges
  - Green badge for high confidence (≥ 0.8)
  - Yellow badge for medium confidence (0.5-0.79)
  - Red badge for low confidence (< 0.5)

- [ ] **Badge Tooltips**: Hover over badges
  - Should show confidence percentage
  - Should explain source (resume suggestion)

- [ ] **Badge Interaction**: Click on badges
  - Should show additional information
  - Should allow user to accept/reject suggestions

#### 6.2 Form Pre-filling
- [ ] **Contact Information**: Resume with clear contact info
  - Should pre-fill firstName, lastName, email, phone
  - Should show appropriate badges
  - Should allow user to modify

- [ ] **Address Information**: Resume with address
  - Should pre-fill street address
  - Should work with Google Places Autocomplete
  - Should not interfere with address selection

### 7. Error Handling and Edge Cases

#### 7.1 Network Issues
- [ ] **Upload Failure**: Simulate network failure during upload
  - Should show appropriate error message
  - Should allow retry
  - Should not lose form data

- [ ] **Parsing Timeout**: Large file or slow processing
  - Should handle timeout gracefully
  - Should show progress indicator
  - Should allow cancellation

#### 7.2 Invalid Data
- [ ] **Malformed Resume**: Resume with no clear structure
  - Should extract whatever data possible
  - Should flag low confidence fields
  - Should not crash the system

- [ ] **Empty Resume**: Upload empty or nearly empty file
  - Should handle gracefully
  - Should show appropriate warning
  - Should allow user to proceed

### 8. Performance Testing

#### 8.1 Large Files
- [ ] **Large PDF**: Upload 10MB PDF file
  - Should process within reasonable time
  - Should show progress indicator
  - Should not timeout

#### 8.2 Multiple Uploads
- [ ] **Rapid Uploads**: Upload multiple resumes quickly
  - Should handle concurrent processing
  - Should not interfere with each other
  - Should maintain versioning correctly

### 9. Integration Testing

#### 9.1 Application Flow
- [ ] **Complete Application**: Upload resume, fill application, submit
  - Resume data should persist through application
  - Badges should remain visible
  - Data should save to user profile

#### 9.2 Profile Integration
- [ ] **Profile Update**: Upload resume, check user profile
  - Resume data should appear in profile
  - Skills should be categorized correctly
  - Contact info should be updated

### 10. Security and Permissions

#### 10.1 File Access
- [ ] **Signed URLs**: View/download previous resumes
  - URLs should expire appropriately
  - Should only be accessible to file owner
  - Should not be accessible to other users

#### 10.2 Data Privacy
- [ ] **Resume Storage**: Check Firestore collections
  - Files should be stored securely
  - Parsed data should follow privacy rules
  - Audit logs should be created

## Test Data Requirements

### Sample Resumes Needed
1. **Standard PDF**: Clear, well-formatted resume with selectable text
2. **Scanned PDF**: Image-based resume (scan of paper document)
3. **Word Document**: Modern .docx with formatting
4. **Legacy Word**: Old .doc format
5. **Text Resume**: Plain text format
6. **Poor Quality**: Blurry or poorly formatted document
7. **Minimal Content**: Resume with very little information
8. **Rich Content**: Resume with extensive experience, skills, education

### Test Accounts
- User with no previous uploads
- User with existing resume uploads
- User with archived resumes
- User with multiple versions

## Expected Outcomes

### Success Criteria
- [ ] All supported file types parse successfully
- [ ] Duplicate detection works correctly
- [ ] OCR fallback handles scanned documents
- [ ] Confidence-based merging functions properly
- [ ] Resume suggestion badges display correctly
- [ ] Form pre-filling works without breaking existing functionality
- [ ] Versioning maintains proper history
- [ ] Error handling is graceful and informative
- [ ] Performance is acceptable for typical file sizes
- [ ] Security and permissions are properly enforced

### Performance Benchmarks
- Standard PDF (< 2MB): < 30 seconds
- Scanned PDF (< 5MB): < 60 seconds
- Word Document (< 2MB): < 20 seconds
- Text File (< 1MB): < 10 seconds

## Troubleshooting Common Issues

### OCR Not Working
- Check Google Cloud Vision API credentials
- Verify file is actually scanned (not text-based)
- Check file size limits for Vision API

### Duplicate Detection Issues
- Verify file hash calculation
- Check Firestore query for existing uploads
- Ensure hash is stored correctly

### Badge Display Problems
- Check resumeSuggestions and resumeConfidence data
- Verify ResumeSuggestionField component integration
- Check CSS styling for badge visibility

### Form Pre-filling Issues
- Verify parsed data structure
- Check field mapping in handleResumeParsed
- Ensure onChange is called with correct data

## Notes
- All tests should be performed in both development and production environments
- Test with different browsers (Chrome, Firefox, Safari, Edge)
- Test on both desktop and mobile devices
- Monitor console for any JavaScript errors
- Check Firebase console for function logs and errors
