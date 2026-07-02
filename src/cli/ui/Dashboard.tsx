import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import type { DownloadJob } from '../../core/types';
import { JobRow } from './JobRow';
import { listJobs } from '../../store/jobs';
import type { Downloader } from '../../core/downloader';
import packageJson from '../../../package.json';

const currentVersion = packageJson.version;

function isNewerVersion(current: string, latest: string): boolean {
  const cParts = current.split('.').map(Number);
  const lParts = latest.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const c = cParts[i] ?? 0;
    const l = lParts[i] ?? 0;
    if (l > c) return true;
    if (l < c) return false;
  }
  return false;
}

interface DashboardProps {
  mode: 'local' | 'remote';
  downloader?: Downloader; // used in local mode
  serverPort?: number;      // used in remote mode
}

export function Dashboard({ mode, downloader, serverPort = 7474 }: DashboardProps) {
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const { exit } = useApp();

  // Check for newer version on npm
  useEffect(() => {
    let active = true;
    async function checkVersion() {
      try {
        const res = await fetch('https://registry.npmjs.org/@linuxctrl/grabr/latest', {
          signal: AbortSignal.timeout(2000),
        });
        if (res.ok) {
          const data = (await res.json()) as { version: string };
          if (active && data && data.version) {
            setLatestVersion(data.version);
          }
        }
      } catch {
        // Silently ignore network failures
      }
    }
    checkVersion();
    return () => {
      active = false;
    };
  }, []);

  const apiBase = `http://localhost:${serverPort}/api`;
  const wsUrl = `ws://localhost:${serverPort}/ws`;

  // Load initial jobs
  useEffect(() => {
    let active = true;

    async function loadInitialJobs() {
      if (mode === 'local') {
        const localList = await listJobs();
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
      let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

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

    if (input === 'o') {
      try {
        const checkRunning = async (port: number) => {
          try {
            const res = await fetch(`http://localhost:${port}/api/jobs`, { signal: AbortSignal.timeout(300) });
            return res.ok;
          } catch {
            return false;
          }
        };
        const isRunning = await checkRunning(serverPort);
        if (!isRunning) {
          setStatusMessage('Starting daemon...');
          const { spawn } = await import('node:child_process');
          const serverPath = require('node:path').join(process.cwd(), 'src/server/index.ts');
          const stateDir = require('node:path').join(process.cwd(), '.grabr');
          const pidFile = require('node:path').join(stateDir, 'daemon.pid');
          const logFile = require('node:path').join(stateDir, 'daemon.log');
          const out = require('node:fs').openSync(logFile, 'a');
          const err = require('node:fs').openSync(logFile, 'a');
          const child = spawn('bun', ['run', serverPath], {
            detached: true,
            stdio: ['ignore', out, err],
            cwd: process.cwd(),
            env: { ...process.env },
          });
          const pid = child.pid;
          if (pid) {
            require('node:fs').writeFileSync(pidFile, pid.toString(), 'utf-8');
          }
          child.unref();
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        
        const os = process.platform;
        const url = `http://localhost:${serverPort}`;
        const { spawn } = await import('node:child_process');
        if (os === 'darwin') {
          spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
        } else if (os === 'win32') {
          spawn('cmd', ['/c', 'start', url], { stdio: 'ignore', detached: true }).unref();
        } else {
          spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
        }
        setStatusMessage('Web UI opened in browser');
      } catch (err: any) {
        setStatusMessage(`Failed to open browser: ${err.message}`);
      }
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
      <Box flexDirection="row" borderStyle="single" borderColor="cyan" paddingX={2} paddingY={1} marginBottom={1} justifyContent="space-between" alignItems="center">
        <Box flexDirection="column">
          <Text color="cyan" bold>
            {"  ____  ____    _    ____  ____  \n" +
             " / ___||  _ \\  / \\  | __ )|  _ \\ \n" +
             "| |  _ | |_) |/ _ \\ |  _ \\| |_) |\n" +
             "| |_| ||  _ < / ___ \\| |_) |  _ < \n" +
             " \\____||_| \\_\\/_/   \\_\\____/|_| \\_\\"}
          </Text>
          <Text color="gray">
            {"  Modern, elegant downloader built with Bun + TypeScript"}
          </Text>
        </Box>
        <Box flexDirection="column" alignItems="flex-end">
          <Text color="green" bold>
            ● {mode === 'local' ? 'Standalone' : 'Daemon Mode'}
          </Text>
          <Text color="gray">
            Port: {serverPort}
          </Text>
          <Text color="gray">
            Version: v{currentVersion}
          </Text>
        </Box>
      </Box>

      {/* Version check alert */}
      {latestVersion && isNewerVersion(currentVersion, latestVersion) && (
        <Box borderStyle="round" borderColor="green" paddingX={2} paddingY={1} marginBottom={1} flexDirection="column">
          <Text color="green" bold>
            ✨ New version available: v{latestVersion} (Current: v{currentVersion})
          </Text>
          <Text color="gray">
            Run 'npm install -g @linuxctrl/grabr' to update to the latest version!
          </Text>
        </Box>
      )}

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
          <Text color="cyan" bold>q</Text> quit  |  <Text color="cyan" bold>o</Text> open in browser  |  <Text color="cyan" bold>p</Text> pause  |  <Text color="cyan" bold>r</Text> resume  |  <Text color="cyan" bold>x</Text> delete  |  <Text color="cyan" bold>↑↓</Text> navigate
        </Text>
        <Text color="gray">
          Total: {jobs.length} jobs
        </Text>
      </Box>
    </Box>
  );
}
