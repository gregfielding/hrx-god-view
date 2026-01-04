import React from 'react';

interface SlackHashIconProps {
  active?: boolean;
  size?: number;
}

export const SlackHashIcon: React.FC<SlackHashIconProps> = ({ active = false, size = 20 }) => {
  // Normal state: muted gray, Active state: white
  const stroke = active ? '#FFFFFF' : '#9CA3AF';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M7 3L5 17"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M13 3L11 17"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M3 7H17"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M3 13H17"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
};

export default SlackHashIcon;


