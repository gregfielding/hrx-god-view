/**
 * Email Template Editor Component
 * 
 * Rich text editor for email templates with variable insertion support
 */

import React, { useRef, useEffect } from 'react';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import {
  Box,
  Typography,
  Paper,
  Tabs,
  Tab,
  Stack,
  Chip,
  Button,
  IconButton,
  Tooltip,
} from '@mui/material';
import CodeIcon from '@mui/icons-material/Code';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { extractVariables } from '../utils/templateApi';

interface EmailTemplateEditorProps {
  htmlBody: string;
  onChange: (htmlBody: string) => void;
  variables?: string[];
  onVariablesChange?: (variables: string[]) => void;
  availableVariables?: string[];
  onVariableInsert?: (variable: string) => void;
  hideViewToggle?: boolean; // Hide Visual/HTML toggle
  editorHeight?: number; // Custom editor height
}

const EmailTemplateEditor: React.FC<EmailTemplateEditorProps> = ({
  htmlBody,
  onChange,
  variables = [],
  onVariablesChange,
  availableVariables = [],
  onVariableInsert,
  hideViewToggle = false,
  editorHeight = 300,
}) => {
  const quillRef = useRef<ReactQuill>(null);
  const [viewMode, setViewMode] = React.useState<'visual' | 'html'>('visual');
  const [htmlSource, setHtmlSource] = React.useState(htmlBody);
  const [quillValue, setQuillValue] = React.useState(htmlBody);
  const lastHtmlBodyRef = useRef<string>('');

  // Update HTML source when htmlBody prop changes
  useEffect(() => {
    // Only update if htmlBody actually changed
    if (lastHtmlBodyRef.current !== htmlBody) {
      lastHtmlBodyRef.current = htmlBody;
      setHtmlSource(htmlBody || '');
      setQuillValue(htmlBody || '');
      
      // Update Quill editor content if in visual mode
      if (quillRef.current && viewMode === 'visual') {
        const quill = quillRef.current.getEditor();
        const currentContent = quill.root.innerHTML.trim();
        const newContent = (htmlBody || '').trim();
        
        // Only update if content is actually different
        if (currentContent !== newContent) {
          // Use setTimeout to ensure Quill is fully initialized
          setTimeout(() => {
            if (quillRef.current) {
              const quill = quillRef.current.getEditor();
              quill.clipboard.dangerouslyPasteHTML(newContent || '<p><br></p>');
            }
          }, 100);
        }
      }
    }
  }, [htmlBody, viewMode]);

  const handleHtmlChange = (newHtml: string) => {
    setHtmlSource(newHtml);
    onChange(newHtml);
    
    // Auto-extract variables
    if (onVariablesChange) {
      const extracted = extractVariables(newHtml);
      onVariablesChange(extracted);
    }
  };

  const handleInsertVariable = (variable: string) => {
    if (viewMode === 'html') {
      // Insert into HTML source
      const textarea = document.querySelector('textarea[data-view="html"]') as HTMLTextAreaElement;
      if (textarea) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const newValue = htmlSource.substring(0, start) + `{{${variable}}}` + htmlSource.substring(end);
        handleHtmlChange(newValue);
        // Restore cursor position
        setTimeout(() => {
          textarea.setSelectionRange(start + variable.length + 4, start + variable.length + 4);
        }, 0);
      }
    } else {
      // Insert into Quill editor
      const quill = quillRef.current?.getEditor();
      if (quill) {
        const range = quill.getSelection(true);
        quill.insertText(range.index, `{{${variable}}}`, 'user');
        quill.setSelection(range.index + variable.length + 4);
      }
    }
    
    if (onVariableInsert) {
      onVariableInsert(variable);
    }
  };

  const modules = {
    toolbar: {
      container: [
        [{ 'header': [1, 2, 3, false] }],
        ['bold', 'italic', 'underline', 'strike'],
        [{ 'list': 'ordered'}, { 'list': 'bullet' }],
        [{ 'color': [] }, { 'background': [] }],
        [{ 'align': [] }],
        ['link'],
        ['clean'],
      ],
    },
  };

  const formats = [
    'header',
    'bold', 'italic', 'underline', 'strike',
    'list', 'bullet',
    'color', 'background',
    'align',
    'link',
  ];

  return (
    <Box>
      {/* Toolbar with variable palette */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        {!hideViewToggle && (
          <Tabs
            value={viewMode}
            onChange={(e, newValue) => setViewMode(newValue)}
            sx={{ minHeight: 'auto' }}
          >
            <Tab 
              label="Visual" 
              value="visual" 
              icon={<VisibilityIcon fontSize="small" />} 
              iconPosition="start"
              sx={{ minHeight: 'auto', py: 0.5 }}
            />
            <Tab 
              label="HTML" 
              value="html" 
              icon={<CodeIcon fontSize="small" />} 
              iconPosition="start"
              sx={{ minHeight: 'auto', py: 0.5 }}
            />
          </Tabs>
        )}

        {/* Variable Palette */}
        {availableVariables.length > 0 && (
          <Stack direction="row" spacing={0.5} flexWrap="wrap" gap={0.5} sx={{ flex: 1, justifyContent: hideViewToggle ? 'flex-start' : 'flex-end' }}>
            {availableVariables.map((variable) => (
              <Tooltip key={variable} title={`Insert {{${variable}}}`}>
                <Chip
                  label={`{{${variable}}}`}
                  size="small"
                  variant="outlined"
                  onClick={() => handleInsertVariable(variable)}
                  sx={{ cursor: 'pointer', fontSize: '0.75rem', py: 0.5 }}
                />
              </Tooltip>
            ))}
          </Stack>
        )}
      </Box>

      {/* Editor */}
      {viewMode === 'visual' ? (
        <Box 
          sx={{ 
            border: '1px solid #e0e0e0', 
            borderRadius: 1,
            '& .quill': {
              display: 'flex',
              flexDirection: 'column',
            },
            '& .ql-container': {
              flex: 1,
              minHeight: `${editorHeight}px`,
              fontSize: '14px',
            },
            '& .ql-editor': {
              minHeight: `${editorHeight}px`,
              fontSize: '14px',
            },
          }}
        >
          <ReactQuill
            ref={quillRef}
            theme="snow"
            value={quillValue || ''}
            onChange={(content, delta, source, editor) => {
              // Only update if change came from user interaction, not programmatic
              if (source === 'user') {
                const html = editor.getHTML();
                setQuillValue(html);
                handleHtmlChange(html);
              }
            }}
            modules={modules}
            formats={formats}
          />
        </Box>
      ) : (
        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
            Edit HTML directly. Variables will be automatically detected.
          </Typography>
          <textarea
            data-view="html"
            value={htmlSource}
            onChange={(e) => handleHtmlChange(e.target.value)}
            style={{
              width: '100%',
              minHeight: '300px',
              fontFamily: 'monospace',
              fontSize: '14px',
              padding: '12px',
              border: '1px solid #e0e0e0',
              borderRadius: '4px',
              resize: 'vertical',
            }}
          />
        </Box>
      )}

      {/* Detected Variables Display */}
      {variables.length > 0 && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="caption" color="text.secondary" gutterBottom>
            Detected Variables:
          </Typography>
          <Stack direction="row" spacing={0.5} flexWrap="wrap" gap={0.5} sx={{ mt: 0.5 }}>
            {variables.map((variable) => (
              <Chip
                key={variable}
                label={`{{${variable}}}`}
                size="small"
                variant="outlined"
                color="primary"
              />
            ))}
          </Stack>
        </Box>
      )}
    </Box>
  );
};

export default EmailTemplateEditor;

