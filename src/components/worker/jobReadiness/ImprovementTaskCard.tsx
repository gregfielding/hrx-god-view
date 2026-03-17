/**
 * Single improvement task card for the Job Readiness feed.
 * Renders certification (Yes/No/Upload), education (dropdown), or background check (Yes/No).
 */

import React, { useState } from 'react';
import { Card, CardContent, Typography, Button, MenuItem, Select, FormControl, Stack } from '@mui/material';
import { useT } from '../../../i18n';
import type { ImprovementTask } from '../../../utils/jobReadinessTasks';

const CARD_BG = '#E8F5E9';
const CARD_CONTRAST = '#1B5E20';
const ANSWER_COMMIT_DELAY_MS = 140;

export interface ImprovementTaskCardProps {
  task: ImprovementTask;
  onComplete: (taskId: string, value?: string) => void;
  onSkip: (taskId: string) => void;
  onTap: () => void;
}

const ImprovementTaskCard: React.FC<ImprovementTaskCardProps> = ({
  task,
  onComplete,
  onSkip,
  onTap,
}) => {
  const t = useT();
  const [dropdownValue, setDropdownValue] = useState<string>('');
  const [selectedAction, setSelectedAction] = useState<string | null>(null);

  const title = t(task.titleKey);
  const body = task.bodyKey ? t(task.bodyKey) : undefined;
  const question = t(task.questionKey);
  const isAnswered = selectedAction !== null;

  const commitAnswer = (value: string, commit: () => void) => {
    setSelectedAction(value);
    window.setTimeout(() => {
      commit();
    }, ANSWER_COMMIT_DELAY_MS);
  };

  const handleYes = (e: React.MouseEvent) => {
    e.stopPropagation();
    commitAnswer('yes', () => onComplete(task.id, 'yes'));
  };
  const handleNo = (e: React.MouseEvent) => {
    e.stopPropagation();
    commitAnswer('no', () => onComplete(task.id, 'no'));
  };
  const handleUpload = (e: React.MouseEvent) => {
    e.stopPropagation();
    commitAnswer('upload', () => onComplete(task.id, 'upload'));
  };
  const handleSkip = (e: React.MouseEvent) => {
    e.stopPropagation();
    commitAnswer('skip', () => onSkip(task.id));
  };
  const handleDropdownChange = (e: { target: { value: string } }) => {
    const v = e.target.value;
    setDropdownValue(v);
    if (v) onComplete(task.id, v);
  };
  const handleCardClick = (e: React.MouseEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('button, [role="button"], input, select, textarea, .MuiSelect-root')) {
      return;
    }
    onTap();
  };

  return (
    <Card
      variant="outlined"
      onClick={handleCardClick}
      sx={{
        width: '100%',
        minHeight: 280,
        borderRadius: '16px',
        border: 'none',
        boxShadow: 2,
        backgroundColor: CARD_BG,
        color: CARD_CONTRAST,
        cursor: 'pointer',
      }}
    >
      <CardContent sx={{ p: 2.5, height: '100%', display: 'flex', flexDirection: 'column' }}>
        <Typography variant="h6" sx={{ fontWeight: 600, color: CARD_CONTRAST, fontSize: '1rem' }}>
          {title}
        </Typography>
        {body && (
          <Typography variant="body2" sx={{ color: CARD_CONTRAST, opacity: 0.9, mt: 0.5 }}>
            {body}
          </Typography>
        )}
        <Typography variant="body2" sx={{ color: CARD_CONTRAST, fontWeight: 600, mt: 1.5 }}>
          {question}
        </Typography>

        {task.actionType === 'yes_no_upload' && (
          <Stack direction="row" spacing={1} sx={{ mt: 2 }} useFlexGap flexWrap="wrap">
            <Button
              variant={selectedAction === 'yes' ? 'contained' : 'outlined'}
              size="small"
              onClick={handleYes}
              disabled={isAnswered}
              sx={{
                bgcolor: selectedAction === 'yes' ? CARD_CONTRAST : undefined,
                color: selectedAction === 'yes' ? CARD_BG : CARD_CONTRAST,
                borderColor: CARD_CONTRAST,
              }}
            >
              {t('jobReadiness.yes')}
            </Button>
            <Button
              variant={selectedAction === 'no' ? 'contained' : 'outlined'}
              size="small"
              onClick={handleNo}
              disabled={isAnswered}
              sx={{
                bgcolor: selectedAction === 'no' ? CARD_CONTRAST : undefined,
                color: selectedAction === 'no' ? CARD_BG : CARD_CONTRAST,
                borderColor: CARD_CONTRAST,
              }}
            >
              {t('jobReadiness.no')}
            </Button>
            <Button
              variant={selectedAction === 'upload' ? 'contained' : 'outlined'}
              size="small"
              onClick={handleUpload}
              disabled={isAnswered}
              sx={{
                bgcolor: selectedAction === 'upload' ? CARD_CONTRAST : undefined,
                color: selectedAction === 'upload' ? CARD_BG : CARD_CONTRAST,
                borderColor: CARD_CONTRAST,
              }}
            >
              {t('jobReadiness.uploadCertificate')}
            </Button>
          </Stack>
        )}

        {task.actionType === 'yes_no' && (
          <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
            <Button
              variant={selectedAction === 'yes' ? 'contained' : 'outlined'}
              size="small"
              onClick={handleYes}
              disabled={isAnswered}
              sx={{
                bgcolor: selectedAction === 'yes' ? CARD_CONTRAST : undefined,
                color: selectedAction === 'yes' ? CARD_BG : CARD_CONTRAST,
                borderColor: CARD_CONTRAST,
              }}
            >
              {t('jobReadiness.yes')}
            </Button>
            <Button
              variant={selectedAction === 'no' ? 'contained' : 'outlined'}
              size="small"
              onClick={handleNo}
              disabled={isAnswered}
              sx={{
                bgcolor: selectedAction === 'no' ? CARD_CONTRAST : undefined,
                color: selectedAction === 'no' ? CARD_BG : CARD_CONTRAST,
                borderColor: CARD_CONTRAST,
              }}
            >
              {t('jobReadiness.no')}
            </Button>
          </Stack>
        )}

        {task.actionType === 'dropdown' && task.options && (
          <FormControl fullWidth size="small" sx={{ mt: 2 }}>
            <Select
              value={dropdownValue}
              onChange={handleDropdownChange}
              displayEmpty
              sx={{
                bgcolor: 'white',
                borderRadius: 2,
                '& .MuiSelect-select': { py: 1.25 },
              }}
            >
              <MenuItem value="">
                <em>{t('jobReadiness.selectEducation')}</em>
              </MenuItem>
              {task.options.map((opt) => (
                <MenuItem key={opt.value} value={opt.value}>
                  {t(opt.labelKey)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )}

        <Button
          variant="text"
          size="small"
          onClick={handleSkip}
          disabled={isAnswered}
          sx={{
            mt: 2,
            alignSelf: 'flex-start',
            color: selectedAction === 'skip' ? CARD_CONTRAST : CARD_CONTRAST,
            opacity: selectedAction === 'skip' ? 1 : 0.8,
            fontWeight: selectedAction === 'skip' ? 700 : 500,
          }}
        >
          {t('cardDeck.skip')}
        </Button>
      </CardContent>
    </Card>
  );
};

export default ImprovementTaskCard;
