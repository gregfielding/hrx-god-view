import React from 'react';
import { Chip, ChipProps, Tooltip } from '@mui/material';
import { getStageChipProps, getStageColor, getStageStyle, getTextContrastColor, getStageHexColor } from '../utils/crmStageColors';

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
  
  // Get chip props based on configuration
  const chipProps = useCustomColors 
    ? {
        ...getStageChipProps(stage),
        style: {
          backgroundColor: getStageHexColor(stage),
          color: getTextContrastColor(getStageHexColor(stage)),
          fontWeight: 600
        },
        size
      }
    : {
        ...getStageChipProps(stage),
        size
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