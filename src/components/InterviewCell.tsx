/**
 * Reusable cell that shows the most recent interview date and score for a user.
 * Fetches from users/{userId}/interviews and prefers the latest (by date) from either
 * the subcollection or scoreSummary, so interviews by any conductor are shown.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Typography } from '@mui/material';
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { db } from '../firebase';
import { formatOneDecimal } from '../utils/scoreSummary';

export interface ScoreSummaryInterview {
  interviewLastAt?: any;
  interviewLastScore10?: number;
}

function toDate(v: any): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'number') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (v?.toDate && typeof v.toDate === 'function') {
    const d = v.toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
  }
  if (v?._seconds != null) return new Date(v._seconds * 1000);
  return null;
}

function defaultFormatDate(timestamp: any): string {
  const date = toDate(timestamp);
  if (!date) return 'N/A';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export interface InterviewCellProps {
  userId: string;
  scoreSummary?: ScoreSummaryInterview | null;
  /** Optional; defaults to short date (e.g. Mar 4, 2026) */
  formatDate?: (timestamp: any) => string;
  /** If true, render Typography with color="text.secondary" for empty state */
  variant?: 'body2';
}

export const InterviewCell: React.FC<InterviewCellProps> = ({
  userId,
  scoreSummary,
  formatDate = defaultFormatDate,
  variant = 'body2',
}) => {
  const [latestFromSubcollection, setLatestFromSubcollection] = useState<{
    lastAt: Date;
    score10: number;
  } | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!userId) {
      setLatestFromSubcollection(null);
      return;
    }
    let cancelled = false;
    const ref = collection(db, 'users', userId, 'interviews');
    (async () => {
      try {
        const q = query(ref, orderBy('createdAt', 'desc'), limit(1));
        const snap = await getDocs(q);
        if (cancelled || !isMountedRef.current || snap.empty) return;
        const data = snap.docs[0].data();
        const lastAt = data.createdAt?.toDate?.() ?? data.timestamp?.toDate?.();
        const score10 =
          typeof data.score10 === 'number'
            ? data.score10
            : typeof data.score === 'number'
              ? data.score
              : null;
        if (lastAt && score10 != null && !Number.isNaN(score10) && isMountedRef.current)
          setLatestFromSubcollection({ lastAt, score10 });
      } catch {
        try {
          const q = query(ref, orderBy('timestamp', 'desc'), limit(1));
          const snap = await getDocs(q);
          if (cancelled || !isMountedRef.current || snap.empty) return;
          const data = snap.docs[0].data();
          const lastAt = data.createdAt?.toDate?.() ?? data.timestamp?.toDate?.();
          const score10 =
            typeof data.score10 === 'number'
              ? data.score10
              : typeof data.score === 'number'
                ? data.score
                : null;
          if (lastAt && score10 != null && !Number.isNaN(score10) && isMountedRef.current)
            setLatestFromSubcollection({ lastAt, score10 });
        } catch {
          // ignore
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const summaryAt = scoreSummary?.interviewLastAt;
  const summaryScore = scoreSummary?.interviewLastScore10;
  const summaryDate = toDate(summaryAt);
  const summaryValid =
    summaryDate &&
    typeof summaryScore === 'number' &&
    !Number.isNaN(summaryScore);

  const useSubcollection =
    latestFromSubcollection &&
    (!summaryValid ||
      latestFromSubcollection.lastAt.getTime() > summaryDate!.getTime());

  if (useSubcollection) {
    return (
      <Typography variant={variant}>
        {formatDate(latestFromSubcollection!.lastAt)} —{' '}
        {formatOneDecimal(latestFromSubcollection!.score10)}/10
      </Typography>
    );
  }
  if (summaryValid) {
    return (
      <Typography variant={variant}>
        {formatDate(summaryAt)} — {formatOneDecimal(summaryScore)}/10
      </Typography>
    );
  }
  if (latestFromSubcollection) {
    return (
      <Typography variant={variant}>
        {formatDate(latestFromSubcollection.lastAt)} —{' '}
        {formatOneDecimal(latestFromSubcollection.score10)}/10
      </Typography>
    );
  }
  return (
    <Typography variant={variant} color="text.secondary">
      —
    </Typography>
  );
};

export default InterviewCell;
