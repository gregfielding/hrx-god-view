/**
 * Worker Profile Card Deck — one section card at a time with Previous / Next / Expand (Edit).
 * Replaces accordion-heavy layout with a card deck; Expand opens that section for editing.
 */

import React from 'react';

import { Card, CardContent, Typography } from '@mui/material';

import CardDeck from '../cards/CardDeck';
import { CARD_THEMES } from '../dashboard/cards/types';
import { useT } from '../../../i18n';
import type { ReadinessAccordionSection } from './WorkerProfileAccordions';

export interface ProfileSectionSpec {
  id: ReadinessAccordionSection;
  titleKey: string;
  summaryKey?: string;
}

const PROFILE_SECTIONS: ProfileSectionSpec[] = [
  { id: 'work-preferences', titleKey: 'profile.jobPreferences', summaryKey: 'profile.jobPreferencesSubtext' },
  { id: 'skills-experience', titleKey: 'profile.skillsLanguages', summaryKey: 'profile.skillsLanguagesSubtext' },
  { id: 'certifications-documents', titleKey: 'profile.certifications', summaryKey: 'profile.certificationsSubtext' },
];

export interface WorkerProfileCardDeckProps {
  /** Current 0-based section index */
  activeIndex: number;
  onIndexChange: (index: number) => void;
  /** Expand / Edit this section (e.g. scroll to accordion and expand) */
  onExpandSection: (sectionId: ReadinessAccordionSection) => void;
}

const WorkerProfileCardDeck: React.FC<WorkerProfileCardDeckProps> = ({
  activeIndex,
  onIndexChange,
  onExpandSection,
}) => {
  const t = useT();
  const sections = PROFILE_SECTIONS;
  const { bg, contrast } = CARD_THEMES.profile;
  const current = sections[activeIndex];

  return (
    <CardDeck
      totalCards={sections.length}
      activeIndex={activeIndex}
      onIndexChange={onIndexChange}
      onExpand={() => current && onExpandSection(current.id)}
      showSectionProgress
      sectionLabel={t('cardDeck.section')}
      expandDisabled={!current}
      ariaLabel={t('profile.pageTitle')}
    >
      {current && (
        <Card
          variant="outlined"
          sx={{
            width: '100%',
            minHeight: 220,
            borderRadius: 3,
            border: 'none',
            boxShadow: 2,
            backgroundColor: bg,
            color: contrast,
          }}
        >
          <CardContent sx={{ p: 2.5 }}>
            <Typography variant="overline" sx={{ color: contrast, opacity: 0.9, fontWeight: 600 }}>
              {t('cardDeck.section')} {activeIndex + 1} {t('cardDeck.of')} {sections.length}
            </Typography>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, color: contrast, mt: 0.5 }}>
              {t(current.titleKey)}
            </Typography>
            {current.summaryKey && (
              <Typography variant="body2" sx={{ color: contrast, opacity: 0.9, mt: 1 }}>
                {t(current.summaryKey)}
              </Typography>
            )}
            <Typography variant="body2" sx={{ color: contrast, opacity: 0.8, mt: 2 }}>
              {t('cardDeck.expand')} → {t('apply.edit')}
            </Typography>
          </CardContent>
        </Card>
      )}
    </CardDeck>
  );
};

export default WorkerProfileCardDeck;
