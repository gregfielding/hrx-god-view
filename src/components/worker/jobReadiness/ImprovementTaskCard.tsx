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

  const title = t(task.titleKey);
  const body = task.bodyKey ? t(task.bodyKey) : undefined;
  const question = t(task.questionKey);

  const handleYes = (e: React.MouseEvent) => {
    e.stopPropagation();
    onComplete(task.id, 'yes');
  };
  const handleNo = (e: React.MouseEvent) => {
    e.stopPropagation();
    onComplete(task.id, 'no');
  };
  const handleUpload = (e: React.MouseEvent) => {
    e.stopPropagation();
    onComplete(task.id, 'upload');
  };
  const handleSkip = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSkip(task.id);
  };
  const handleDropdownChange = (e: { target: { value: string } }) => {
    const v = e.target.value;
    setDropdownValue(v);
    if (v) onComplete(task.id, v);
  };

  return (
    <Card
      variant="outlined"
      onClick={onTap}
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
              variant="contained"
              size="small"
              onClick={handleYes}
              sx={{ bgcolor: CARD_CONTRAST, color: CARD_BG }}
              onClickCapture={(e) => e.stopPropagation()}
            >
              {t('jobReadiness.yes')}
            </Button>
            <Button
              variant="outlined"
              size="small"
              onClick={handleNo}
              sx={{ borderColor: CARD_CONTRAST, color: CARD_CONTRAST }}
              onClickCapture={(e) => e.stopPropagation()}
            >
              {t('jobReadiness.no')}
            </Button>
            <Button
              variant="outlined"
              size="small"
              onClick={handleUpload}
              sx={{ borderColor: CARD_CONTRAST, color: CARD_CONTRAST }}
              onClickCapture={(e) => e.stopPropagation()}
            >
              {t('jobReadiness.uploadCertificate')}
            </Button>
          </Stack>
        )}

        {task.actionType === 'yes_no' && (
          <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
            <Button
              variant="contained"
              size="small"
              onClick={handleYes}
              sx={{ bgcolor: CARD_CONTRAST, color: CARD_BG }}
              onClickCapture={(e) => e.stopPropagation()}
            >
              {t('jobReadiness.yes')}
            </Button>
            <Button
              variant="outlined"
              size="small"
              onClick={handleNo}
              sx={{ borderColor: CARD_CONTRAST, color: CARD_CONTRAST }}
              onClickCapture={(e) => e.stopPropagation()}
            >
              {t('jobReadiness.no')}
            </Button>
          </Stack>
        )}

        {task.actionType === 'dropdown' && task.options && (
          <FormControl fullWidth size="small" sx={{ mt: 2 }} onClick={(e) => e.stopPropagation()}>
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
          sx={{ mt: 2, alignSelf: 'flex-start', color: CARD_CONTRAST, opacity: 0.8 }}
          onClickCapture={(e) => e.stopPropagation()}
        >
          {t('cardDeck.skip')}
        </Button>
      </CardContent>
    </Card>
  );
};

export default ImprovementTaskCard;
