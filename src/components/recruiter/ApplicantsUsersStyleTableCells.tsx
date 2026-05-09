import React from 'react';
import { Avatar, Box, Chip, Stack, TableCell, Tooltip, Typography } from '@mui/material';
import type { BackgroundCheckRecord } from '../../types/backgroundCheck';
import type { PrescreenCategoryScoresV1 } from '../../types/prescreenCategoryScores';
import type { RecruiterUser } from '../../types/recruiterUserListRow';
import type { RecruiterUserEmploymentBreakdownContext } from '../../types/recruiterEmploymentBreakdownContext';
import FavoriteButton from '../FavoriteButton';
import RecruiterUserTableContactBlock from '../tables/RecruiterUserTableContactBlock';
import { TABLE_AVATAR_SIZE } from '../../utils/uiConstants';
import {
  getBackgroundBreakdownRows,
  getReadinessBreakdownRows,
} from '../../utils/recruiterUsersReadinessDisplay';
import type { UserListEntityOnboardingItem } from '../../utils/userListEntityEmploymentStatus';
import {
  getRecruiterUserTopConcernDetailed,
  getWorkReadinessEntityChipsDisplay,
} from '../../utils/recruiterUsersEntityWorkReadiness';
import {
  normalizeRiskProfileFromUserDoc,
  workerRiskPrimaryLine,
  workerRiskTooltipContent,
} from '../../utils/workerRiskProfileDisplay';
import type { RecruiterUserLatestInterviewPreview, RecruiterUserLatestNotePreview } from '../../hooks/useRecruiterUsersRowExtras';
import RecruiterUserAiScoreCell from './RecruiterUserAiScoreCell';
import OrderInterviewInlineAction from './OrderInterviewInlineAction';
import { workHistoryTitlesForRecruiterTableRow } from '../../utils/workHistoryJobTitles';

export interface ApplicantsUsersStyleMaps {
  entityEmploymentChipsByUser: Map<string, UserListEntityOnboardingItem[]>;
  employmentBreakdownByUserId: Map<string, RecruiterUserEmploymentBreakdownContext | null>;
  latestNoteByUserId: Map<string, RecruiterUserLatestNotePreview>;
  latestInterviewByUserId: Map<string, RecruiterUserLatestInterviewPreview | null | undefined>;
  latestBackgroundByUserId: Map<string, BackgroundCheckRecord>;
  categoryScoresByUserId: Record<string, PrescreenCategoryScoresV1 | null>;
  groupTitleLookup: Map<string, string>;
  /** Optional uid -> display name; powers the "Recruiter: <name>" line on the Person cell. */
  recruiterNameByUid?: Map<string, string>;
}

/** Table header cells for the Users-style columns (after checkbox). */
export const ApplicantsUsersStyleTableHeadCells: React.FC = () => (
  <>
    <TableCell sx={{ fontWeight: 700, bgcolor: 'grey.50', textTransform: 'uppercase', fontSize: '0.75rem', minWidth: 260, py: 1.5 }}>
      Person
    </TableCell>
    <TableCell sx={{ fontWeight: 700, bgcolor: 'grey.50', textTransform: 'uppercase', fontSize: '0.75rem', minWidth: 128, py: 1.5 }}>
      Employment
    </TableCell>
    <TableCell sx={{ fontWeight: 700, bgcolor: 'grey.50', textTransform: 'uppercase', fontSize: '0.75rem', minWidth: 120, py: 1.5 }}>
      Onboarding
    </TableCell>
    <TableCell sx={{ fontWeight: 700, bgcolor: 'grey.50', textTransform: 'uppercase', fontSize: '0.75rem', minWidth: 120, py: 1.5 }}>
      Backgrounds
    </TableCell>
    <TableCell sx={{ fontWeight: 700, bgcolor: 'grey.50', textTransform: 'uppercase', fontSize: '0.75rem', minWidth: 72, py: 1.5 }}>
      Score
    </TableCell>
    <TableCell sx={{ fontWeight: 700, bgcolor: 'grey.50', textTransform: 'uppercase', fontSize: '0.75rem', minWidth: 100, py: 1.5 }}>
      Concern
    </TableCell>
    <TableCell sx={{ fontWeight: 700, bgcolor: 'grey.50', textTransform: 'uppercase', fontSize: '0.75rem', minWidth: 140, py: 1.5 }}>
      Work history
    </TableCell>
    <TableCell sx={{ fontWeight: 700, bgcolor: 'grey.50', textTransform: 'uppercase', fontSize: '0.75rem', minWidth: 120, py: 1.5 }}>
      Last activity
    </TableCell>
  </>
);

export interface ApplicantsUsersStyleTableBodyCellsProps {
  user: RecruiterUser;
  maps: ApplicantsUsersStyleMaps;
  formatDate: (timestamp: unknown) => string;
  isFavorite: (itemId: string) => boolean;
  toggleFavorite: (itemId: string) => string[];
}

/** Body cells matching recruiter Users table row (Person → Last activity). */
export const ApplicantsUsersStyleTableBodyCells: React.FC<ApplicantsUsersStyleTableBodyCellsProps> = ({
  user,
  maps,
  formatDate,
  isFavorite,
  toggleFavorite,
}) => {
  const {
    entityEmploymentChipsByUser,
    employmentBreakdownByUserId,
    latestNoteByUserId,
    latestInterviewByUserId,
    latestBackgroundByUserId,
    categoryScoresByUserId,
    groupTitleLookup,
    recruiterNameByUid,
  } = maps;

  const notePreview = latestNoteByUserId.get(user.id);
  const latestNote =
    notePreview != null
      ? {
          content: notePreview.content,
          timestamp: notePreview.timestamp ?? undefined,
          authorName: notePreview.authorName,
        }
      : null;

  return (
    <>
      <TableCell sx={{ minWidth: 260, maxWidth: 380, verticalAlign: 'top', py: 1, px: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75, minWidth: 0 }}>
          <Avatar
            src={user.avatar}
            alt={`${user.firstName} ${user.lastName}`}
            sx={{ width: TABLE_AVATAR_SIZE, height: TABLE_AVATAR_SIZE, flexShrink: 0, mt: 0.125 }}
          >
            {user.firstName?.[0]}
          </Avatar>
          <Box sx={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.25,
                minWidth: 0,
              }}
            >
              <Typography
                variant="body2"
                sx={{ fontWeight: 600, flex: 1, minWidth: 0, fontSize: '0.8125rem', lineHeight: 1.3 }}
                noWrap
              >
                {user.firstName} {user.lastName}
              </Typography>
              <Box
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                sx={{
                  flexShrink: 0,
                  position: 'relative',
                  zIndex: 2,
                  pointerEvents: 'auto',
                  ml: 0.25,
                }}
              >
                <FavoriteButton
                  itemId={user.id}
                  favoriteType="users"
                  isFavorite={isFavorite}
                  toggleFavorite={toggleFavorite}
                  size="small"
                  tooltipText={{
                    favorited: 'Remove from favorites',
                    notFavorited: 'Add to favorites',
                  }}
                  sx={{
                    p: 0.125,
                    '& .MuiSvgIcon-root': { fontSize: 17 },
                  }}
                />
              </Box>
            </Box>
            <RecruiterUserTableContactBlock
              user={user as unknown as Record<string, unknown>}
              latestNote={latestNote}
              groupTitleLookup={groupTitleLookup}
              recruiterNameByUid={recruiterNameByUid}
              formatDate={formatDate}
            />
          </Box>
        </Box>
      </TableCell>
      <TableCell sx={{ verticalAlign: 'top', py: 1, px: 1, maxWidth: 140 }}>
        {(() => {
          const entityItems = entityEmploymentChipsByUser.get(user.id);
          const chips = getWorkReadinessEntityChipsDisplay(entityItems);
          if (chips.length === 0) {
            return null;
          }
          return (
            <Stack spacing={0.35} alignItems="flex-start">
              {chips.map((c) => {
                const chipColor =
                  c.displayState === 'active' ? 'success' : c.displayState === 'onboarding' ? 'warning' : 'error';
                const filled = c.displayState === 'active';
                return (
                  <Chip
                    key={c.key}
                    label={c.label}
                    size="small"
                    color={chipColor}
                    variant={filled ? 'filled' : 'outlined'}
                    sx={{
                      height: 22,
                      maxWidth: '100%',
                      '& .MuiChip-label': {
                        px: 0.75,
                        fontSize: '0.65rem',
                        fontWeight: 600,
                        lineHeight: 1.2,
                      },
                    }}
                  />
                );
              })}
            </Stack>
          );
        })()}
      </TableCell>
      <TableCell sx={{ verticalAlign: 'top', py: 1, px: 1, maxWidth: 280 }}>
        <Stack spacing={0.15}>
          {getReadinessBreakdownRows(
            user,
            entityEmploymentChipsByUser.get(user.id),
            {
              lastInterviewSubmitterName: latestInterviewByUserId.get(user.id)?.createdByName ?? null,
              latestAccusourceBackground: latestBackgroundByUserId.get(user.id) ?? null,
              ...(employmentBreakdownByUserId.has(user.id) && employmentBreakdownByUserId.get(user.id)
                ? { employmentBreakdown: employmentBreakdownByUserId.get(user.id)! }
                : {}),
            },
          ).map((row) => (
            <Box key={row.key} component="span" sx={{ display: 'block' }}>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ lineHeight: 1.3, fontSize: '0.65rem', fontFamily: 'inherit', display: 'block' }}
              >
                {row.text}
              </Typography>
              {row.sublines?.map((line, i) => (
                <Typography
                  key={i}
                  variant="caption"
                  color="text.secondary"
                  sx={{
                    display: 'block',
                    pl: 0.5,
                    fontSize: '0.6rem',
                    lineHeight: 1.25,
                    opacity: 0.95,
                  }}
                >
                  {line}
                </Typography>
              ))}
            </Box>
          ))}
        </Stack>
      </TableCell>
      <TableCell sx={{ verticalAlign: 'top', py: 1, px: 1, maxWidth: 260 }}>
        <Stack spacing={0.15}>
          {getBackgroundBreakdownRows(user, entityEmploymentChipsByUser.get(user.id), {
            latestAccusourceBackground: latestBackgroundByUserId.get(user.id) ?? null,
          }).map((row) => (
            <Box key={row.key} component="span" sx={{ display: 'block' }}>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ lineHeight: 1.3, fontSize: '0.65rem', fontFamily: 'inherit', display: 'block' }}
              >
                {row.text}
              </Typography>
              {row.sublines?.map((line, i) => (
                <Typography
                  key={i}
                  variant="caption"
                  color="text.secondary"
                  sx={{
                    display: 'block',
                    pl: 0.5,
                    fontSize: '0.6rem',
                    lineHeight: 1.25,
                    opacity: 0.95,
                  }}
                >
                  {line}
                </Typography>
              ))}
            </Box>
          ))}
        </Stack>
      </TableCell>
      <TableCell sx={{ verticalAlign: 'top', py: 1, px: 1 }}>
        <RecruiterUserAiScoreCell user={user} categoryScoresCurrent={categoryScoresByUserId[user.id] ?? null} />
      </TableCell>
      <TableCell sx={{ verticalAlign: 'top', py: 1, px: 1 }}>
        {(() => {
          const entityItems = entityEmploymentChipsByUser.get(user.id);
          const rp = normalizeRiskProfileFromUserDoc(user.riskProfile);
          const fromRisk = workerRiskPrimaryLine(rp);
          const concern =
            fromRisk ??
            getRecruiterUserTopConcernDetailed(user, entityItems, {
              latestAccusourceBackground: latestBackgroundByUserId.get(user.id) ?? null,
              categoryScores: categoryScoresByUserId[user.id] ?? null,
            });
          const muted = concern === 'None';
          const tip = rp?.topRisks?.length ? workerRiskTooltipContent(rp) : '';
          const body = (
            <Typography
              variant="caption"
              color={muted ? 'text.secondary' : 'text.primary'}
              sx={{ fontWeight: 400, fontSize: '0.65rem', lineHeight: 1.3, fontFamily: 'inherit', display: 'block' }}
            >
              {concern}
            </Typography>
          );
          const concernNode = tip ? (
            <Tooltip title={<span style={{ whiteSpace: 'pre-wrap' }}>{tip}</span>} placement="top" enterDelay={350}>
              {body}
            </Tooltip>
          ) : (
            body
          );
          return (
            <>
              {concernNode}
              <OrderInterviewInlineAction user={user} />
            </>
          );
        })()}
      </TableCell>
      <TableCell sx={{ verticalAlign: 'top', py: 1, px: 1, maxWidth: 200 }}>
        <WorkHistoryJobTitlesCell user={user as unknown as Record<string, unknown>} />
      </TableCell>
      <TableCell sx={{ minWidth: 120, verticalAlign: 'top', py: 1, px: 1 }}>
        <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8125rem', lineHeight: 1.3 }}>
          {formatDate(user.lastLoginAt)}
        </Typography>
      </TableCell>
    </>
  );
};

export function WorkHistoryJobTitlesCell({ user }: { user: Record<string, unknown> }) {
  const titles = workHistoryTitlesForRecruiterTableRow(user);
  if (titles.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8125rem', lineHeight: 1.3 }}>
        —
      </Typography>
    );
  }
  return (
    <Stack spacing={0.25}>
      {titles.map((t, i) => (
        <Typography
          key={`${i}-${t}`}
          variant="caption"
          color="text.secondary"
          sx={{ fontSize: '0.65rem', lineHeight: 1.25, display: 'block' }}
        >
          {t}
        </Typography>
      ))}
    </Stack>
  );
}
