/**
 * RichTextInputWithMentions Component
 * 
 * A TextField wrapper that supports @user, #contact, &company, %deal mention autocomplete.
 * Emits both raw text and structured mention metadata.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { TextField, TextFieldProps } from '@mui/material';
import { useMentionSearch } from '../../hooks/useMentionSearch';
import type { MentionableEntity, MentionPrefix } from '../../types/crossSystemMentions';
import { MENTION_PREFIX_MAP } from '../../types/crossSystemMentions';
import { Popover, List, ListItem, ListItemText, ListItemAvatar, Avatar, CircularProgress, Box, Typography } from '@mui/material';

export interface RichTextValue {
  text: string;
  mentions: Array<{
    type: 'user' | 'contact' | 'company' | 'deal' | 'job' | 'candidate' | 'location' | 'task';
    id: string;
    label: string;
    slug?: string;
  }>;
}

interface RichTextInputWithMentionsProps extends Omit<TextFieldProps, 'onChange' | 'value'> {
  value: string;
  onChange: (value: RichTextValue) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

/**
 * Regex to match mention triggers: @/#/&/% followed by optional characters
 * Must be at start of string or after whitespace
 */
const MENTION_TRIGGER_REGEX = /(^|\s)([@#&%])([a-zA-Z0-9_.-]*)$/;

export const RichTextInputWithMentions: React.FC<RichTextInputWithMentionsProps> = ({
  value,
  onChange,
  placeholder = 'Type @ for users, # for contacts, & for companies, % for deals...',
  autoFocus = false,
  ...rest
}) => {
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [triggerIndex, setTriggerIndex] = useState<number | null>(null);
  const [currentPrefix, setCurrentPrefix] = useState<MentionPrefix | null>(null);
  const [currentQuery, setCurrentQuery] = useState('');
  const [suggestions, setSuggestions] = useState<MentionableEntity[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const { searchUsers, searchContacts, searchCompanies, searchDeals } = useMentionSearch();

  // Debounced search function
  const performSearch = useCallback(async (prefix: MentionPrefix, query: string) => {
    if (!query || query.trim().length === 0) {
      setSuggestions([]);
      return;
    }

    setLoading(true);
    try {
      let results: MentionableEntity[] = [];
      
      switch (prefix) {
        case '@':
          results = await searchUsers(query, 10);
          break;
        case '#':
          results = await searchContacts(query, 10);
          break;
        case '&':
          results = await searchCompanies(query, 10);
          break;
        case '%':
          results = await searchDeals(query, 10);
          break;
      }
      
      setSuggestions(results);
      setSelectedIndex(0);
    } catch (error) {
      console.error('Error searching mentions:', error);
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, [searchUsers, searchContacts, searchCompanies, searchDeals]);

  // Debounce search
  useEffect(() => {
    if (!currentPrefix || !currentQuery) {
      setSuggestions([]);
      return;
    }

    const timer = setTimeout(() => {
      performSearch(currentPrefix, currentQuery);
    }, 300);

    return () => clearTimeout(timer);
  }, [currentPrefix, currentQuery, performSearch]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const text = e.target.value;
    const caret = e.target.selectionStart ?? text.length;
    const slice = text.slice(0, caret);

    // Check for mention trigger
    const match = MENTION_TRIGGER_REGEX.exec(slice);

    if (match) {
      const prefix = match[2] as MentionPrefix;
      const query = match[3] || '';
      const triggerPos = match.index! + match[1].length;

      setCurrentPrefix(prefix);
      setCurrentQuery(query);
      setTriggerIndex(triggerPos);
      setAnchorEl(e.target);
    } else {
      setCurrentPrefix(null);
      setCurrentQuery('');
      setTriggerIndex(null);
      setAnchorEl(null);
      setSuggestions([]);
    }

    // Emit current value (mentions will be parsed on submit)
    onChange({
      text,
      mentions: [], // Will be parsed on submit/blur
    });
  }, [onChange]);

  const handleSelect = useCallback((entity: MentionableEntity) => {
    if (triggerIndex == null || !inputRef.current || !currentPrefix) return;

    const input = inputRef.current;
    const isTextarea = input.tagName === 'TEXTAREA';
    const textarea = isTextarea ? (input as HTMLTextAreaElement) : null;
    const textInput = !isTextarea ? (input as HTMLInputElement) : null;

    const caret = isTextarea 
      ? (textarea?.selectionStart ?? value.length)
      : (textInput?.selectionStart ?? value.length);

    // Find where the current mention token ends
    const afterTrigger = value.slice(triggerIndex);
    const tokenEndMatch = afterTrigger.match(new RegExp(`^\\${currentPrefix}([a-zA-Z0-9_.-]*)`));
    const tokenEnd = tokenEndMatch
      ? triggerIndex + tokenEndMatch[0].length
      : caret;

    const before = value.slice(0, triggerIndex);
    const after = value.slice(tokenEnd);

    // Insert mention as plain text (e.g., "@Donna Persson" or "#Bob Smith")
    const mentionText = `${currentPrefix}${entity.label}`;
    const newText = `${before}${mentionText} ${after}`;

    // Build mention object
    const mention = {
      type: MENTION_PREFIX_MAP[currentPrefix],
      id: entity.id,
      label: entity.label,
      slug: entity.slug,
    };

    // Emit new value with mention
    onChange({
      text: newText,
      mentions: [mention],
    });

    // Reset state
    setTriggerIndex(null);
    setAnchorEl(null);
    setCurrentPrefix(null);
    setCurrentQuery('');
    setSuggestions([]);

    // Set caret position after the inserted mention
    setTimeout(() => {
      const newCaret = before.length + mentionText.length + 1; // +1 for space
      if (textarea) {
        textarea.setSelectionRange(newCaret, newCaret);
        textarea.focus();
      } else if (textInput) {
        textInput.setSelectionRange(newCaret, newCaret);
        textInput.focus();
      }
    }, 0);
  }, [value, onChange, triggerIndex, currentPrefix]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!anchorEl || suggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev < suggestions.length - 1 ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev > 0 ? prev - 1 : 0));
    } else if (e.key === 'Enter' && suggestions.length > 0) {
      e.preventDefault();
      handleSelect(suggestions[selectedIndex]);
    } else if (e.key === 'Escape') {
      setAnchorEl(null);
      setSuggestions([]);
    }
  }, [anchorEl, suggestions, selectedIndex, handleSelect]);

  return (
    <>
      <TextField
        {...rest}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        inputRef={inputRef}
        placeholder={placeholder}
        autoFocus={autoFocus}
        multiline
      />
      <Popover
        open={Boolean(anchorEl && suggestions.length > 0)}
        anchorEl={anchorEl}
        onClose={() => {
          setAnchorEl(null);
          setSuggestions([]);
        }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{
          paper: {
            sx: {
              mt: 1,
              borderRadius: 2,
              boxShadow: '0px 4px 20px rgba(0, 0, 0, 0.1)',
              maxWidth: 320,
            },
          },
        }}
      >
        <List dense sx={{ maxHeight: 280, overflowY: 'auto', p: 1 }}>
          {loading && (
            <ListItem>
              <Box display="flex" justifyContent="center" width="100%" py={1}>
                <CircularProgress size={24} />
              </Box>
            </ListItem>
          )}
          {!loading && suggestions.length === 0 && currentQuery && (
            <ListItem>
              <ListItemText 
                primary="No matches found" 
                primaryTypographyProps={{ color: 'text.secondary', fontSize: '0.875rem' }}
              />
            </ListItem>
          )}
          {!loading && suggestions.map((entity, index) => (
            <ListItem
              key={`${entity.type}-${entity.id}`}
              button
              selected={index === selectedIndex}
              onClick={() => handleSelect(entity)}
              sx={{
                borderRadius: 1,
                '&:hover': { bgcolor: 'action.hover' },
                '&.Mui-selected': { bgcolor: 'action.selected' },
              }}
            >
              <ListItemAvatar>
                <Avatar src={entity.avatarUrl} sx={{ width: 32, height: 32 }}>
                  {entity.label[0]?.toUpperCase() || ''}
                </Avatar>
              </ListItemAvatar>
              <ListItemText
                primary={
                  <Box>
                    <Typography variant="body2" fontWeight={600}>
                      {entity.label}
                    </Typography>
                    {entity.subtitle && (
                      <Typography variant="caption" color="text.secondary">
                        {entity.subtitle}
                      </Typography>
                    )}
                  </Box>
                }
                secondary={
                  <Typography variant="caption" color="text.secondary">
                    {entity.type === 'user' ? 'User' :
                     entity.type === 'contact' ? 'Contact' :
                     entity.type === 'company' ? 'Company' : 'Deal'}
                  </Typography>
                }
              />
            </ListItem>
          ))}
        </List>
      </Popover>
    </>
  );
};

