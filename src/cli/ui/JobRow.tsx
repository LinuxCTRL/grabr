import React from 'react';
import { Box, Text } from 'ink';
import type { DownloadJob } from '../../core/types';
import { ProgressBar } from './ProgressBar';
import { formatSpeed } from './utils';

interface JobRowProps {
  job: DownloadJob;
  isSelected: boolean;
}

export function JobRow({ job, isSelected }: JobRowProps) {
  const percent = job.totalBytes > 0 ? (job.downloadedBytes / job.totalBytes) * 100 : 0;
  
  let statusColor = 'gray';
  let statusIcon = '⏳';
  let statusText = 'Queued';
  let progressColor = 'gray';

  switch (job.status) {
    case 'downloading':
      statusColor = 'yellow';
      statusIcon = '↓';
      statusText = formatSpeed(job.speed);
      progressColor = 'yellow';
      break;
    case 'completed':
      statusColor = 'green';
      statusIcon = '✓';
      statusText = 'Done';
      progressColor = 'green';
      break;
    case 'paused':
      statusColor = 'blue';
      statusIcon = '⏸';
      statusText = 'Paused';
      progressColor = 'blue';
      break;
    case 'queued':
      statusColor = 'gray';
      statusIcon = '⏳';
      statusText = 'Queued';
      progressColor = 'gray';
      break;
    case 'failed':
      statusColor = 'red';
      statusIcon = '✗';
      statusText = 'Failed';
      progressColor = 'red';
      break;
  }

  const cursor = isSelected ? '▶ ' : '  ';
  const nameColor = isSelected ? 'cyan' : 'white';

  return (
    <Box flexDirection="row" paddingX={1} alignItems="center">
      {/* Selector cursor */}
      <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>{cursor}</Text>
      
      {/* Filename column (fixed flex width) */}
      <Box width={32} marginRight={2}>
        <Text color={nameColor} bold={isSelected} wrap="truncate-end">
          {job.filename}
        </Text>
      </Box>

      {/* Progress Bar column */}
      <Box width={22} marginRight={2}>
        <ProgressBar percent={percent} width={12} color={progressColor} />
        <Text color={statusColor} bold={isSelected}> {Math.round(percent).toString().padStart(3)}%</Text>
      </Box>

      {/* Status column */}
      <Box width={16}>
        <Text color={statusColor} bold={isSelected} wrap="truncate-end">
          {statusIcon} {statusText}
        </Text>
      </Box>
    </Box>
  );
}
