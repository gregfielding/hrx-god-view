/**
 * MentionTextField Component
 * 
 * A TextField wrapper that supports @mention autocomplete.
 */

import React, { useState, useRef, useEffect } from 'react';
import { TextField, TextFieldProps } from '@mui/material';
import { useMentionAutocomplete } from '../hooks/useMentionAutocomplete';
import { MentionOption } from '../types/mentions';
import { MentionSuggestionsPopover } from './MentionSuggestionsPopover';

interface MentionTextFieldProps
  extends Omit<TextFieldProps, 'onChange' | 'value'> {
  value: string;
  onChange: (value: string) => void;
}

export const MentionTextField: React.FC<MentionTextFieldProps> = ({
  value,
  onChange,
  ...rest
}) => {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [triggerIndex, setTriggerIndex] = useState<number | null>(null);
  const [currentToken, setCurrentToken] = useState('');
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const { options, loading, setQuery, selectOption } = useMentionAutocomplete();

  // Set up select callback
  useEffect(() => {
    const handleSelect = (opt: MentionOption) => {
      if (triggerIndex == null || !inputRef.current) return;

      // Get current selection/caret position
      const input = inputRef.current;
      const isTextarea = input.tagName === 'TEXTAREA';
      const textarea = isTextarea ? (input as HTMLTextAreaElement) : null;
      const textInput = !isTextarea ? (input as HTMLInputElement) : null;

      // Get caret position
      let caret = value.length;
      if (textarea) {
        caret = textarea.selectionStart ?? value.length;
      } else if (textInput) {
        caret = textInput.selectionStart ?? value.length;
      }

      // Replace "@partial" with internal token
      const before = value.slice(0, triggerIndex);
      const after = value.slice(caret);

      // Find where the current token ends
      const tokenEndMatch = value.slice(triggerIndex).match(/^@([a-zA-Z0-9_.-]*)/);
      const tokenEnd = tokenEndMatch
        ? triggerIndex + tokenEndMatch[0].length
        : caret;

      const afterToken = value.slice(tokenEnd);
      const token = `[@uid:${opt.id}]`;
      const next = `${before}${token} ${afterToken}`;

      onChange(next);

      // Reset state
      setTriggerIndex(null);
      setAnchorEl(null);
      setQuery('');

      // Set caret position after the inserted token
      setTimeout(() => {
        const newCaret = before.length + token.length + 1;
        if (textarea) {
          textarea.setSelectionRange(newCaret, newCaret);
          textarea.focus();
        } else if (textInput) {
          textInput.setSelectionRange(newCaret, newCaret);
          textInput.focus();
        }
      }, 0);
    };

    (selectOption as any).setCallback?.(handleSelect);
  }, [value, triggerIndex, onChange, selectOption, setQuery]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const text = e.target.value;
    onChange(text);

    // Get caret position
    const caret = e.target.selectionStart ?? text.length;
    const slice = text.slice(0, caret);

    // Match @mention pattern: @ followed by optional username characters
    // Must be at start of string or after whitespace
    const match = /(^|\s)@([a-zA-Z0-9_.-]*)$/.exec(slice);

    if (match) {
      const prefix = match[2] ?? '';
      const triggerPos = match.index! + match[1].length;
      setTriggerIndex(triggerPos);
      setCurrentToken(prefix);
      setQuery(prefix);
      setAnchorEl(e.target);
    } else {
      setTriggerIndex(null);
      setAnchorEl(null);
      setQuery('');
    }
  };

  const handleSelect = (opt: MentionOption) => {
    selectOption(opt);
  };

  return (
    <>
      <TextField
        {...rest}
        value={value}
        onChange={handleChange}
        inputRef={inputRef}
        multiline
      />
      <MentionSuggestionsPopover
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        loading={loading}
        options={options}
        onSelect={handleSelect}
      />
    </>
  );
};

