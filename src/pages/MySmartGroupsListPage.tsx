/**
 * My Smart Groups – the viewer's own smart groups (both the ones they
 * created and the ones they pulled in from All Smart Groups via "Add to My
 * Smart Groups", since copies are stored as new docs with `createdBy` set
 * to the viewer's uid).
 *
 * The table itself lives in `componentBlocks/SmartGroupsTable.tsx` and is
 * shared with the All Smart Groups view (different `scope`, same chrome).
 */

import React from 'react';
import { useOutletContext } from 'react-router-dom';
import SmartGroupsTable from '../componentBlocks/SmartGroupsTable';
import type { UsersLayoutOutletContext } from './UsersLayout';

export interface MySmartGroupsListPageProps {
  /** Reserved for parity with the User Groups pages (header is owned by the layout). */
  hideHeader?: boolean;
}

const MySmartGroupsListPage: React.FC<MySmartGroupsListPageProps> = () => {
  // Pull the search value from the universal search bar that lives in the
  // `UsersLayout` tab row's right slot. If the page is ever rendered outside
  // that layout, `useOutletContext` returns null and the table simply renders
  // unfiltered.
  const ctx = useOutletContext<UsersLayoutOutletContext | null>();
  return <SmartGroupsTable scope="mine" search={ctx?.search} />;
};

export default MySmartGroupsListPage;
