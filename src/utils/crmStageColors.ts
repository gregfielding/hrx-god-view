// 🎨 CRM Deal Stage Color Mapping System
// This file defines the full list of opportunity stages used in our CRM, 
// along with their associated color codes for consistent visual representation.

export interface StageColor {
  name: string;
  hex: string;
  description: string;
  materialColor?: string; // For MUI color system integration
}

export const CRM_STAGE_COLORS: Record<string, StageColor> = {
  // 🔵 Early Stages – Shades of Blue (Light to Dark)
  "Discovery": {
    name: "Blue 100",
    hex: "#BBDEFB",
    description: "Initial awareness, cold lead",
    materialColor: "blue"
  },
  "Qualification": {
    name: "Blue 300",
    hex: "#64B5F6",
    description: "Sales has confirmed potential",
    materialColor: "blue"
  },
  "Scoping": {
    name: "Blue 600",
    hex: "#1E88E5",
    description: "Discovery/planning in progress",
    materialColor: "blue"
  },
  
  // 🟡 Mid Stages – Yellow to Orange Gradient
  "Proposal Drafted": {
    name: "Amber 200",
    hex: "#FFE082",
    description: "Sales activity underway",
    materialColor: "amber"
  },
  "Proposal Review": {
    name: "Orange 400",
    hex: "#FFA726",
    description: "Client reviewing proposal",
    materialColor: "orange"
  },
  "Negotiation": {
    name: "Deep Orange 600",
    hex: "#F4511E",
    description: "Yellow – heightened attention",
    materialColor: "deepOrange"
  },
  
  // ✅ Winning Stages – Shades of Green
  "Verbal Agreement": {
    name: "Light Green 400",
    hex: "#9CCC65",
    description: "Tentative success",
    materialColor: "lightGreen"
  },
  "Closed – Won": {
    name: "Green 800",
    hex: "#2E7D32",
    description: "Final success",
    materialColor: "green"
  },
  
  // ❌ Losing Stage – Red
  "Closed – Lost": {
    name: "Red 600",
    hex: "#E53935",
    description: "Final failure",
    materialColor: "red"
  },
  
  // 🚀 Account Stages – Shades of Purple
  "Onboarding": {
    name: "Purple 300",
    hex: "#BA68C8",
    description: "Post-sale setup",
    materialColor: "purple"
  },
  "Live Account": {
    name: "Deep Purple 800",
    hex: "#4527A0",
    description: "Stable, long-term account",
    materialColor: "deepPurple"
  },
  
  // ⚫ Dormant – Black
  "Dormant": {
    name: "Black",
    hex: "#000000",
    description: "Inactive or disengaged client",
    materialColor: "grey"
  }
};

// 🛠 Utility Functions

/**
 * Get the color information for a specific stage
 * @param stage - The stage name (case-insensitive)
 * @returns StageColor object or null if not found
 */
export const getStageColor = (stage: string): StageColor | null => {
  const normalizedStage = stage.trim();
  
  // Direct match
  if (CRM_STAGE_COLORS[normalizedStage]) {
    return CRM_STAGE_COLORS[normalizedStage];
  }
  
  // Case-insensitive match
  const stageKey = Object.keys(CRM_STAGE_COLORS).find(
    key => key.toLowerCase() === normalizedStage.toLowerCase()
  );
  
  return stageKey ? CRM_STAGE_COLORS[stageKey] : null;
};

/**
 * Get the HEX color for a stage
 * @param stage - The stage name
 * @returns HEX color string or default grey
 */
export const getStageHexColor = (stage: string): string => {
  const stageColor = getStageColor(stage);
  return stageColor?.hex || "#9E9E9E"; // Default to grey
};

/**
 * Get the MUI color for a stage (for Chip components)
 * @param stage - The stage name
 * @returns MUI color string or "default"
 */
export const getStageMuiColor = (stage: string): "default" | "primary" | "secondary" | "error" | "info" | "success" | "warning" => {
  const stageColor = getStageColor(stage);
  
  if (!stageColor?.materialColor) return "default";
  
  // Map material colors to MUI Chip colors
  const colorMap: Record<string, "default" | "primary" | "secondary" | "error" | "info" | "success" | "warning"> = {
    "grey": "default",
    "blue": "primary",
    "amber": "warning",
    "orange": "warning",
    "deepOrange": "warning",
    "lightGreen": "success",
    "green": "success",
    "red": "error",
    "purple": "secondary",
    "deepPurple": "secondary"
  };
  
  return colorMap[stageColor.materialColor] || "default";
};

/**
 * Get all available stages as an array
 * @returns Array of stage names
 */
export const getAllStages = (): string[] => {
  return Object.keys(CRM_STAGE_COLORS);
};

/**
 * Get stages grouped by category (for filtering/reporting)
 * @returns Object with stage categories
 */
export const getStagesByCategory = () => {
  return {
    "🔵 Early Stages": ["Discovery", "Qualification", "Scoping"],
    "🟡 Mid Stages": ["Proposal Drafted", "Proposal Review", "Negotiation"],
    "✅ Winning Stages": ["Verbal Agreement", "Closed – Won"],
    "❌ Losing Stage": ["Closed – Lost"],
    "🚀 Account Stages": ["Onboarding", "Live Account"],
    "⚫ Dormant": ["Dormant"]
  };
};

/**
 * Check if a stage is considered "active" (not closed or dormant)
 * @param stage - The stage name
 * @returns boolean
 */
export const isActiveStage = (stage: string): boolean => {
  const closedStages = ["Closed – Won", "Closed – Lost", "Dormant"];
  return !closedStages.includes(stage);
};

/**
 * Check if a stage is considered "won" (successful outcome)
 * @param stage - The stage name
 * @returns boolean
 */
export const isWonStage = (stage: string): boolean => {
  return stage === "Closed – Won" || stage === "Live Account";
};

/**
 * Check if a stage is considered "lost" (unsuccessful outcome)
 * @param stage - The stage name
 * @returns boolean
 */
export const isLostStage = (stage: string): boolean => {
  return stage === "Closed – Lost";
};

// 🎨 React Component Helpers

/**
 * Get Chip props for a stage (for use with MUI Chip component)
 * @param stage - The stage name
 * @returns Object with color and variant props
 */
export const getStageChipProps = (stage: string) => {
  return {
    color: getStageMuiColor(stage),
    variant: "filled" as const,
    size: "small" as const,
    label: stage
  };
};

/**
 * Calculate text contrast color (white or black) based on background color
 * @param hexColor - HEX color string
 * @returns 'white' or 'black' for optimal contrast
 */
export const getTextContrastColor = (hexColor: string): string => {
  // Remove # if present
  const hex = hexColor.replace('#', '');
  
  // Convert to RGB
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);
  
  // Calculate luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  
  // Return white for dark backgrounds, black for light backgrounds
  return luminance > 0.5 ? '#000000' : '#FFFFFF';
};

/**
 * Get inline style object for custom styling
 * @param stage - The stage name
 * @returns Style object with backgroundColor and proper text contrast
 */
export const getStageStyle = (stage: string) => {
  const backgroundColor = getStageHexColor(stage);
  return {
    backgroundColor,
    color: getTextContrastColor(backgroundColor),
    fontWeight: 600 as const
  };
};

// 📊 Reporting Helpers

/**
 * Get stage statistics for reporting
 * @param deals - Array of deal objects with stage property
 * @returns Object with stage counts and percentages
 */
export const getStageStatistics = (deals: Array<{ stage: string }>) => {
  const stageCounts: Record<string, number> = {};
  const total = deals.length;
  
  // Initialize all stages with 0
  getAllStages().forEach(stage => {
    stageCounts[stage] = 0;
  });
  
  // Count deals by stage
  deals.forEach(deal => {
    if (deal.stage && Object.prototype.hasOwnProperty.call(stageCounts, deal.stage)) {
      stageCounts[deal.stage]++;
    }
  });
  
  // Calculate percentages
  const stagePercentages: Record<string, number> = {};
  Object.keys(stageCounts).forEach(stage => {
    stagePercentages[stage] = total > 0 ? (stageCounts[stage] / total) * 100 : 0;
  });
  
  return {
    counts: stageCounts,
    percentages: stagePercentages,
    total,
    activeCount: deals.filter(deal => isActiveStage(deal.stage)).length,
    wonCount: deals.filter(deal => isWonStage(deal.stage)).length,
    lostCount: deals.filter(deal => isLostStage(deal.stage)).length
  };
};

// 🛠️ Implementation Helper Functions

/**
 * Get stage color for direct use in components (alias for getStageHexColor)
 * @param stage - The stage name
 * @returns HEX color string
 */
export const getStageColorHex = (stage: string): string => {
  return getStageHexColor(stage);
};

/**
 * Get text contrast color for a stage
 * @param stage - The stage name
 * @returns HEX color string for text
 */
export const getStageTextColor = (stage: string): string => {
  return getTextContrastColor(getStageHexColor(stage));
};

/**
 * Get complete style object for a stage (for use with Chip component)
 * @param stage - The stage name
 * @returns Style object with backgroundColor and color
 */
export const getStageChipStyle = (stage: string) => {
  const backgroundColor = getStageHexColor(stage);
  return {
    backgroundColor,
    color: getTextContrastColor(backgroundColor)
  };
};

export default CRM_STAGE_COLORS; 