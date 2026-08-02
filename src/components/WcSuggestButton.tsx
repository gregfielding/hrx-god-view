/**
 * WcSuggestButton — the recruiter-facing surface of the WC semantic
 * classifier (Greg 2026-07-29, slice 2).
 *
 * A novel job title (fresh Sodexo/catering titles that the exact-match
 * jobTitles[] layer has never seen) won't auto-fill a WC code. This button
 * asks the server classifier (`suggestWorkersCompCode`) to pick the best
 * code FROM the codes the carrier already rates for the worksite state,
 * shows each with its rate + confidence + one-line reasoning, and on Apply:
 *   1. fills the code + rate into the position (via onApply), and
 *   2. calls `learnWorkersCompAlias` so the title is written back onto the
 *      matrix row — next time it's an exact match and the LLM never fires.
 *
 * Suggest-only: nothing changes until the recruiter clicks Apply.
 */
import React, { useState } from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Popover,
  Typography,
} from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

interface Suggestion {
  code: string;
  rate: number | null;
  title: string | null;
  description: string | null;
  descriptionVerified: boolean;
  confidence: number;
  reasoning: string | null;
}

interface WcSuggestButtonProps {
  tenantId: string;
  jobTitle: string;
  state: string;
  modifierAccountId?: string | null;
  /** Fill the resolved code + rate into the position/JO. */
  onApply: (code: string, rate: number | null) => void;
}

const confidenceColor = (c: number): 'success' | 'warning' | 'default' =>
  c >= 0.75 ? 'success' : c >= 0.45 ? 'warning' : 'default';

const WcSuggestButton: React.FC<WcSuggestButtonProps> = ({
  tenantId,
  jobTitle,
  state,
  modifierAccountId,
  onApply,
}) => {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [applyingCode, setApplyingCode] = useState<string | null>(null);

  const disabled = !tenantId || !jobTitle.trim() || !state.trim();

  const handleOpen = async (e: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(e.currentTarget);
    setLoading(true);
    setError(null);
    setSuggestions([]);
    setNote(null);
    try {
      const fn = httpsCallable(functions, 'suggestWorkersCompCode');
      const res = (await fn({ tenantId, jobTitle: jobTitle.trim(), state: state.trim() })) as {
        data: { suggestions?: Suggestion[]; noCodesForState?: boolean; candidateCount?: number };
      };
      const list = res.data?.suggestions ?? [];
      setSuggestions(list);
      if (res.data?.noCodesForState) {
        setNote(`No WC codes are rated for ${state} yet — add them in Settings › Workers Comp Rates.`);
      } else if (list.length === 0) {
        setNote(`No confident match among the ${res.data?.candidateCount ?? 0} codes rated for ${state}. Pick a code manually.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Suggestion failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async (s: Suggestion) => {
    onApply(s.code, s.rate);
    setApplyingCode(s.code);
    // Learn-once: write the title back onto the matrix row so the
    // exact-match layer covers it next time. Fire-and-forget — the fill
    // already happened; a learn failure shouldn't block the recruiter.
    try {
      const learn = httpsCallable(functions, 'learnWorkersCompAlias');
      await learn({ tenantId, state: state.trim(), code: s.code, jobTitle: jobTitle.trim(), modifierAccountId: modifierAccountId ?? undefined });
    } catch {
      /* non-fatal */
    }
    setApplyingCode(null);
    setAnchorEl(null);
  };

  return (
    <>
      <Button
        size="small"
        startIcon={<AutoAwesomeIcon fontSize="small" />}
        onClick={handleOpen}
        disabled={disabled}
        sx={{ textTransform: 'none', mt: 0.5 }}
        title={disabled ? 'Pick a worksite (state) and enter a job title first' : 'Ask HRX to suggest a WC code'}
      >
        Suggest WC code
      </Button>
      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Box sx={{ p: 2, maxWidth: 420 }}>
          <Typography variant="subtitle2" gutterBottom>
            Suggested for “{jobTitle}” in {state}
          </Typography>
          {loading && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
              <CircularProgress size={18} />
              <Typography variant="body2" color="text.secondary">
                Classifying…
              </Typography>
            </Box>
          )}
          {error && (
            <Typography variant="body2" color="error">
              {error}
            </Typography>
          )}
          {!loading && !error && note && (
            <Typography variant="body2" color="text.secondary">
              {note}
            </Typography>
          )}
          {suggestions.map((s) => (
            <Box
              key={s.code}
              sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 1.5, mt: 1.5, '&:first-of-type': { borderTop: 'none', pt: 0, mt: 1 } }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography variant="body2" fontFamily="monospace" fontWeight={600}>
                  {s.code}
                </Typography>
                {s.title && (
                  <Typography variant="body2" color="text.secondary">
                    {s.title}
                  </Typography>
                )}
                {s.rate != null && (
                  <Chip size="small" label={`$${s.rate.toFixed(2)}`} variant="outlined" />
                )}
                <Chip
                  size="small"
                  color={confidenceColor(s.confidence)}
                  label={`${Math.round(s.confidence * 100)}%`}
                />
                {s.descriptionVerified === false && (
                  <Chip size="small" color="warning" variant="outlined" label="unverified" />
                )}
              </Box>
              {s.reasoning && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                  {s.reasoning}
                </Typography>
              )}
              <Button
                size="small"
                variant="contained"
                sx={{ mt: 1, textTransform: 'none' }}
                onClick={() => handleApply(s)}
                disabled={applyingCode === s.code}
              >
                {applyingCode === s.code ? 'Applying…' : `Apply ${s.code}`}
              </Button>
            </Box>
          ))}
        </Box>
      </Popover>
    </>
  );
};

export default WcSuggestButton;
