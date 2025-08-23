import React from 'react';
import { Chip, ChipProps, Tooltip } from '@mui/material';
import { 
  Search as SearchIcon,
  CheckCircle as CheckCircleIcon,
  Assignment as AssignmentIcon,
  Description as DescriptionIcon,
  RateReview as RateReviewIcon,
  Handshake as HandshakeIcon,
  ThumbUp as ThumbUpIcon,
  CheckCircleOutline as CheckCircleOutlineIcon,
  Cancel as CancelIcon,
  PersonAdd as PersonAddIcon,
  Business as BusinessIcon,
  Block as BlockIcon
} from '@mui/icons-material';

import { getStageChipProps, getStageColor, getTextContrastColor, getStageHexColor } from '../utils/crmStageColors';

interface StageChipProps extends Omit<ChipProps, 'label' | 'color'> {
  stage: string;
  showTooltip?: boolean;
  useCustomColors?: boolean;
  size?: 'small' | 'medium';
}

/**
 * StageChip Component
 * 
 * A reusable chip component that displays CRM deal stages with consistent
 * color coding and optional tooltips showing stage descriptions.
 * 
 * @param stage - The stage name to display
 * @param showTooltip - Whether to show a tooltip with stage description
 * @param useCustomColors - Whether to use custom HEX colors instead of MUI colors
 * @param size - Size of the chip ('small' or 'medium')
 * @param props - Additional Chip props
 */
const StageChip: React.FC<StageChipProps> = ({
  stage,
  showTooltip = true,
  useCustomColors = true,
  size = 'small',
  ...props
}) => {
  const stageColor = getStageColor(stage);
  const stageDescription = stageColor?.description || 'Unknown stage';
  
  // Get stage icon based on stage name
  const getStageIcon = (stageName: string) => {
    const stageLower = stageName.toLowerCase();
    if (stageLower.includes('discovery')) return <SearchIcon fontSize="small" />;
    if (stageLower.includes('qualification')) return <CheckCircleIcon fontSize="small" />;
    if (stageLower.includes('scoping')) return <AssignmentIcon fontSize="small" />;
    if (stageLower.includes('proposal drafted')) return <DescriptionIcon fontSize="small" />;
    if (stageLower.includes('proposal review')) return <RateReviewIcon fontSize="small" />;
    if (stageLower.includes('negotiation')) return <HandshakeIcon fontSize="small" />;
    if (stageLower.includes('verbal agreement')) return <ThumbUpIcon fontSize="small" />;
    if (stageLower.includes('closed') && stageLower.includes('won')) return <CheckCircleOutlineIcon fontSize="small" />;
    if (stageLower.includes('closed') && stageLower.includes('lost')) return <CancelIcon fontSize="small" />;
    if (stageLower.includes('onboarding')) return <PersonAddIcon fontSize="small" />;
    if (stageLower.includes('live account')) return <BusinessIcon fontSize="small" />;
    if (stageLower.includes('dormant')) return <BlockIcon fontSize="small" />;
    return <SearchIcon fontSize="small" />; // Default icon
  };
  
  // Get chip props based on configuration
  const chipProps = useCustomColors 
    ? {
        ...getStageChipProps(stage),
        style: {
          backgroundColor: getStageHexColor(stage),
          color: getTextContrastColor(getStageHexColor(stage)),
          fontWeight: 600
        },
        size,
        icon: getStageIcon(stage)
      }
    : {
        ...getStageChipProps(stage),
        size,
        icon: getStageIcon(stage)
      };

  const chip = (
    <Chip
      {...chipProps}
      {...props}
      label={stage}
    />
  );

  // Wrap with tooltip if enabled
  if (showTooltip) {
    return (
      <Tooltip 
        title={stageDescription}
        arrow
        placement="top"
      >
        {chip}
      </Tooltip>
    );
  }

  return chip;
};

export default StageChip; 