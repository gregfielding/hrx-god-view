import React, { useMemo } from 'react';
import {
  Box,
  Typography,
  Button,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Chip,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  ArrowForward as ArrowForwardIcon,
  SkipNext as SkipNextIcon,
  QuestionMark as QuestionMarkIcon,
} from '@mui/icons-material';

interface NextStepsWidgetProps {
  stageData: any;
  currentStage: string;
  onNavigateToStages: () => void;
  onSkipQuestion: (stage: string, field: string) => void;
}

interface Question {
  id: string;
  stage: string;
  field: string;
  question: string;
  isAnswered: boolean;
  isSkipped: boolean;
}

const NextStepsWidget: React.FC<NextStepsWidgetProps> = ({
  stageData,
  currentStage,
  onNavigateToStages,
  onSkipQuestion,
}) => {
    // Helper function to check if a field is answered or skipped
  const getFieldStatus = (stageData: any, stage: string, field: string) => {
    const value = stageData?.[stage]?.[field];
    const isSkipped = value === '__SKIPPED__';
    const isAnswered = value !== undefined && value !== '' && !isSkipped;
    return { isAnswered, isSkipped };
  };

  // Define all questions for each stage
  const allQuestions = useMemo(() => {
    const questions: Question[] = [];

    // Discovery Questions
    questions.push(
      {
        id: 'discovery_usesAgencies',
        stage: 'discovery',
        field: 'usesAgencies',
        question: 'Do they currently use staffing agencies?',
        ...getFieldStatus(stageData, 'discovery', 'usesAgencies'),
      },
      {
        id: 'discovery_hasUsedBefore',
        stage: 'discovery',
        field: 'hasUsedBefore',
        question: 'Have they used staffing agencies before?',
        ...getFieldStatus(stageData, 'discovery', 'hasUsedBefore'),
      },
      {
        id: 'discovery_strugglingToHire',
        stage: 'discovery',
        field: 'strugglingToHire',
        question: 'Are they struggling to hire?',
        ...getFieldStatus(stageData, 'discovery', 'strugglingToHire'),
      },
      {
        id: 'discovery_openToAgency',
        stage: 'discovery',
        field: 'openToAgency',
        question: 'Are they open to using an agency?',
        ...getFieldStatus(stageData, 'discovery', 'openToAgency'),
      }
    );

    // Qualification Questions
    questions.push(
      {
        id: 'qualification_openToNewAgency',
        stage: 'qualification',
        field: 'openToNewAgency',
        question: 'Are they open to a new agency?',
        ...getFieldStatus(stageData, 'qualification', 'openToNewAgency'),
      },
      {
        id: 'qualification_mustHave',
        stage: 'qualification',
        field: 'mustHave',
        question: 'What are the must have requirements?',
        ...getFieldStatus(stageData, 'qualification', 'mustHave'),
      },
      {
        id: 'qualification_mustAvoid',
        stage: 'qualification',
        field: 'mustAvoid',
        question: 'What are the must avoid requirements?',
        ...getFieldStatus(stageData, 'qualification', 'mustAvoid'),
      },
      {
        id: 'qualification_expectedCloseDate',
        stage: 'qualification',
        field: 'expectedCloseDate',
        question: 'What is the expected close date?',
        ...getFieldStatus(stageData, 'qualification', 'expectedCloseDate'),
      }
    );

    // Scoping Questions
    questions.push(
      {
        id: 'scoping_competingAgencies',
        stage: 'scoping',
        field: 'competingAgencies',
        question: 'How many competing agencies?',
        ...getFieldStatus(stageData, 'scoping', 'competingAgencies'),
      },
      {
        id: 'scoping_onsite',
        stage: 'scoping',
        field: 'onsite',
        question: 'Is onsite supervision required?',
        ...getFieldStatus(stageData, 'scoping', 'onsite'),
      }
    );

    // Proposal Questions
    questions.push(
      {
        id: 'proposalDrafted_rateSheetUploaded',
        stage: 'proposalDrafted',
        field: 'rateSheetUploaded',
        question: 'Has the rate sheet been uploaded?',
        ...getFieldStatus(stageData, 'proposalDrafted', 'rateSheetUploaded'),
      }
    );

    return questions;
  }, [stageData]);

  // Get next 3 unanswered questions, prioritizing current stage
  const nextQuestions = useMemo(() => {
    const unanswered = allQuestions.filter(q => !q.isAnswered && !q.isSkipped);
    
    // Prioritize current stage questions first
    const currentStageQuestions = unanswered.filter(q => q.stage === currentStage);
    const otherStageQuestions = unanswered.filter(q => q.stage !== currentStage);
    
    // Combine current stage questions first, then others
    const prioritized = [...currentStageQuestions, ...otherStageQuestions];
    
    return prioritized.slice(0, 3);
  }, [allQuestions, currentStage]);

  const handleSkipQuestion = (question: Question) => {
    onSkipQuestion(question.stage, question.field);
  };

  const getStageDisplayName = (stage: string) => {
    const stageNames: { [key: string]: string } = {
      discovery: 'Discovery',
      qualification: 'Qualification',
      scoping: 'Scoping',
      proposalDrafted: 'Proposal Drafted',
      proposalReview: 'Proposal Review',
      negotiation: 'Negotiation',
      verbalAgreement: 'Verbal Agreement',
      closedWon: 'Closed Won',
      closedLost: 'Closed Lost',
      onboarding: 'Onboarding',
      liveAccount: 'Live Account',
      dormant: 'Dormant',
    };
    return stageNames[stage] || stage;
  };

  if (nextQuestions.length === 0) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>
          Next Steps
        </Typography>
        <Box sx={{ textAlign: 'center', py: 3 }}>
          <Typography variant="body2" color="text.secondary">
            All key questions have been answered! 🎉
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Great job completing the deal qualification process.
          </Typography>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 0 }}>
      
      <List dense>
        {nextQuestions.map((question, index) => (
          <ListItem
            key={question.id}
            sx={{
              border: '1px solid',
              borderColor: 'grey.200',
              borderRadius: 1,
              mb: 1,
              bgcolor: 'background.paper',
              cursor: 'pointer',
              position: 'relative',
              '&:hover': {
                bgcolor: 'grey.50',
                borderColor: 'grey.300',
              },
              transition: 'all 0.2s ease-in-out',
            }}
            onClick={() => onNavigateToStages()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onNavigateToStages();
              }
            }}
          >
            <ListItemText
              primary={
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {question.question}
                </Typography>
              }
              secondary={
                <Typography component="span" sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                  <Chip
                    label={getStageDisplayName(question.stage)}
                    size="small"
                    variant="outlined"
                    sx={{ fontSize: '0.625rem', height: 20 }}
                  />
                </Typography>
              }
            />
            <ListItemSecondaryAction>
              <Button
                size="small"
                variant="text"
                onClick={(e) => {
                  e.stopPropagation(); // Prevent triggering the parent onClick
                  handleSkipQuestion(question);
                }}
                sx={{ 
                  color: 'text.secondary',
                  fontSize: '0.75rem',
                  textTransform: 'none',
                  minWidth: 'auto',
                  px: 1,
                  zIndex: 10, // Higher z-index to ensure it's clickable
                  position: 'relative',
                  '&:hover': {
                    bgcolor: 'rgba(0, 0, 0, 0.04)',
                  }
                }}
              >
                Skip
              </Button>
            </ListItemSecondaryAction>
          </ListItem>
        ))}
      </List>
    </Box>
  );
};

export default NextStepsWidget;
