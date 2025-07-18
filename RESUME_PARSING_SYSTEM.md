# Resume Parsing System

A comprehensive AI-powered resume parsing system that automatically extracts skills, education, experience, certifications, and other relevant information from uploaded resumes and updates user profiles.

## 🚀 Features

- **Multi-format Support**: PDF, Word (.docx, .doc), and text files
- **AI-Powered Extraction**: Uses OpenAI GPT for intelligent parsing
- **Automatic Profile Updates**: Merges extracted data into user profiles
- **Real-time Progress Tracking**: Live status updates during parsing
- **Resume History**: Track and view all parsed resumes
- **Drag & Drop Interface**: Modern, intuitive upload experience
- **Error Handling**: Comprehensive error handling and validation

## 📋 System Architecture

### Backend (Firebase Functions)
- `parseResume`: Main parsing function with AI extraction
- `getResumeParsingStatus`: Check parsing progress
- `getUserParsedResumes`: Retrieve resume history

### Frontend (React Components)
- `ResumeUpload`: Drag & drop upload with progress tracking
- `ResumeHistory`: Table view of parsed resumes
- `ResumeManagement`: Main page with tabs

## 🛠️ Setup Instructions

### 1. Backend Setup

#### Prerequisites
- Firebase project with Functions enabled
- OpenAI API key
- Node.js 20+ for local development

#### Installation
```bash
cd functions
npm install pdf-parse mammoth multer busboy natural compromise
```

#### Environment Configuration
```bash
# Set OpenAI API key
firebase functions:config:set openai.key="YOUR_OPENAI_API_KEY"
```

#### Deploy Functions
```bash
# Deploy all functions
firebase deploy --only functions

# Or deploy specific functions
firebase deploy --only functions:parseResume,functions:getResumeParsingStatus,functions:getUserParsedResumes
```

### 2. Frontend Setup

#### Install Dependencies
```bash
npm install react-dropzone
```

#### Add Route
The resume management route is already added to `App.tsx`:
```tsx
<Route path="resume" element={<ResumeManagement />} />
```

#### Add Menu Item
The menu item is already added to `menuGenerator.ts`:
```tsx
{ text: 'Resume Management', to: '/resume' }
```

## 📖 Usage Guide

### For Users

1. **Navigate to Resume Management**
   - Click "Resume Management" in the sidebar menu
   - Or go to `/resume` directly

2. **Upload Resume**
   - Drag & drop your resume file or click to browse
   - Supported formats: PDF, Word (.docx, .doc), Text (.txt)
   - Maximum file size: 10MB

3. **Monitor Progress**
   - Real-time progress bar shows upload and parsing status
   - Success/error messages provide clear feedback

4. **View Results**
   - Click the eye icon to preview parsed data
   - Your profile is automatically updated with extracted information

5. **Access History**
   - Switch to "Resume History" tab to view all uploaded resumes
   - Click on any resume to view its parsed data

### For Developers

#### API Reference

##### `parseResume`
```typescript
interface ParseResumeRequest {
  fileUrl: string;        // Base64 encoded file data
  fileName: string;       // Original filename
  fileSize: number;       // File size in bytes
  userId: string;         // User ID
  customerId?: string;    // Optional customer ID
  agencyId?: string;      // Optional agency ID
}

interface ParseResumeResponse {
  success: boolean;
  parsedData?: {
    contact: ContactInfo;
    summary: string;
    skills: Skill[];
    education: Education[];
    experience: WorkExperience[];
    certifications: Certification[];
    languages: Language[];
  };
  error?: string;
}
```

##### `getResumeParsingStatus`
```typescript
interface GetStatusRequest {
  userId: string;
  resumeId: string;
}

interface GetStatusResponse {
  success: boolean;
  status: 'processing' | 'completed' | 'failed';
  progress: number;
  parsedData?: any;
  error?: string;
}
```

##### `getUserParsedResumes`
```typescript
interface GetResumesRequest {
  userId: string;
}

interface GetResumesResponse {
  success: boolean;
  resumes: ParsedResume[];
  error?: string;
}
```

#### Component Usage

```tsx
import ResumeUpload from '../components/ResumeUpload';
import ResumeHistory from '../components/ResumeHistory';

// Basic usage
<ResumeUpload 
  userId={user.uid}
  onResumeParsed={(data) => console.log('Parsed:', data)}
/>

// With organization context
<ResumeUpload 
  userId={user.uid}
  customerId={customerId}
  agencyId={agencyId}
  onResumeParsed={handleResumeParsed}
/>

// Resume history
<ResumeHistory userId={user.uid} />
```

## 🔧 Configuration

### File Size Limits
- Default: 10MB
- Configure in `ResumeUpload.tsx`:
```tsx
if (file.size > 10 * 1024 * 1024) {
  // Handle file too large
}
```

### Supported File Types
- PDF: `application/pdf`
- Word (.docx): `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- Word (.doc): `application/msword`
- Text: `text/plain`

### AI Extraction Settings
Configure in `functions/src/resumeParser.ts`:
```typescript
const OPENAI_MODEL = 'gpt-4';
const MAX_TOKENS = 4000;
const TEMPERATURE = 0.1;
```

## 🧪 Testing

### Run Test Script
```bash
node testResumeParsing.js
```

### Manual Testing
1. Upload a sample resume
2. Check parsing results
3. Verify profile updates
4. Test error scenarios

### Test Cases
- ✅ Valid PDF upload
- ✅ Valid Word document upload
- ✅ Invalid file type rejection
- ✅ File size limit enforcement
- ✅ Error handling for corrupted files
- ✅ Progress tracking
- ✅ Resume history display

## 🐛 Troubleshooting

### Common Issues

#### "OpenAI API key not found"
```bash
firebase functions:config:set openai.key="YOUR_ACTUAL_API_KEY"
```

#### "Functions not deployed"
```bash
firebase deploy --only functions:parseResume,functions:getResumeParsingStatus,functions:getUserParsedResumes
```

#### "File upload fails"
- Check file size (max 10MB)
- Verify file format is supported
- Ensure network connectivity

#### "Parsing fails"
- Check OpenAI API key is valid
- Verify API quota/limits
- Check function logs: `firebase functions:log`

### Debug Mode
Enable detailed logging in `functions/src/resumeParser.ts`:
```typescript
const DEBUG_MODE = true;
```

## 📊 Performance

### Benchmarks
- **Upload Time**: ~2-5 seconds for 1MB files
- **Parsing Time**: ~10-30 seconds depending on resume complexity
- **AI Processing**: ~5-15 seconds for OpenAI API calls

### Optimization Tips
- Compress large PDFs before upload
- Use standard resume formats for best results
- Implement caching for frequently accessed data

## 🔒 Security

### Data Protection
- Files are processed in memory, not stored permanently
- Parsed data is stored in Firestore with user authentication
- OpenAI API calls use secure HTTPS

### Access Control
- Users can only access their own resumes
- Admin users can view all resumes within their organization
- File uploads require authentication

## 🚀 Deployment

### Production Checklist
- [ ] OpenAI API key configured
- [ ] Functions deployed successfully
- [ ] Frontend dependencies installed
- [ ] Routes and menu items added
- [ ] File size limits configured
- [ ] Error handling tested
- [ ] Performance monitoring enabled

### Monitoring
```bash
# View function logs
firebase functions:log

# Monitor function performance
firebase functions:config:get
```

## 📈 Future Enhancements

### Planned Features
- [ ] Resume comparison tool
- [ ] Skills gap analysis
- [ ] Job matching based on parsed data
- [ ] Resume template suggestions
- [ ] Multi-language support
- [ ] Advanced AI models integration

### Integration Opportunities
- Job posting matching
- Skills assessment tools
- Training recommendation engine
- Performance analytics

## 📞 Support

For technical support or questions:
1. Check the troubleshooting section
2. Review function logs
3. Test with the provided test script
4. Contact the development team

---

**Version**: 1.0.0  
**Last Updated**: December 2024  
**Maintainer**: HRX Development Team 