import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { doc, onSnapshot, serverTimestamp, updateDoc } from 'firebase/firestore';

import { db } from '../../../firebase';
import { useT } from '../../../i18n';
import onetSkillsData from '../../../data/onetSkills.json';

type OnetRow = { name: string; category: string };
const onetSkills = onetSkillsData as OnetRow[];

const INITIAL_VISIBLE = 9;

const COMMON_SUGGESTIONS = [
  'Communication',
  'Teamwork',
  'Leadership',
  'Customer Service',
  'Problem Solving',
  'Time Management',
  'Sales',
  'Microsoft Excel',
  'Scheduling',
  'Data Entry',
  'Inventory',
  'Attention to Detail',
  'Organizational Skills',
];

export type WorkerSkillRow = {
  name: string;
  canonicalId?: string;
  source: 'predefined' | 'custom';
  type: string;
  confidence?: number;
};

function skillKey(name: string): string {
  return name.trim().toLowerCase();
}

function capitalizeWords(s: string): string {
  return s
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function parseSkillsFromFirestore(raw: unknown): WorkerSkillRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((skillItem: any) => {
      const skillName = typeof skillItem === 'string' ? skillItem : String(skillItem?.name || '');
      const capitalizedName = capitalizeWords(skillName);
      if (!capitalizedName) return null;
      const type = skillItem?.type || skillItem?.category || 'Other';
      const source = (skillItem?.source as 'predefined' | 'custom') || 'custom';
      const confidence = typeof skillItem?.confidence === 'number' ? skillItem.confidence : 1;
      return {
        name: capitalizedName,
        canonicalId: skillItem?.canonicalId || capitalizedName,
        source,
        type,
        confidence,
      } as WorkerSkillRow;
    })
    .filter(Boolean) as WorkerSkillRow[];
}

function normalizeForWrite(rows: WorkerSkillRow[]) {
  return rows.map((s) => ({
    name: s.name,
    canonicalId: s.canonicalId || s.name,
    source: s.source,
    type: s.type,
    confidence: s.confidence ?? 1,
  }));
}

type Props = { uid: string };

const WorkerSkillsEditor: React.FC<Props> = ({ uid }) => {
  const t = useT();
  const [skills, setSkills] = useState<WorkerSkillRow[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [showAllMySkills, setShowAllMySkills] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) return;
    const ref = doc(db, 'users', uid);
    const unsub = onSnapshot(ref, (snap) => {
      if (!snap.exists()) {
        setSkills([]);
        return;
      }
      const data = snap.data() as Record<string, unknown>;
      setSkills(parseSkillsFromFirestore(data.skills));
    });
    return () => unsub();
  }, [uid]);

  const commitSkills = (next: WorkerSkillRow[], revertTo: WorkerSkillRow[]) => {
    void (async () => {
      try {
        await updateDoc(doc(db, 'users', uid), {
          skills: normalizeForWrite(next),
          updatedAt: serverTimestamp(),
        });
        setSaveError(null);
      } catch (e) {
        setSkills(revertTo);
        setSaveError(e instanceof Error ? e.message : t('profile.unableToSaveSkills'));
      }
    })();
  };

  const selectedKeys = useMemo(() => new Set(skills.map((s) => skillKey(s.name))), [skills]);

  const suggestionRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const out: OnetRow[] = [];
    const seen = new Set<string>();

    const pushUnique = (row: OnetRow) => {
      const k = row.name.toLowerCase();
      if (selectedKeys.has(k) || seen.has(k)) return;
      seen.add(k);
      out.push(row);
    };

    if (!q) {
      for (const name of COMMON_SUGGESTIONS) {
        pushUnique({ name, category: 'General' });
        if (out.length >= 36) break;
      }
      for (const row of onetSkills) {
        if (out.length >= 36) break;
        pushUnique(row);
      }
      return out;
    }

    for (const row of onetSkills) {
      if (out.length >= 40) break;
      if (!row.name.toLowerCase().includes(q)) continue;
      pushUnique(row);
    }
    return out;
  }, [searchQuery, selectedKeys]);

  const visibleMySkills = showAllMySkills ? skills : skills.slice(0, INITIAL_VISIBLE);
  const hasMoreMySkills = skills.length > INITIAL_VISIBLE;

  const addFromOnet = (row: OnetRow) => {
    setSkills((prev) => {
      if (prev.some((s) => skillKey(s.name) === skillKey(row.name))) return prev;
      const next = [
        ...prev,
        {
          name: row.name,
          canonicalId: row.name,
          source: 'predefined' as const,
          type: row.category || 'Other',
          confidence: 1,
        },
      ];
      commitSkills(next, prev);
      return next;
    });
  };

  const addCustomFromSearch = () => {
    const trimmed = searchQuery.trim();
    if (!trimmed) return;
    const exact = onetSkills.find((o) => o.name.toLowerCase() === trimmed.toLowerCase());
    if (exact) {
      addFromOnet(exact);
      setSearchQuery('');
      return;
    }
    setSkills((prev) => {
      const name = capitalizeWords(trimmed);
      if (!name || prev.some((s) => skillKey(s.name) === skillKey(name))) return prev;
      const next = [
        ...prev,
        {
          name,
          canonicalId: name,
          source: 'custom' as const,
          type: 'Other',
          confidence: 0.8,
        },
      ];
      commitSkills(next, prev);
      return next;
    });
    setSearchQuery('');
  };

  const removeAt = (index: number) => {
    setSkills((prev) => {
      if (index < 0 || index >= prev.length) return prev;
      const next = prev.filter((_, i) => i !== index);
      commitSkills(next, prev);
      return next;
    });
  };

  const chipSx = {
    height: 32,
    maxWidth: '100%',
    bgcolor: 'grey.100',
    color: 'text.primary',
    border: '1px solid',
    borderColor: 'grey.300',
    fontWeight: 500,
    '& .MuiChip-label': { px: 1.25 },
    '& .MuiChip-deleteIcon': {
      color: 'text.secondary',
      '&:hover': { color: 'error.main' },
    },
  } as const;

  const suggestionChipSx = {
    height: 32,
    cursor: 'pointer',
    borderColor: 'grey.400',
    color: 'text.primary',
    bgcolor: 'background.paper',
    fontWeight: 400,
    '&:hover': {
      borderColor: 'primary.main',
      bgcolor: 'action.hover',
    },
  } as const;

  return (
    <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'divider', boxShadow: 'none' }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        {saveError ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {saveError}
          </Alert>
        ) : null}

        <Stack spacing={2.5}>
          <Box>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                {t('profile.workerSkillsYourSkills')}
              </Typography>
              <Button
                size="small"
                variant={editMode ? 'contained' : 'text'}
                color="primary"
                onClick={() => {
                  setEditMode((v) => !v);
                  if (editMode) setShowAllMySkills(false);
                }}
              >
                {editMode ? t('profile.workerSkillsDone') : t('profile.workerSkillsEdit')}
              </Button>
            </Stack>

            {skills.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                {t('profile.workerSkillsEmpty')}
              </Typography>
            ) : (
              <Stack direction="row" flexWrap="wrap" useFlexGap gap={1}>
                {visibleMySkills.map((s, idx) => (
                  <Chip
                    key={`${skillKey(s.name)}-${idx}`}
                    label={s.name}
                    onDelete={editMode ? () => removeAt(idx) : undefined}
                    deleteIcon={<CloseIcon fontSize="small" />}
                    sx={chipSx}
                  />
                ))}
              </Stack>
            )}

            {hasMoreMySkills ? (
              <Button
                size="small"
                onClick={() => setShowAllMySkills((v) => !v)}
                sx={{ mt: 1.5 }}
                variant="text"
                color="primary"
              >
                {showAllMySkills ? t('profile.workerSkillsShowLess') : t('profile.workerSkillsShowAll')}
              </Button>
            ) : null}
          </Box>

          <Divider />

          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1.5 }}>
              {t('profile.workerSkillsAddMore')}
            </Typography>
            <TextField
              fullWidth
              size="small"
              label={t('profile.workerSkillsSearchLabel')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addCustomFromSearch();
                }
              }}
              sx={{ mb: 2 }}
              autoComplete="off"
            />
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1, fontWeight: 600 }}>
              {t('profile.workerSkillsSuggested')}
            </Typography>
            <Stack direction="row" flexWrap="wrap" useFlexGap gap={1}>
              {suggestionRows.map((row) => (
                <Chip
                  key={row.name}
                  label={row.name}
                  variant="outlined"
                  onClick={() => addFromOnet(row)}
                  sx={suggestionChipSx}
                />
              ))}
            </Stack>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
};

export default WorkerSkillsEditor;
