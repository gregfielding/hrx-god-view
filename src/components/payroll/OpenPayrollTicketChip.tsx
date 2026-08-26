/**
 * Small header chip on the admin User Profile: shows when the worker has an
 * active payroll help-desk ticket (open or waiting), links to the console.
 * Renders nothing when the queue is clear (payroll help desk audit,
 * Greg 2026-08-24 — "tickets must be connected to user accounts").
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Chip, Tooltip } from '@mui/material';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../firebase';

const OpenPayrollTicketChip: React.FC<{ uid: string; tenantId: string }> = ({ uid, tenantId }) => {
  const navigate = useNavigate();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!uid || !tenantId) return;
    // tenantId filter keeps the level-5 rules branch provable.
    const q1 = query(
      collection(db, 'payroll_tickets'),
      where('uid', '==', uid),
      where('tenantId', '==', tenantId),
      where('status', 'in', ['open', 'waiting_worker']),
    );
    return onSnapshot(
      q1,
      (snap) => setCount(snap.size),
      () => setCount(0),
    );
  }, [uid, tenantId]);

  if (count === 0) return null;
  return (
    <Tooltip title="This worker has an active payroll help-desk ticket — click to open the queue.">
      <Chip
        size="small"
        color="warning"
        label={count === 1 ? 'Payroll ticket' : `${count} payroll tickets`}
        onClick={() => navigate('/payroll-tickets')}
        sx={{ fontWeight: 600, cursor: 'pointer' }}
      />
    </Tooltip>
  );
};

export default OpenPayrollTicketChip;
