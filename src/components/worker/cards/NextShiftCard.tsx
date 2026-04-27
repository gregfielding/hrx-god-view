import React from 'react';
import { Card, CardContent, Typography, Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';

export interface NextShiftCardProps {
  firstName?: string;
  /** If provided, show shift details; otherwise "No shifts scheduled" */
  nextShift?: {
    title: string;
    location?: string;
    when: string;
    assignmentId?: string;
  } | null;
}

const NextShiftCard: React.FC<NextShiftCardProps> = ({ firstName, nextShift }) => {
  const navigate = useNavigate();

  return (
    <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'divider', boxShadow: 'none' }}>
      <CardContent sx={{ py: 2.5, px: 2.5 }}>
        {firstName && (
          <Typography variant="body1" color="text.secondary" sx={{ mb: 1 }}>
            👋 Hi {firstName}
          </Typography>
        )}
        <Typography variant="h5" sx={{ fontWeight: 600, mb: 1.5 }}>
          Next Shift
        </Typography>
        {nextShift ? (
          <>
            <Typography variant="body1" sx={{ fontWeight: 500 }}>
              {nextShift.title}
            </Typography>
            {nextShift.location && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {nextShift.location}
              </Typography>
            )}
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {nextShift.when}
            </Typography>
            <Button
              variant="contained"
              size="medium"
              sx={{ mt: 2 }}
              onClick={() => nextShift?.assignmentId && navigate(`/c1/workers/assignments/${nextShift.assignmentId}`)}
            >
              View Details
            </Button>
          </>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary">
              No shifts scheduled.
            </Typography>
            <Button variant="contained" size="medium" sx={{ mt: 2 }} onClick={() => navigate('/c1/jobs-board')}>
              Find Work
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default NextShiftCard;
