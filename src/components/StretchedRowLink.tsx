import React from 'react';
import { Link } from 'react-router-dom';

/**
 * Makes an entire table row / card right-click-able ("Open in new tab",
 * "Copy link", middle-click) while keeping normal React Router client-side
 * navigation on left-click. A plain `onClick={() => navigate(path)}` never
 * gets these browser affordances because there's no real `href` for the
 * browser to see.
 *
 * Renders an invisible anchor absolutely positioned to fill its nearest
 * `position: relative` ancestor (the "stretched link" pattern). Usage:
 *
 *   <TableRow sx={{ position: 'relative', cursor: 'pointer' }}>
 *     <TableCell sx={{ position: 'relative' }}>
 *       <StretchedRowLink to={`/users/${uid}`} />
 *       {cellContent}
 *     </TableCell>
 *     ...
 *   </TableRow>
 *
 * The row/card container needs `position: relative` — the link stretches
 * to fill THAT box (a `position: relative` ancestor further up, like a
 * `<tr>`, works fine in all modern browsers even though `<tr>` isn't a
 * typical positioning context historically).
 *
 * Any interactive element nested inside the row (an action button, a menu
 * trigger, a checkbox) needs its own `position: relative` + a z-index
 * above this link's (this renders at `zIndex: 0`) so clicks land on the
 * button instead of falling through to the row-level navigation.
 */
export default function StretchedRowLink({ to }: { to: string }): React.ReactElement {
  return (
    <Link
      to={to}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 0,
      }}
    />
  );
}
