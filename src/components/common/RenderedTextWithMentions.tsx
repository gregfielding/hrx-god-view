/**
 * RenderedTextWithMentions Component
 * 
 * Renders text with mentions as clickable links.
 * Supports @user, #contact, &company, %deal mentions.
 */

import React, { useState, useRef } from 'react';
import { Link, Typography, TypographyProps } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import type { Mention } from '../../types/crossSystemMentions';
import { MENTION_REGEX } from '../../utils/mentions/parseMentions';
import { MentionHoverCard } from './MentionHoverCard';

interface RenderedTextWithMentionsProps {
  text: string;
  mentions: Mention[];
  variant?: TypographyProps['variant'];
  color?: TypographyProps['color'];
  sx?: TypographyProps['sx'];
}

/**
 * Get the URL for a mention based on its type
 */
function getMentionUrl(mention: Mention): string {
  switch (mention.type) {
    case 'user':
      return `/users/${mention.id}`;
    case 'worker':
      return `/users/${mention.id}`;  // Workers are also users
    case 'contact':
      return `/crm/contacts/${mention.id}`;
    case 'company':
      return `/crm/companies/${mention.id}`;
    case 'deal':
      return `/crm/deals/${mention.id}`;
    default:
      return '#';
  }
}

/**
 * Get the display text for a mention
 */
function getMentionDisplayText(mention: Mention): string {
  const prefixMap: Record<Mention['type'], string> = {
    user: '@',      // Internal team (securityLevel 5-7)
    worker: '&',   // Workers (securityLevel 1-4)
    contact: '#',
    company: '&',  // Keep for backward compatibility
    deal: '%',
    job: '!',
    candidate: '^',
    location: '*',
    task: '~',
  };
  return `${prefixMap[mention.type]}${mention.label}`;
}

/**
 * Renders text with mentions as clickable links
 */
export const RenderedTextWithMentions: React.FC<RenderedTextWithMentionsProps> = ({
  text,
  mentions,
  variant = 'body1',
  color = 'text.primary',
  sx,
}) => {
  const navigate = useNavigate();
  const [hoveredMention, setHoveredMention] = useState<{ mention: Mention; anchorEl: HTMLElement } | null>(null);
  const mentionRefs = useRef<Map<string, HTMLElement>>(new Map());

  // Build a map from mention text (prefix + label) to Mention object
  const mentionMap = new Map<string, Mention>();
  for (const mention of mentions) {
    const displayText = getMentionDisplayText(mention);
    mentionMap.set(displayText.toLowerCase(), mention);
    
    // Also map by slug if available
    if (mention.slug) {
      const prefix = mention.type === 'user' ? '@' : 
                     mention.type === 'worker' ? '&' :
                     mention.type === 'contact' ? '#' :
                     mention.type === 'company' ? '&' : 
                     mention.type === 'deal' ? '%' :
                     mention.type === 'job' ? '!' :
                     mention.type === 'candidate' ? '^' :
                     mention.type === 'location' ? '*' :
                     mention.type === 'task' ? '~' : '@';
      mentionMap.set(`${prefix}${mention.slug}`.toLowerCase(), mention);
    }
  }

  // Split text into parts: regular text and mentions
  const parts: Array<{ type: 'text' | 'mention'; content: string; mention?: Mention }> = [];
  let lastIndex = 0;
  let match;

  // Reset regex (it's global, so we need to reset it)
  MENTION_REGEX.lastIndex = 0;

  while ((match = MENTION_REGEX.exec(text)) !== null) {
    const prefix = match[1];
    const token = match[2];
    const fullMatch = match[0];
    const matchIndex = match.index;

    // Add text before the mention
    if (matchIndex > lastIndex) {
      parts.push({
        type: 'text',
        content: text.slice(lastIndex, matchIndex),
      });
    }

    // Try to find the mention in our map
    const mentionKey = fullMatch.toLowerCase();
    const mention = mentionMap.get(mentionKey);

    if (mention) {
      parts.push({
        type: 'mention',
        content: fullMatch,
        mention,
      });
    } else {
      // Mention not found, render as plain text
      parts.push({
        type: 'text',
        content: fullMatch,
      });
    }

    lastIndex = matchIndex + fullMatch.length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push({
      type: 'text',
      content: text.slice(lastIndex),
    });
  }

  // If no mentions found, just render the text
  if (parts.length === 0) {
    return (
      <Typography variant={variant} color={color} sx={sx}>
        {text}
      </Typography>
    );
  }

  return (
    <Typography variant={variant} color={color} sx={sx} component="span">
      {parts.map((part, index) => {
        if (part.type === 'mention' && part.mention) {
          const url = getMentionUrl(part.mention);
          const mentionKey = `${part.mention.type}-${part.mention.id}`;
          return (
            <React.Fragment key={index}>
              <Link
                ref={(el) => {
                  if (el) {
                    mentionRefs.current.set(mentionKey, el);
                  } else {
                    mentionRefs.current.delete(mentionKey);
                  }
                }}
                href={url}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(url);
                }}
                onMouseEnter={(e) => {
                  setHoveredMention({ mention: part.mention!, anchorEl: e.currentTarget });
                }}
                onMouseLeave={() => {
                  setHoveredMention(null);
                }}
                sx={{
                  color: '#1976d2', // Blue link color
                  textDecoration: 'none',
                  fontWeight: 500,
                  cursor: 'pointer',
                  '&:hover': {
                    textDecoration: 'underline',
                    color: '#1565c0', // Darker blue on hover
                  },
                }}
              >
                {part.content}
              </Link>
              {hoveredMention && hoveredMention.mention.id === part.mention.id && (
                <MentionHoverCard
                  mention={part.mention}
                  anchorEl={hoveredMention.anchorEl}
                  open={true}
                  onClose={() => setHoveredMention(null)}
                />
              )}
            </React.Fragment>
          );
        }
        return <span key={index}>{part.content}</span>;
      })}
    </Typography>
  );
};

