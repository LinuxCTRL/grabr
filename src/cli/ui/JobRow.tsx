import React from 'react';
import { Box, Text } from 'ink';
import type { DownloadJob } from '../../core/types';
import { ProgressBar } from './ProgressBar';
import { formatBytes, formatSpeed, formatETA } from './utils';

interface JobRowProps {
  job: DownloadJob;
  isSelected: boolean;
}

export function JobRow({ job, isSelected }: JobRowProps) {
  const percent = job.totalBytes > 0 ? (job.downloadedBytes / job.totalBytes) * 100 : 0;
  
  // Decide colors and labels based on status
  let statusColor = 'gray';
  let statusIcon = '';
  let statusText = '';
  let progressColor = 'yellow';

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

  // Highlight color for the selection cursor
  const cursorPrefix = isSelected ? '▸ ' : '  ';
  const nameColor = isSelected ? 'cyan' : 'white';

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Top Row: [Selector] Filename | Progress % | Speed/Done */}
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexDirection="row" flexGrow={1}>
          <Text color="cyan" bold={isSelected}>{cursorPrefix}</Text>
          <Text color={nameColor} bold={isSelected} wrap="truncate-end">
            {job.filename}
          </Text>
        </Box>
        <Box flexDirection="row">
          <Text color={statusColor} bold={isSelected}>
            {Math.round(percent)}%
          </Text>
          <Text color="gray">  |  </Text>
          <Text color={statusColor} bold={isSelected}>
            {statusIcon} {statusText}
          </Text>
        </Box>
      </Box>

      {/* Bottom Row: [Indent] Progress Bar | ETA or Size/Error */}
      <Box flexDirection="row" marginLeft={2} marginTop={0}>
        <ProgressBar percent={percent} width={30} color={progressColor} />
        <Box marginLeft={2}>
          {job.status === 'downloading' && (
            <Text color="gray">{formatETA(job.eta)}</Text>
          )}
          {job.status === 'completed' && (
            <Text color="green">{formatBytes(job.totalBytes)}</Text>
          )}
          {job.status === 'paused' && (
            <Text color="gray">
              {formatBytes(job.downloadedBytes)} / {job.totalBytes > 0 ? formatBytes(job.totalBytes) : 'Unknown'}
            </Text>
          )}
          {job.status === 'queued' && (
            <Text color="gray">
              {job.totalBytes > 0 ? formatBytes(job.totalBytes) : 'Unknown'}
            </Text>
          )}
          {job.status === 'failed' && (
            <Text color="red" wrap="truncate-end">
              Err: {job.error || 'Unknown error'}
            </Text>
          )}
        </Box>
      </Box>
    </Box>
  );
}
