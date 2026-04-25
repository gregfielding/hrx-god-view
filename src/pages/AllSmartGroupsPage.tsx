/**
 * All Smart Groups – list every saved smart group in the tenant. Recruiters
 * can see groups created by others and "Add to My Smart Groups" to copy one
 * into their own list.
 *
 * The table itself lives in `componentBlocks/SmartGroupsTable.tsx` and is
 * shared with the My Smart Groups view (different `scope`, same chrome).
 */

import React from 'react';
import { useOutletContext } from 'react-router-dom';
import SmartGroupsTable from '../componentBlocks/SmartGroupsTable';
import type { UsersLayoutOutletContext } from './UsersLayout';

export interface AllSmartGroupsPageProps {
  /** Reserved for parity with the User Groups pages (header is owned by the layout). */
  hideHeader?: boolean;
}

const AllSmartGroupsPage: React.FC<AllSmartGroupsPageProps> = () => {
  // Pull the search value from the universal search bar that lives in the
  // `UsersLayout` tab row's right slot. If the page is ever rendered outside
  // that layout, `useOutletContext` returns null and the table simply renders
  // unfiltered.
  const ctx = useOutletContext<UsersLayoutOutletContext | null>();
  return <SmartGroupsTable scope="all" search={ctx?.search} />;
};

export default AllSmartGroupsPage;
