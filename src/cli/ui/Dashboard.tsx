import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import type { DownloadJob } from '../../core/types';
import { JobRow } from './JobRow';
import { listJobs } from '../../store/jobs';
import type { Downloader } from '../../core/downloader';

interface DashboardProps {
  mode: 'local' | 'remote';
  downloader?: Downloader; // used in local mode
  serverPort?: number;      // used in remote mode
}

export function Dashboard({ mode, downloader, serverPort = 7474 }: DashboardProps) {
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const { exit } = useApp();

  const apiBase = `http://localhost:${serverPort}/api`;
  const wsUrl = `ws://localhost:${serverPort}/ws`;

  // Load initial jobs
  useEffect(() => {
    let active = true;

    async function loadInitialJobs() {
      if (mode === 'local') {
        const localList = listJobs();
        if (active) setJobs(localList);
      } else {
        try {
          const res = await fetch(`${apiBase}/jobs`);
          if (res.ok) {
            const remoteList = (await res.json()) as DownloadJob[];
            if (active) setJobs(remoteList);
          } else {
            if (active) setStatusMessage('Server API returned error status');
          }
        } catch (err: any) {
          if (active) setStatusMessage(`Failed to connect to daemon API: ${err.message}`);
        }
      }
    }

    loadInitialJobs();
    return () => {
      active = false;
    };
  }, [mode, apiBase]);

  // Wire up events/updates
  useEffect(() => {
    if (mode === 'local' && downloader) {
      const handleAdded = (job: DownloadJob) => {
        setJobs((prev) => [job, ...prev]);
      };

      const handleProgress = ({ jobId, downloadedBytes, speed, eta }: any) => {
        setJobs((prev) =>
          prev.map((j) =>
            j.id === jobId
              ? { ...j, downloadedBytes, speed, eta, updatedAt: Date.now() }
              : j
          )
        );
      };

      const handleStatus = ({ jobId, status, error }: any) => {
        setJobs((prev) =>
          prev.map((j) =>
            j.id === jobId
              ? { ...j, status, error, speed: 0, eta: -1, updatedAt: Date.now() }
              : j
          )
        );
      };

      const handleRemoved = (jobId: string) => {
        setJobs((prev) => prev.filter((j) => j.id !== jobId));
      };

      downloader.on('job:added', handleAdded);
      downloader.on('job:progress', handleProgress);
      downloader.on('job:status', handleStatus);
      downloader.on('job:removed', handleRemoved);

      return () => {
        downloader.off('job:added', handleAdded);
        downloader.off('job:progress', handleProgress);
        downloader.off('job:status', handleStatus);
        downloader.off('job:removed', handleRemoved);
      };
    } else if (mode === 'remote') {
      let ws: WebSocket | null = null;
      let reconnectTimer: Timer | null = null;

      function connectWS() {
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          setStatusMessage('Connected to daemon');
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'job:progress') {
              setJobs((prev) =>
                prev.map((j) =>
                  j.id === data.jobId
                    ? {
                        ...j,
                        downloadedBytes: data.downloadedBytes,
                        speed: data.speed,
                        eta: data.eta,
                        updatedAt: Date.now(),
                      }
                    : j
                )
              );
            } else if (data.type === 'job:status') {
              setJobs((prev) =>
                prev.map((j) =>
                  j.id === data.jobId
                    ? {
                        ...j,
                        status: data.status,
                        error: data.error,
                        speed: 0,
                        eta: -1,
                        updatedAt: Date.now(),
                      }
                    : j
                )
              );
            } else if (data.type === 'job:added') {
              setJobs((prev) => [data.job, ...prev]);
            } else if (data.type === 'job:removed') {
              setJobs((prev) => prev.filter((j) => j.id !== data.jobId));
            }
          } catch (err) {
            // Ignore parse errors
          }
        };

        ws.onclose = () => {
          setStatusMessage('Disconnected from daemon. Retrying...');
          reconnectTimer = setTimeout(connectWS, 2000);
        };

        ws.onerror = () => {
          ws?.close();
        };
      }

      connectWS();

      return () => {
        if (reconnectTimer) clearTimeout(reconnectTimer);
        ws?.close();
      };
    }
  }, [mode, downloader, wsUrl]);

  // Constrain selected index
  useEffect(() => {
    if (jobs.length === 0) {
      setSelectedIndex(0);
      return;
    }
    if (selectedIndex >= jobs.length) {
      setSelectedIndex(jobs.length - 1);
    }
  }, [jobs, selectedIndex]);

  // Keyboard navigation and actions
  useInput(async (input, key) => {
    if (input === 'q') {
      exit();
      return;
    }

    if (jobs.length === 0) return;
    const selectedJob = jobs[selectedIndex];
    if (!selectedJob) return;

    if (key.upArrow) {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
    } else if (key.downArrow) {
      setSelectedIndex((prev) => Math.min(jobs.length - 1, prev + 1));
    } else if (input === 'p') {
      // Pause
      if (mode === 'local' && downloader) {
        downloader.pauseJob(selectedJob.id);
      } else {
        try {
          await fetch(`${apiBase}/jobs/${selectedJob.id}/pause`, { method: 'POST' });
        } catch (err: any) {
          setStatusMessage(`Failed to send pause command: ${err.message}`);
        }
      }
    } else if (input === 'r') {
      // Resume
      if (mode === 'local' && downloader) {
        downloader.resumeJob(selectedJob.id);
      } else {
        try {
          await fetch(`${apiBase}/jobs/${selectedJob.id}/resume`, { method: 'POST' });
        } catch (err: any) {
          setStatusMessage(`Failed to send resume command: ${err.message}`);
        }
      }
    } else if (input === 'x') {
      // Remove
      if (mode === 'local' && downloader) {
        downloader.removeJob(selectedJob.id);
      } else {
        try {
          await fetch(`${apiBase}/jobs/${selectedJob.id}`, { method: 'DELETE' });
        } catch (err: any) {
          setStatusMessage(`Failed to send remove command: ${err.message}`);
        }
      }
    }
  });

  return (
    <Box flexDirection="column" padding={1} minHeight={12}>
      {/* Title block */}
      <Box borderStyle="single" borderColor="amber" paddingX={2} marginBottom={1}>
        <Text color="yellow" bold>
          grabr — Downloader Dashboard ({mode === 'local' ? 'Standalone' : 'Daemon'})
        </Text>
      </Box>

      {/* Main Jobs Area */}
      <Box flexDirection="column" flexGrow={1}>
        {jobs.length === 0 ? (
          <Box height={5} justifyContent="center" alignItems="center">
            <Text color="gray">No downloads found. Add one to get started!</Text>
          </Box>
        ) : (
          jobs.map((job, idx) => (
            <JobRow key={job.id} job={job} isSelected={idx === selectedIndex} />
          ))
        )}
      </Box>

      {/* Status or Connection alerts */}
      {statusMessage && (
        <Box marginTop={1} paddingX={1}>
          <Text color="yellow">⚠️ {statusMessage}</Text>
        </Box>
      )}

      {/* Footer shortcut bar */}
      <Box borderStyle="double" borderColor="gray" paddingX={1} marginTop={1} flexDirection="row" justifyContent="space-between">
        <Text color="gray">
          <Text color="cyan" bold>q</Text> quit  |  <Text color="cyan" bold>p</Text> pause  |  <Text color="cyan" bold>r</Text> resume  |  <Text color="cyan" bold>x</Text> delete  |  <Text color="cyan" bold>↑↓</Text> navigate
        </Text>
        <Text color="gray">
          Total: {jobs.length} jobs
        </Text>
      </Box>
    </Box>
  );
}
