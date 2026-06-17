import React from 'react';
import { Box, Text } from 'ink';

interface ProgressBarProps {
  percent: number; // 0 to 100
  width?: number;  // characters wide
  color?: string;  // color string for active part
}

export function ProgressBar({ percent, width = 30, color = 'yellow' }: ProgressBarProps) {
  const cleanPercent = Math.max(0, Math.min(100, percent));
  const filledLength = Math.round((cleanPercent / 100) * width);
  const emptyLength = width - filledLength;

  const filled = '█'.repeat(filledLength);
  const empty = '░'.repeat(emptyLength);

  return (
    <Box flexDirection="row">
      <Text color={color}>{filled}</Text>
      <Text color="gray">{empty}</Text>
    </Box>
  );
}
