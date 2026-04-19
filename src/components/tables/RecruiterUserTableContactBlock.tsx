/**
 * Shared contact + signal strip for recruiter Users / group members tables.
 * Matches record header patterns: copy beside email & phone, language + transport icons with resume/skills.
 * Indeed Flex renders on its own line below group membership.
 */
import React from 'react';
import { Box, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import BuildOutlinedIcon from '@mui/icons-material/BuildOutlined';
import StickyNote2OutlinedIcon from '@mui/icons-material/StickyNote2Outlined';
import UserTableResumeIcon from './UserTableResumeIcon';
import UserTableIndeedFlexBadge from './UserTableIndeedFlexBadge';
import { pickResumeFromUserDoc } from '../../utils/userResumeOpen';
import { formatPhoneNumber } from '../../utils/formatPhone';
import RecordHeaderLanguagePreferenceBadge from '../../pages/UserProfile/components/RecordHeaderLanguagePreferenceBadge';
import RecordHeaderTransportMethodIcon from '../../pages/UserProfile/components/RecordHeaderTransportMethodIcon';
import { recordHeaderTooltipComponentsProps } from '../../pages/UserProfile/components/recordHeaderStyles';
import { PhoneVerifiedInlineCheck } from '../PhoneVerifiedInlineCheck';

const copyIconButtonSx = {
  p: 0.125,
  ml: 0.125,
  flexShrink: 0,
  color: 'text.secondary',
  minWidth: 18,
  width: 18,
  height: 18,
  borderRadius: 0.75,
  '&:hover': { color: 'primary.main', bgcolor: 'action.hover' },
} as const;

const copyIconGlyphSx = { fontSize: 11 } as const;

/** Tighter than default caption line boxes — keeps phone / joined / groups visually compact in table Person column. */
const tightCaptionSx = { lineHeight: 1.2, fontSize: '0.7rem' } as const;

const compactSignalScaleSx = {
  display: 'inline-flex',
  alignItems: 'center',
  verticalAlign: 'middle',
  lineHeight: 0,
  transform: 'scale(0.9)',
  transformOrigin: 'left center',
} as const;

export type RecruiterUserTableLatestNote = {
  content: string;
  timestamp?: Date;
  authorName?: string;
} | null;

export type RecruiterUserTableContactBlockProps = {
  user: Record<string, unknown> & {
    id?: string;
    email?: string;
    phone?: string;
    phoneE164?: string;
    city?: string;
    state?: string;
    address?: { city?: string; state?: string };
    createdAt?: unknown;
    skills?: unknown;
    userGroupIds?: string[];
    preferredLanguage?: string;
    transportMethod?: string;
    phoneVerified?: boolean;
  };
  latestNote: RecruiterUserTableLatestNote;
  groupTitleLookup: Map<string, string>;
  formatDate: (d: unknown) => string;
};

const RecruiterUserTableContactBlock: React.FC<RecruiterUserTableContactBlockProps> = ({
  user,
  latestNote,
  groupTitleLookup,
  formatDate,
}) => {
  const userGroupIds = Array.isArray(user.userGroupIds) ? user.userGroupIds : [];
  const emailRaw = typeof user.email === 'string' ? user.email.trim() : '';
  const phoneRaw = user.phone || user.phoneE164;
  const phoneDisplay = phoneRaw ? formatPhoneNumber(String(phoneRaw)) : '';
  const phoneVerified = user.phoneVerified === true;

  const handleCopy = async (text: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  };

  const hasResume = Boolean(pickResumeFromUserDoc(user as Record<string, unknown>));
  const skillsArr = Array.isArray(user.skills) ? user.skills : [];
  const hasSkills = skillsArr.length > 0;
  const hasNote = Boolean(latestNote?.content);
  const preferredLanguage: 'en' | 'es' = user.preferredLanguage === 'es' ? 'es' : 'en';
  const transportMethod = user.transportMethod as string | null | undefined;

  const noteMeta = [latestNote?.timestamp?.toLocaleString(), latestNote?.authorName].filter(Boolean).join(' · ');

  return (
    <Stack spacing={0.125} alignItems="stretch" sx={{ width: '100%' }}>
      {emailRaw ? (
        <Stack
          direction="row"
          alignItems="center"
          spacing={0}
          sx={{ alignSelf: 'flex-start', minWidth: 0, maxWidth: '100%', gap: 0.25 }}
        >
          <Typography variant="caption" color="text.secondary" noWrap display="block" sx={{ ...tightCaptionSx, minWidth: 0 }}>
            {emailRaw}
          </Typography>
          <Tooltip title="Copy email" arrow placement="top" componentsProps={recordHeaderTooltipComponentsProps}>
            <IconButton
              size="small"
              aria-label="Copy email"
              onClick={(e) => void handleCopy(emailRaw, e)}
              sx={copyIconButtonSx}
            >
              <ContentCopyIcon sx={copyIconGlyphSx} />
            </IconButton>
          </Tooltip>
        </Stack>
      ) : (
        <Typography variant="caption" color="text.secondary" noWrap display="block" sx={tightCaptionSx}>
          —
        </Typography>
      )}

      {(user.city || user.state || (user.address && (user.address as { city?: string }).city)) && (
        <Typography variant="caption" color="text.secondary" display="block" sx={tightCaptionSx}>
          {[user.city ?? (user.address as { city?: string })?.city, user.state ?? (user.address as { state?: string })?.state]
            .filter(Boolean)
            .join(', ')}
        </Typography>
      )}

      {phoneRaw ? (
        <Stack
          direction="row"
          alignItems="center"
          spacing={0}
          sx={{ alignSelf: 'flex-start', minWidth: 0, maxWidth: '100%', gap: 0.25 }}
        >
          <Typography variant="caption" color="text.secondary" display="block" sx={{ ...tightCaptionSx, minWidth: 0 }}>
            {phoneDisplay}
          </Typography>
          <PhoneVerifiedInlineCheck verified={phoneVerified} />
          <Tooltip title="Copy phone number" arrow placement="top" componentsProps={recordHeaderTooltipComponentsProps}>
            <IconButton
              size="small"
              aria-label="Copy phone number"
              onClick={(e) => void handleCopy(phoneDisplay, e)}
              sx={copyIconButtonSx}
            >
              <ContentCopyIcon sx={copyIconGlyphSx} />
            </IconButton>
          </Tooltip>
        </Stack>
      ) : null}

      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.35, rowGap: 0.125 }}>
        {user.createdAt && (
          <Typography variant="caption" color="text.secondary" component="span" sx={tightCaptionSx}>
            Joined {formatDate(user.createdAt)}
          </Typography>
        )}
        <Box
          component="span"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, flexWrap: 'wrap' }}
        >
          {hasResume && <UserTableResumeIcon user={user as Record<string, unknown>} />}
          {hasSkills && (
            <Tooltip
              title={
                <Box sx={{ py: 0.25, maxWidth: 320 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
                    Skills
                  </Typography>
                  {skillsArr.map((s: string) => (
                    <Typography key={s} variant="body2" sx={{ display: 'block' }}>
                      {s}
                    </Typography>
                  ))}
                </Box>
              }
              placement="top"
              enterDelay={400}
            >
              <Box
                component="span"
                sx={{ display: 'inline-flex', alignItems: 'center', color: 'text.secondary', cursor: 'default', verticalAlign: 'middle' }}
              >
                <BuildOutlinedIcon sx={{ fontSize: 12, opacity: 0.72 }} />
              </Box>
            </Tooltip>
          )}
          {hasNote && latestNote && (
            <Tooltip
              title={
                <Box sx={{ py: 0.25, maxWidth: 320 }}>
                  {noteMeta ? (
                    <Typography variant="caption" color="inherit" sx={{ display: 'block', mb: 0.5 }}>
                      {noteMeta}
                    </Typography>
                  ) : null}
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                    {latestNote.content}
                  </Typography>
                </Box>
              }
              placement="top"
              enterDelay={400}
            >
              <Box
                component="span"
                sx={{ display: 'inline-flex', alignItems: 'center', color: 'text.secondary', cursor: 'default', verticalAlign: 'middle' }}
              >
                <StickyNote2OutlinedIcon sx={{ fontSize: 12, opacity: 0.72 }} />
              </Box>
            </Tooltip>
          )}
          <Box sx={compactSignalScaleSx}>
            <RecordHeaderLanguagePreferenceBadge language={preferredLanguage} />
          </Box>
          <Box sx={compactSignalScaleSx}>
            <RecordHeaderTransportMethodIcon transportMethod={transportMethod} />
          </Box>
        </Box>
      </Box>

      {userGroupIds.length > 0 && (
        <Tooltip
          title={
            userGroupIds.length <= 1 ? (
              groupTitleLookup.get(userGroupIds[0]) || userGroupIds[0]
            ) : (
              <Box component="span" sx={{ display: 'block', maxHeight: 320, overflowY: 'auto', py: 0.5 }}>
                {userGroupIds.map((id) => (
                  <Typography key={id} component="span" variant="body2" sx={{ display: 'block' }}>
                    {groupTitleLookup.get(id) || id}
                  </Typography>
                ))}
              </Box>
            )
          }
          placement="top"
          enterDelay={300}
        >
          <Typography
            variant="caption"
            color="text.secondary"
            noWrap
            onClick={(e) => e.stopPropagation()}
            sx={{ display: 'block', ...tightCaptionSx, cursor: 'default' }}
          >
            {groupTitleLookup.get(userGroupIds[0]) || userGroupIds[0]}
            {userGroupIds.length > 1 ? ` +${userGroupIds.length - 1}` : ''}
          </Typography>
        </Tooltip>
      )}

      <Box
        component="span"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        sx={{ display: 'block' }}
      >
        <UserTableIndeedFlexBadge user={user as Record<string, unknown>} compact />
      </Box>
    </Stack>
  );
};

export default RecruiterUserTableContactBlock;
