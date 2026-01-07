/**
 * EmailBodyRenderer Component
 * 
 * Renders email HTML content while preserving original email styling.
 * Uses CSS isolation to prevent MUI styles from overriding email styles.
 */

import React, { useRef, useEffect } from 'react';
import { Box } from '@mui/material';

interface EmailBodyRendererProps {
  html: string;
  plainText?: string;
  sx?: any;
}

/**
 * Extract body content from full HTML document if needed
 */
function extractBodyContent(html: string): string {
  if (!html) return '';
  
  // Check if this is a full HTML document
  const isFullDocument = /<!DOCTYPE|<\s*html\s+[^>]*>/i.test(html);
  
  if (isFullDocument) {
    // Extract body content from full HTML document
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    if (bodyMatch && bodyMatch[1]) {
      return bodyMatch[1].trim();
    }
    // If no body tag, try to extract content between html tags
    const htmlMatch = html.match(/<html[^>]*>([\s\S]*)<\/html>/i);
    if (htmlMatch && htmlMatch[1]) {
      // Remove head section if present
      const content = htmlMatch[1].replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '');
      return content.trim();
    }
  }
  
  return html;
}

/**
 * Sanitize HTML while preserving inline styles
 */
function sanitizeEmailHtml(html: string): string {
  if (!html) return '';
  
  // First extract body content if it's a full document
  let sanitized = extractBodyContent(html);
  
  // Remove script tags
  sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  
  // Remove iframe tags (security - but we'll use our own iframe)
  sanitized = sanitized.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
  
  // Remove event handlers (onclick, onload, etc.)
  sanitized = sanitized.replace(/on\w+="[^"]*"/gi, '');
  sanitized = sanitized.replace(/on\w+='[^']*'/gi, '');
  
  // Remove javascript: URLs
  sanitized = sanitized.replace(/javascript:/gi, '');
  
  return sanitized;
}

const EmailBodyRenderer: React.FC<EmailBodyRendererProps> = ({
  html,
  plainText,
  sx = {},
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [useFallback, setUseFallback] = React.useState(false);
  const sanitizedHtml = html ? sanitizeEmailHtml(html) : '';
  const hasHtml = sanitizedHtml.length > 0;

  // Use iframe for true CSS isolation when HTML is present
  useEffect(() => {
    if (hasHtml && iframeRef.current) {
      const iframe = iframeRef.current;
      
      // Wait for iframe to be ready
      const setupIframe = () => {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
        
        if (iframeDoc) {
          // Write the email HTML to the iframe
          iframeDoc.open();
          iframeDoc.write(`
            <!DOCTYPE html>
            <html>
              <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                  * {
                    box-sizing: border-box;
                    margin: 0;
                    padding: 0;
                  }
                  html, body {
                    margin: 0;
                    padding: 0;
                    width: 100%;
                    height: auto;
                    overflow: visible;
                  }
                  body {
                    padding: 8px;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
                    -webkit-font-smoothing: antialiased;
                    -moz-osx-font-smoothing: grayscale;
                    background: transparent;
                  }
                  img {
                    max-width: 100%;
                    height: auto;
                  }
                  a {
                    color: #1976d2;
                    text-decoration: underline;
                  }
                  a:hover {
                    color: #1565c0;
                  }
                  table {
                    border-collapse: collapse;
                    width: 100%;
                    max-width: 100%;
                  }
                  pre {
                    white-space: pre-wrap;
                    word-break: break-word;
                    overflow-x: auto;
                  }
                  p, div, span, td, th {
                    word-break: break-word;
                    overflow-wrap: break-word;
                  }
                  /* Thin, light scrollbar styling per spec */
                  ::-webkit-scrollbar {
                    width: 8px;
                    height: 8px;
                  }
                  ::-webkit-scrollbar-track {
                    background: rgba(0, 0, 0, 0.02);
                    border-radius: 4px;
                  }
                  ::-webkit-scrollbar-thumb {
                    background: rgba(0, 0, 0, 0.15);
                    border-radius: 4px;
                  }
                  ::-webkit-scrollbar-thumb:hover {
                    background: rgba(0, 0, 0, 0.25);
                  }
                </style>
              </head>
              <body>
                ${sanitizedHtml}
              </body>
            </html>
          `);
          iframeDoc.close();
          
          // Adjust iframe height to content - ensure it's tall enough and not clipped
          let resizeTimeout: NodeJS.Timeout | null = null;
          const resizeIframe = () => {
            if (resizeTimeout) {
              clearTimeout(resizeTimeout);
            }
            resizeTimeout = setTimeout(() => {
              if (iframeDoc.body) {
                // Use requestAnimationFrame for smoother resizing
                requestAnimationFrame(() => {
                  const scrollHeight = iframeDoc.documentElement.scrollHeight;
                  const bodyHeight = iframeDoc.body.scrollHeight;
                  const offsetHeight = iframeDoc.body.offsetHeight;
                  // Get the maximum height to ensure nothing is clipped
                  const height = Math.max(scrollHeight, bodyHeight, offsetHeight, 200);
                  // Add extra padding to prevent clipping
                  iframe.style.height = `${height + 40}px`;
                });
              }
            }, 10);
          };
          
          // Initial resize with multiple attempts to catch dynamic content
          setTimeout(resizeIframe, 50);
          setTimeout(resizeIframe, 200);
          setTimeout(resizeIframe, 500);
          setTimeout(resizeIframe, 1000); // Extra delay for slow-loading content
          
          // Resize on image load
          const images = iframeDoc.getElementsByTagName('img');
          Array.from(images).forEach(img => {
            if (img.complete) {
              resizeIframe();
            } else {
              img.onload = resizeIframe;
              img.onerror = resizeIframe;
            }
          });
          
          // Use MutationObserver to watch for content changes
          const observer = new MutationObserver(() => {
            resizeIframe();
          });
          observer.observe(iframeDoc.body, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: true,
          });
          
          // Also listen for iframe load event
          iframe.onload = () => {
            resizeIframe();
          };
          
          // Cleanup function
          return () => {
            if (resizeTimeout) {
              clearTimeout(resizeTimeout);
            }
            observer.disconnect();
          };
        } else {
          // If iframe document is not accessible, use fallback
          setUseFallback(true);
        }
      };
      
      // Try to setup immediately, or wait for iframe to be ready
      if (iframe.contentDocument) {
        setupIframe();
      } else {
        const timeout = setTimeout(() => {
          // If iframe doesn't load within 1 second, use fallback
          if (!iframe.contentDocument) {
            setUseFallback(true);
          }
        }, 1000);
        
        iframe.onload = () => {
          clearTimeout(timeout);
          setupIframe();
        };
      }
    }
  }, [hasHtml, sanitizedHtml]);

  if (!hasHtml && plainText) {
    // Fallback to plain text
    return (
      <Box
        sx={{
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          ...sx,
        }}
      >
        {plainText}
      </Box>
    );
  }

  if (!hasHtml) {
    return null;
  }

  // Fallback: render HTML directly if iframe fails or is disabled
  if (useFallback) {
    return (
      <Box
        component="div"
        className="email-body-content"
        sx={{
          // Reset MUI Typography defaults
          fontFamily: 'inherit',
          fontSize: 'inherit',
          fontWeight: 'inherit',
          lineHeight: 'inherit',
          color: 'inherit',
          backgroundColor: 'transparent',
          
          // Preserve email styling
          '& *': {
            boxSizing: 'border-box',
          },
          
          '& img': {
            maxWidth: '100%',
            height: 'auto',
          },
          
          '& a': {
            color: '#1976d2',
            textDecoration: 'underline',
            '&:hover': {
              color: '#1565c0',
            },
          },
          
          '& table': {
            borderCollapse: 'collapse',
            width: '100%',
            maxWidth: '100%',
          },
          
          '& pre': {
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            overflowX: 'auto',
          },
          
          '& p, & div, & span, & td, & th': {
            wordBreak: 'break-word',
            overflowWrap: 'break-word',
          },
          
          ...sx,
        }}
        dangerouslySetInnerHTML={{
          __html: sanitizedHtml,
        }}
      />
    );
  }

  // Use iframe for true CSS isolation
  return (
    <Box
      sx={{
        position: 'relative',
        width: '100%',
        border: 'none',
        // Remove overflow from container - let iframe handle it
        overflow: 'visible',
        ...sx,
      }}
    >
      <iframe
        ref={iframeRef}
        style={{
          width: '100%',
          border: 'none',
          display: 'block',
          minHeight: '200px',
          // No scrolling on iframe itself - it will auto-resize to content
          overflow: 'hidden',
        }}
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        title="Email content"
      />
    </Box>
  );
};

export default EmailBodyRenderer;

