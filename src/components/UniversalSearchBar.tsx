/**
 * UniversalSearchBar — the canonical "search + favorites" toolbar
 * control for every top-level list page in the admin app.
 *
 * Visual / interaction spec (locked in as of Apr 2026):
 *
 *   - 32px tall, ~240px wide pill (`borderRadius: 999px`)
 *   - Full 1px light border on every side
 *       resting:  `rgba(0, 0, 0, 0.12)`
 *       hover:    `rgba(0, 0, 0, 0.24)`
 *       focused:  `primary.main`
 *   - White interior (`#ffffff`), no box-shadow
 *   - Leading 🔍 search icon (`text.secondary`)
 *   - Trailing inline favorites star (filled when active, outlined
 *     otherwise) sized as a 24×24 glyph with no fixed circular bg —
 *     visually part of the input, not a separate button next to it
 *   - When the user has typed something, a Clear (×) button appears
 *     immediately to the left of the favorites star
 *   - When the input is empty *and* unfocused *and* no favorites slot
 *     is supplied, falls back to a `⌘K` / `Ctrl+K` shortcut hint
 *     (handled by the underlying InboxSearchBar — exposed here only
 *     for non-list contexts)
 *
 * Implementation: this component is a thin wrapper around
 * `InboxSearchBar`. The `InboxSearchBar` owns the visual treatment;
 * this wrapper bakes in the favorites-as-end-adornment pattern so a
 * caller only needs to pass `favoriteType` + the search props and gets
 * the canonical look automatically.
 *
 * Add a new list page later? Drop in:
 *
 *   <UniversalSearchBar
 *     placeholder="Search foos..."
 *     value={search}
 *     onChange={setSearch}
 *     onSearch={setSearch}
 *     favoriteType="foos"
 *     showFavoritesOnly={showFav}
 *     onToggleFavorites={setShowFav}
 *   />
 *
 * If a page doesn't have a favorites concept, omit the three favorites
 * props and the right edge falls back to the `⌘K` hint.
 */

import React from 'react';
import type { SxProps, Theme } from '@mui/material';
import InboxSearchBar, { compactInboxSearchBarSx } from './InboxSearchBar';
import FavoritesFilter from './FavoritesFilter';
import type { FavoriteType } from '../hooks/useFavorites';

/**
 * sx for the inline favorites glyph rendered inside the search bar's
 * trailing slot. Exported so any one-off caller that wants to drop a
 * different glyph in the same slot (e.g. a future "smart filter"
 * button) can match the visual weight.
 */
export const universalSearchInlineGlyphSx: SxProps<Theme> = {
  minWidth: 'auto',
  width: 24,
  height: 24,
  p: 0.25,
  borderRadius: '50%',
  '& .MuiButton-startIcon': {
    m: 0,
    '& svg': { fontSize: 18 },
  },
  '&:hover': { backgroundColor: 'rgba(0, 0, 0, 0.04)' },
};

interface UniversalSearchBarProps {
  /** Current search string. */
  value: string;
  /** Fired on every keystroke. Mirror this into local state. */
  onChange: (value: string) => void;
  /** Fired on Enter / clear / suggestion-pick. Use for "commit" work
   *  like firing a Firestore query. */
  onSearch: (query: string) => void;
  /** Placeholder text — should always read "Search <thing>...". */
  placeholder?: string;
  /** Disables the input. */
  disabled?: boolean;
  /** sx overrides applied to the outer wrapper. Defaults to the
   *  compact 240px-wide preset; pass a different sx if a specific
   *  page needs more room. */
  sx?: SxProps<Theme>;
  /**
   * --- Favorites (optional trio) -------------------------------------
   * Pass all three to render the inline favorites star inside the
   * search bar. Omit them on pages that have no favorites concept and
   * the right edge falls back to the `⌘K` hint.
   */
  favoriteType?: FavoriteType;
  showFavoritesOnly?: boolean;
  onToggleFavorites?: (next: boolean) => void;
  /**
   * When true, render a trailing magnifier IconButton that calls
   * `onSearch(value)` on click — same effect as pressing Enter, but
   * mouse-discoverable. Only appears when the field is non-empty. Use
   * on list pages where the commit path is expensive (e.g. server scan)
   * so users have a visible affordance to fire it.
   */
  showSubmitButton?: boolean;
  /** Tooltip on the submit magnifier; default "Search". */
  submitTooltip?: string;
}

const UniversalSearchBar: React.FC<UniversalSearchBarProps> = ({
  value,
  onChange,
  onSearch,
  placeholder = 'Search...',
  disabled = false,
  sx,
  favoriteType,
  showFavoritesOnly,
  onToggleFavorites,
  showSubmitButton = false,
  submitTooltip,
}) => {
  // All three favorites props must be present for the star to render.
  // We don't try to be clever with partial state — better to fail loud
  // on a missing prop in dev than to render a star that doesn't toggle.
  const showFavoritesSlot =
    favoriteType !== undefined &&
    showFavoritesOnly !== undefined &&
    onToggleFavorites !== undefined;

  return (
    <InboxSearchBar
      value={value}
      onChange={onChange}
      onSearch={onSearch}
      placeholder={placeholder}
      disabled={disabled}
      sx={sx ?? compactInboxSearchBarSx}
      showSubmitButton={showSubmitButton}
      {...(submitTooltip ? { submitTooltip } : {})}
      endAdornment={
        showFavoritesSlot ? (
          <FavoritesFilter
            favoriteType={favoriteType as FavoriteType}
            showFavoritesOnly={showFavoritesOnly as boolean}
            onToggle={onToggleFavorites as (next: boolean) => void}
            showText={false}
            size="small"
            sx={universalSearchInlineGlyphSx}
          />
        ) : undefined
      }
    />
  );
};

export default UniversalSearchBar;
