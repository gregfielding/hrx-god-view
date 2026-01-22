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
    // First, try to extract body content from full HTML document
    // Use a more robust regex that handles body tags with attributes
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch && bodyMatch[1]) {
      const bodyContent = bodyMatch[1].trim();
      // If body content is not empty, return it
      if (bodyContent.length > 0) {
        return bodyContent;
      }
    }
    
    // If no body tag or body is empty, try to extract content between html tags
    const htmlMatch = html.match(/<html[^>]*>([\s\S]*?)<\/html>/i);
    if (htmlMatch && htmlMatch[1]) {
      // Remove head section if present (including DOCTYPE comments)
      let content = htmlMatch[1]
        .replace(/<!DOCTYPE[^>]*>/gi, '')
        .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '');
      
      // Also try to extract body if it exists in the html content
      const innerBodyMatch = content.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      if (innerBodyMatch && innerBodyMatch[1]) {
        content = innerBodyMatch[1].trim();
      }
      
      // Remove script tags but preserve style tags (needed for email styling)
      content = content.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
      
      // Only remove style tags that are in the head (not inline styles in body)
      // We'll keep style tags that appear after the first content element
      const firstContentIndex = content.search(/<(table|div|p|span|td|tr|img|a|h[1-6])/i);
      if (firstContentIndex > 0) {
        // Remove style tags that appear before the first content
        const beforeContent = content.substring(0, firstContentIndex);
        const afterContent = content.substring(firstContentIndex);
        const cleanedBefore = beforeContent.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
        content = cleanedBefore + afterContent;
      }
      
      return content.trim();
    }
    
    // If we still have a full document but couldn't extract, try to find the first meaningful content
    // Look for common email content patterns - be more aggressive
    const contentPatterns = [
      /<table[^>]*>[\s\S]*?<\/table>/i,
      /<div[^>]*>[\s\S]*?<\/div>/i,
      /<p[^>]*>[\s\S]*?<\/p>/i,
      /<span[^>]*>[\s\S]*?<\/span>/i,
    ];
    
    for (const pattern of contentPatterns) {
      const match = html.match(pattern);
      if (match && match[0]) {
        // Found some content, extract it and everything after
        const startIndex = html.indexOf(match[0]);
        if (startIndex > 0) {
          // Remove everything before the content (head, DOCTYPE, etc.)
          let extracted = html.substring(startIndex).trim();
          // Also remove any remaining DOCTYPE or html/head tags at the start
          extracted = extracted.replace(/^[\s\S]*?<(table|div|p|span|td|tr|img|a|h[1-6])/i, '<$1');
          return extracted;
        }
      }
    }
    
    // Last resort: try to find content after closing head tag
    const afterHeadMatch = html.match(/<\/head>[\s\S]*/i);
    if (afterHeadMatch && afterHeadMatch[0]) {
      let content = afterHeadMatch[0].replace(/<\/head>/i, '').trim();
      // Remove html/body tags if present
      content = content.replace(/<\/?html[^>]*>/gi, '');
      content = content.replace(/<\/?body[^>]*>/gi, '');
      if (content.length > 0) {
        return content;
      }
    }
  }
  
  // If it's not a full document or we couldn't extract, return as-is
  return html;
}

/**
 * Sanitize HTML while preserving inline styles
 */
function sanitizeEmailHtml(html: string): string {
  if (!html) return '';
  
  // First extract body content if it's a full document
  let sanitized = extractBodyContent(html);
  
  // If we still have a full document after extraction, try one more aggressive extraction
  if (/<!DOCTYPE|<\s*html\s+[^>]*>/i.test(sanitized)) {
    // Force extract body content one more time
    const bodyMatch = sanitized.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch && bodyMatch[1]) {
      sanitized = bodyMatch[1].trim();
    } else {
      // If still no body, try to find content after head
      const afterHead = sanitized.match(/<\/head>[\s\S]*/i);
      if (afterHead && afterHead[0]) {
        sanitized = afterHead[0].replace(/<\/head>/i, '').trim();
        // Remove any remaining html/body wrapper tags
        sanitized = sanitized.replace(/<\/?html[^>]*>/gi, '');
        sanitized = sanitized.replace(/<\/?body[^>]*>/gi, '');
      }
    }
  }
  
  // Remove script tags
  sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  
  // Remove iframe tags (security - but we'll use our own iframe)
  sanitized = sanitized.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
  
  // Remove event handlers (onclick, onload, etc.)
  sanitized = sanitized.replace(/on\w+="[^"]*"/gi, '');
  sanitized = sanitized.replace(/on\w+='[^']*'/gi, '');
  
  // Remove javascript: URLs
  sanitized = sanitized.replace(/javascript:/gi, '');
  
  // Final check: if we still have DOCTYPE or html tags, try to strip them
  if (/<!DOCTYPE|<\s*html\s+[^>]*>/i.test(sanitized)) {
    // Last resort: find the first actual content element
    const firstContentMatch = sanitized.match(/<(table|div|p|span|td|tr|img|a|h[1-6]|ul|ol|li)[^>]*>/i);
    if (firstContentMatch) {
      const startIndex = sanitized.indexOf(firstContentMatch[0]);
      sanitized = sanitized.substring(startIndex);
    }
  }
  
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
  // Re-render when sanitizedHtml changes (e.g., when cid images are resolved)
  useEffect(() => {
    if (hasHtml && iframeRef.current) {
      const iframe = iframeRef.current;

      // Build the full document once and use srcDoc (avoids document.write warnings)
      const srcDoc = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
              * { box-sizing: border-box; margin: 0; padding: 0; }
              html, body { margin: 0; padding: 0; width: 100%; height: auto; overflow: visible; }
              body {
                padding: 8px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
                -webkit-font-smoothing: antialiased;
                -moz-osx-font-smoothing: grayscale;
                background: transparent;
              }
              img { max-width: 100%; height: auto; }
              a { color: #1976d2; text-decoration: underline; }
              a:hover { color: #1565c0; }
              table { border-collapse: collapse; width: 100%; max-width: 100%; }
              pre { white-space: pre-wrap; word-break: break-word; overflow-x: auto; }
              p, div, span, td, th { word-break: break-word; overflow-wrap: break-word; }
              /* Thin, light scrollbar styling per spec */
              ::-webkit-scrollbar { width: 8px; height: 8px; }
              ::-webkit-scrollbar-track { background: rgba(0, 0, 0, 0.02); border-radius: 4px; }
              ::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.15); border-radius: 4px; }
              ::-webkit-scrollbar-thumb:hover { background: rgba(0, 0, 0, 0.25); }
            </style>
          </head>
          <body>
            ${sanitizedHtml}
          </body>
        </html>
      `.trim();

      // Reset fallback when we have HTML and are attempting iframe render
      setUseFallback(false);

      // Load content - update srcdoc whenever sanitizedHtml changes
      // This ensures that when cid images are resolved, the iframe re-renders with the new URLs
      iframe.srcdoc = srcDoc;

      let resizeTimeout: NodeJS.Timeout | null = null;
      let observer: MutationObserver | null = null;

      const getIframeDoc = () => iframe.contentDocument || iframe.contentWindow?.document || null;

      const resizeIframe = () => {
        if (resizeTimeout) clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
          const iframeDoc = getIframeDoc();
          if (!iframeDoc?.body) return;

          requestAnimationFrame(() => {
            const scrollHeight = iframeDoc.documentElement?.scrollHeight || 0;
            const bodyHeight = iframeDoc.body.scrollHeight || 0;
            const offsetHeight = iframeDoc.body.offsetHeight || 0;
            const height = Math.max(scrollHeight, bodyHeight, offsetHeight, 200);
            iframe.style.height = `${height + 40}px`;
          });
        }, 10);
      };

      const setupObservers = () => {
        const iframeDoc = getIframeDoc();
        if (!iframeDoc?.body) {
          setUseFallback(true);
          return;
        }

        // Initial resize with multiple attempts to catch dynamic content
        setTimeout(resizeIframe, 50);
        setTimeout(resizeIframe, 200);
        setTimeout(resizeIframe, 500);
        setTimeout(resizeIframe, 1000);

        // Resize on image load
        const images = iframeDoc.getElementsByTagName('img');
        Array.from(images).forEach((img) => {
          if (img.complete) {
            resizeIframe();
          } else {
            img.onload = resizeIframe;
            img.onerror = resizeIframe;
          }
        });

        // Watch for content changes
        observer = new MutationObserver(() => resizeIframe());
        observer.observe(iframeDoc.body, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true,
        });
      };

      // Setup after load
      iframe.onload = () => {
        try {
          setupObservers();
        } catch {
          setUseFallback(true);
        }
      };

      // Fallback if the iframe never loads/accessible (should be rare with srcDoc)
      const timeout = setTimeout(() => {
        if (!getIframeDoc()) setUseFallback(true);
      }, 1000);

      return () => {
        clearTimeout(timeout);
        if (resizeTimeout) clearTimeout(resizeTimeout);
        if (observer) observer.disconnect();
        iframe.onload = null;
      };
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

