import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import type { DownloadJob } from '../../core/types';
import type { TorrentJob } from '../../core/types-torrent';
import { JobRow } from './JobRow';
import { listJobs } from '../../store/jobs';
import type { Downloader } from '../../core/downloader';
import packageJson from '../../../package.json';
import { formatBytes, formatSpeed, formatETA, normalizeJob } from './utils';
import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';

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

function FormInput({ label, value, isFocused, placeholder }: { label: string; value: string; isFocused: boolean; placeholder?: string }) {
  return (
    <Box flexDirection="row" marginBottom={0}>
      <Text color={isFocused ? 'cyan' : 'gray'} bold={isFocused}>
        {isFocused ? '▶ ' : '  '}
        {label.padEnd(16)}:{' '}
      </Text>
      {isFocused ? (
        <Box borderStyle="single" borderColor="cyan" paddingX={1}>
          <Text color="white">{value || placeholder || ''}</Text>
          <Text color="cyan" bold>█</Text>
        </Box>
      ) : (
        <Text color={value ? 'white' : 'gray'}>{value || placeholder || '-'}</Text>
      )}
    </Box>
  );
}

export function Dashboard({ mode, downloader, serverPort = 7474 }: DashboardProps) {
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const { exit } = useApp();

  // Dialog & Add Job Form State
  const [activeDialog, setActiveDialog] = useState<null | 'add-job' | 'delete-confirm' | 'extensions' | 'add-torrent'>(null);
  const [focusedField, setFocusedField] = useState<number>(0);
  const [inputUrl, setInputUrl] = useState('');
  const [inputFilename, setInputFilename] = useState('');
  const [inputOutDir, setInputOutDir] = useState('');
  const [confirmJobId, setConfirmJobId] = useState<string | null>(null);

  // Torrent dialog state
  const [torrentUrl, setTorrentUrl] = useState('');
  const [torrentJob, setTorrentJob] = useState<any>(null);
  const [torrentFocusedIdx, setTorrentFocusedIdx] = useState(0);
  const [torrentStatus, setTorrentStatus] = useState('');

  // YouTube formats state
  const [ytFormats, setYtFormats] = useState<{ value: string; label: string; ext: string }[]>([]);
  const [ytSelectedFormatIndex, setYtSelectedFormatIndex] = useState(0);
  const [isAnalyzingYt, setIsAnalyzingYt] = useState(false);
  const [ytAnalysisError, setYtAnalysisError] = useState<string | null>(null);

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

  // Fetch YouTube formats using yt-dlp locally or remote daemon
  async function fetchYtFormats(url: string) {
    setIsAnalyzingYt(true);
    setYtAnalysisError(null);
    setYtFormats([]);
    setYtSelectedFormatIndex(0);

    try {
      let info: any;
      if (mode === 'local') {
        info = await new Promise((resolve, reject) => {
          const child: any = spawn('yt-dlp', ['-j', '--no-playlist', url]);
          let stdout = '';
          let stderr = '';
          child.stdout.on('data', (d: any) => stdout += d.toString());
          child.stderr.on('data', (d: any) => stderr += d.toString());
          child.on('close', (code: any) => {
            if (code !== 0) return reject(new Error(stderr.trim() || 'yt-dlp failed'));
            try {
              resolve(JSON.parse(stdout));
            } catch (err) {
              reject(err);
            }
          });
        });
      } else {
        const res = await fetch(`${apiBase}/youtube/formats?url=${encodeURIComponent(url)}`);
        if (!res.ok) {
          throw new Error(await res.text() || 'Failed to fetch formats');
        }
        info = await res.json();
      }

      if (info && info.formats) {
        if (info.title && !inputFilename) {
          setInputFilename(info.title.replace(/[|\\/:*?"<>]/g, '_').trim());
        }

        const formats = info.formats || [];
        const videoFormats = formats.filter((f: any) => f.vcodec && f.vcodec !== 'none');
        
        const processed = videoFormats.map((f: any) => {
          const isCombined = f.acodec && f.acodec !== 'none';
          const formatExt = f.ext || 'mp4';
          const res = f.height ? `${f.height}p` : (f.resolution || 'unknown');
          const fpsStr = f.fps && f.fps > 30 ? `${f.fps}fps` : '';
          const size = f.filesize || f.filesize_approx || 0;
          return {
            value: isCombined ? f.format_id : `${f.format_id}+bestaudio[ext=m4a]/bestaudio`,
            label: `${formatExt.toUpperCase()} ${res} ${fpsStr ? fpsStr + ' ' : ''}(${isCombined ? 'Direct' : 'Merged + Audio'})${size > 0 ? ` (~${formatBytes(size)})` : ''}`,
            ext: isCombined ? formatExt : 'mp4'
          };
        });

        processed.sort((a: any, b: any) => {
          const aHeight = parseInt(a.label.match(/\d+p/)?.[0] || '0');
          const bHeight = parseInt(b.label.match(/\d+p/)?.[0] || '0');
          return bHeight - aHeight;
        });

        const seen = new Set();
        const filtered = [];
        for (const f of processed) {
          const key = f.label.split(' (~')[0];
          if (!seen.has(key)) {
            seen.add(key);
            filtered.push(f);
          }
        }

        const list = [
          {
            value: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
            label: 'Best Quality (Auto MP4)',
            ext: 'mp4'
          },
          ...filtered,
          {
            value: 'bestaudio[ext=m4a]/bestaudio',
            label: 'Audio Only (M4A)',
            ext: 'm4a'
          }
        ];

        setYtFormats(list);
      }
    } catch (err: any) {
      setYtAnalysisError(err.message);
    } finally {
      setIsAnalyzingYt(false);
    }
  }

  // Trigger YouTube format check when URL input changes
  useEffect(() => {
    const isYt = inputUrl.includes('youtube.com/') || inputUrl.includes('youtu.be/');
    if (isYt && activeDialog === 'add-job') {
      const timer = setTimeout(() => {
        fetchYtFormats(inputUrl);
      }, 600);
      return () => clearTimeout(timer);
    } else {
      setYtFormats([]);
    }
  }, [inputUrl, activeDialog]);

  // Sync filename extension with selected YouTube format
  useEffect(() => {
    const showFormatSelector = ytFormats.length > 0;
    if (showFormatSelector && ytFormats[ytSelectedFormatIndex]) {
      const fmt = ytFormats[ytSelectedFormatIndex];
      const ext = fmt.ext;
      let currentName = inputFilename;
      const lastDot = currentName.lastIndexOf('.');
      if (lastDot !== -1) {
        currentName = currentName.substring(0, lastDot);
      }
      if (currentName) {
        setInputFilename(`${currentName}.${ext}`);
      }
    }
  }, [ytSelectedFormatIndex, ytFormats]);

  const apiBase = `http://127.0.0.1:${serverPort}/api`;
  const wsUrl = `ws://127.0.0.1:${serverPort}/ws`;

  // Load initial jobs
  useEffect(() => {
    let active = true;

    async function loadInitialJobs() {
      if (mode === 'local') {
        const localList = await listJobs();
        if (active) setJobs(localList.map(normalizeJob));
      } else {
        try {
          const res = await fetch(`${apiBase}/jobs`);
          if (res.ok) {
            const remoteList = (await res.json()) as DownloadJob[];
            if (active) setJobs(remoteList.map(normalizeJob));
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
        setJobs((prev) => [normalizeJob(job), ...prev]);
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

      const handleTorrentProgress = ({ jobId, downloaded, speed, eta }: any) => {
        setJobs((prev) =>
          prev.map((j) =>
            j.id === jobId
              ? { ...j, downloadedBytes: downloaded, speed, eta, updatedAt: Date.now() }
              : j
          )
        );
      };

      const handleTorrentStatus = ({ jobId, status, error }: any) => {
        setJobs((prev) =>
          prev.map((j) =>
            j.id === jobId
              ? { ...j, status: status === 'seeding' ? 'completed' : status, error, speed: 0, eta: -1, updatedAt: Date.now() }
              : j
          )
        );
      };

      const handleTorrentDone = ({ jobId }: any) => {
        setJobs((prev) =>
          prev.map((j) =>
            j.id === jobId
              ? { ...j, status: 'completed', speed: 0, eta: -1, downloadedBytes: j.totalBytes, updatedAt: Date.now() }
              : j
          )
        );
      };

      const handleTorrentError = ({ jobId, error }: any) => {
        setJobs((prev) =>
          prev.map((j) =>
            j.id === jobId
              ? { ...j, status: 'failed', error, speed: 0, eta: -1, updatedAt: Date.now() }
              : j
          )
        );
      };

      const handleTorrentRemoved = ({ jobId }: any) => {
        setJobs((prev) => prev.filter((j) => j.id !== jobId));
      };

      downloader.on('job:added', handleAdded);
      downloader.on('job:progress', handleProgress);
      downloader.on('job:status', handleStatus);
      downloader.on('job:removed', handleRemoved);
      downloader.on('torrent:progress', handleTorrentProgress);
      downloader.on('torrent:status', handleTorrentStatus);
      downloader.on('torrent:done', handleTorrentDone);
      downloader.on('torrent:error', handleTorrentError);
      downloader.on('torrent:removed', handleTorrentRemoved);

      return () => {
        downloader.off('job:added', handleAdded);
        downloader.off('job:progress', handleProgress);
        downloader.off('job:status', handleStatus);
        downloader.off('job:removed', handleRemoved);
        downloader.off('torrent:progress', handleTorrentProgress);
        downloader.off('torrent:status', handleTorrentStatus);
        downloader.off('torrent:done', handleTorrentDone);
        downloader.off('torrent:error', handleTorrentError);
        downloader.off('torrent:removed', handleTorrentRemoved);
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
                        text: '',
                        eta: -1,
                        updatedAt: Date.now(),
                      }
                    : j
                )
              );
            } else if (data.type === 'job:added') {
              setJobs((prev) => [normalizeJob(data.job), ...prev]);
            } else if (data.type === 'job:removed') {
              setJobs((prev) => prev.filter((j) => j.id !== data.jobId));
            } else if (data.type === 'torrent:progress') {
              setJobs((prev) =>
                prev.map((j) =>
                  j.id === data.jobId
                    ? {
                        ...j,
                        downloadedBytes: data.downloaded,
                        speed: data.speed,
                        eta: data.eta,
                        updatedAt: Date.now(),
                      }
                    : j
                )
              );
            } else if (data.type === 'torrent:status') {
              setJobs((prev) =>
                prev.map((j) =>
                  j.id === data.jobId
                    ? {
                        ...j,
                        status: data.status === 'seeding' ? 'completed' : data.status,
                        error: data.error,
                        speed: 0,
                        eta: -1,
                        updatedAt: Date.now(),
                      }
                    : j
                )
              );
            } else if (data.type === 'torrent:done') {
              setJobs((prev) =>
                prev.map((j) =>
                  j.id === data.jobId
                    ? {
                        ...j,
                        status: 'completed',
                        speed: 0,
                        eta: -1,
                        downloadedBytes: j.totalBytes,
                        updatedAt: Date.now(),
                      }
                    : j
                )
              );
            } else if (data.type === 'torrent:error') {
              setJobs((prev) =>
                prev.map((j) =>
                  j.id === data.jobId
                    ? {
                        ...j,
                        status: 'failed',
                        error: data.error,
                        speed: 0,
                        eta: -1,
                        updatedAt: Date.now(),
                      }
                    : j
                )
              );
            } else if (data.type === 'torrent:removed') {
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

  const selectedJob = jobs[selectedIndex];

  // Keyboard navigation and actions
  useInput(async (input, key) => {
    // -----------------------------------------------------------
    // DIALOG: ADD JOB INPUTS
    // -----------------------------------------------------------
    if (activeDialog === 'add-job') {
      const showFormatSelector = ytFormats.length > 0;
      const numFields = showFormatSelector ? 4 : 3;

      if (key.escape) {
        setActiveDialog(null);
        return;
      }
      if (key.tab || key.downArrow) {
        setFocusedField((prev) => ((prev + 1) % numFields));
        return;
      }
      if (key.upArrow) {
        setFocusedField((prev) => ((prev - 1 + numFields) % numFields));
        return;
      }

      // Left/Right selection for format selector
      if (showFormatSelector && focusedField === 1) {
        if (key.leftArrow) {
          setYtSelectedFormatIndex((prev) => (prev - 1 + ytFormats.length) % ytFormats.length);
          return;
        }
        if (key.rightArrow) {
          setYtSelectedFormatIndex((prev) => (prev + 1) % ytFormats.length);
          return;
        }
      }

      if (key.return) {
        if (inputUrl.trim()) {
          const url = inputUrl.trim();
          const filename = inputFilename.trim();
          const outDir = inputOutDir.trim();

          setActiveDialog(null);
          setStatusMessage('Adding download job...');

          let targetUrl = url;
          if (showFormatSelector && ytFormats[ytSelectedFormatIndex]) {
            targetUrl = url.split('#')[0] + '#format=' + encodeURIComponent(ytFormats[ytSelectedFormatIndex].value);
          }

          try {
            if (mode === 'local' && downloader) {
              await downloader.addJob(targetUrl, {
                ...(filename ? { filename } : {}),
                ...(outDir ? { outputDir: outDir } : {}),
              });
            } else {
              await fetch(`${apiBase}/jobs`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  url: targetUrl,
                  options: {
                    ...(filename ? { filename } : {}),
                    ...(outDir ? { outputDir: outDir } : {}),
                  },
                }),
              });
            }
            setStatusMessage('Job added successfully!');
          } catch (err: any) {
            setStatusMessage(`Failed to add job: ${err.message}`);
          }

          setInputUrl('');
          setInputFilename('');
          setInputOutDir('');
          setYtFormats([]);
        } else {
          setStatusMessage('URL is required!');
        }
        return;
      }

      if (key.backspace || key.delete) {
        if (focusedField === 0) setInputUrl((p) => p.slice(0, -1));
        else if (showFormatSelector && focusedField === 1) {
          // Format selection is not directly editable by typing, ignore
        } else if (focusedField === (showFormatSelector ? 2 : 1)) {
          setInputFilename((p) => p.slice(0, -1));
        } else if (focusedField === (showFormatSelector ? 3 : 2)) {
          setInputOutDir((p) => p.slice(0, -1));
        }
        return;
      }

      // Character typing & pasting support
      const cleanInput = input
        .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '') // remove ANSI escape codes
        .replace(/[\x00-\x1F\x7F-\x9F]/g, ''); // remove control codes
      if (cleanInput.length > 0) {
        if (focusedField === 0) {
          setInputUrl((p) => p + cleanInput);
        } else if (showFormatSelector && focusedField === 1) {
          // Format selector is not editable by typing
        } else if (focusedField === (showFormatSelector ? 2 : 1)) {
          setInputFilename((p) => p + cleanInput);
        } else if (focusedField === (showFormatSelector ? 3 : 2)) {
          setInputOutDir((p) => p + cleanInput);
        }
      }
      return;
    }

    // -----------------------------------------------------------
    // DIALOG: ADD TORRENT
    // -----------------------------------------------------------
    if (activeDialog === 'add-torrent') {
      if (key.escape) {
        setActiveDialog(null);
        setTorrentUrl('');
        setTorrentJob(null);
        setTorrentStatus('');
        return;
      }

      if (!torrentJob) {
        // Phase 1: URL input
        if (key.return) {
          if (torrentUrl.trim()) {
            setTorrentStatus('Adding torrent...');
            (async () => {
              try {
                let job: any;
                if (mode === 'local' && downloader) {
                  job = await downloader.addJob(torrentUrl.trim());
                } else {
                  const res = await fetch(`${apiBase}/jobs`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: torrentUrl.trim() }),
                  });
                  if (!res.ok) throw new Error(await res.text());
                  job = await res.json();
                }
                setTorrentJob(job);
                setTorrentFocusedIdx(0);
                setTorrentStatus('');
              } catch (err: any) {
                setTorrentStatus(`Error: ${err.message}`);
              }
            })();
          } else {
            setTorrentStatus('Please enter a URL or magnet link');
          }
          return;
        }

        if (key.backspace || key.delete) {
          setTorrentUrl((p) => p.slice(0, -1));
          return;
        }

        const cleanInput = input
          .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
          .replace(/[\x00-\x1F\x7F-\x9F]/g, '');
        if (cleanInput.length > 0) {
          setTorrentUrl((p) => p + cleanInput);
          return;
        }
      } else {
        // Phase 2: File selection
        const files = torrentJob.files || [];
        if (files.length === 0) {
          // No files to select, just close
          setActiveDialog(null);
          setTorrentUrl('');
          setTorrentJob(null);
          setTorrentStatus('');
          return;
        }

        if (key.upArrow) {
          setTorrentFocusedIdx((prev) => Math.max(0, prev - 1));
          return;
        }
        if (key.downArrow) {
          setTorrentFocusedIdx((prev) => Math.min(files.length - 1, prev + 1));
          return;
        }
        if (input === ' ') {
          // Toggle current file's checkbox via API
          const idx = torrentFocusedIdx;
          const currentFile = files[idx];
          if (currentFile) {
            const newSelected = !currentFile.selected;
            // Optimistic update
            const updatedFiles = [...files];
            updatedFiles[idx] = { ...currentFile, selected: newSelected };
            setTorrentJob({ ...torrentJob, files: updatedFiles });
            // Send to daemon
            try {
              const jobId = torrentJob.id;
              await fetch(`${apiBase}/torrents/${jobId}/select`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ indices: [idx], selected: newSelected }),
              });
            } catch {
              // Ignore
            }
          }
          return;
        }
        if (input === 'a') {
          // Toggle all
          const allSelected = files.every((f: any) => f.selected);
          const updatedFiles = files.map((f: any) => ({ ...f, selected: !allSelected }));
          setTorrentJob({ ...torrentJob, files: updatedFiles });
          try {
            const jobId = torrentJob.id;
            const indices = files.map((_: any, i: number) => i);
            await fetch(`${apiBase}/torrents/${jobId}/select`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ indices, selected: !allSelected }),
            });
          } catch {
            // Ignore
          }
          return;
        }
        if (key.return) {
          // Confirm and close
          setActiveDialog(null);
          setTorrentUrl('');
          setTorrentJob(null);
          setTorrentStatus('');
          setStatusMessage('Torrent added with selected files.');
          return;
        }
      }
      return;
    }

    // -----------------------------------------------------------
    // DIALOG: EXTENSIONS TABLE
    // -----------------------------------------------------------
    if (activeDialog === 'extensions') {
      if (input === 'e' || key.escape) {
        setActiveDialog(null);
      }
      return;
    }

    // -----------------------------------------------------------
    // DIALOG: DELETE CONFIRMATION
    // -----------------------------------------------------------
    if (activeDialog === 'delete-confirm') {
      if (input === 'y' || input === 'Y') {
        const id = confirmJobId;
        setActiveDialog(null);
        setConfirmJobId(null);
        if (id) {
          try {
            if (mode === 'local' && downloader) {
              await downloader.removeJob(id);
            } else {
              await fetch(`${apiBase}/jobs/${id}`, { method: 'DELETE' });
            }
            setStatusMessage('Job deleted.');
          } catch (err: any) {
            setStatusMessage(`Failed to delete job: ${err.message}`);
          }
        }
      } else if (input === 'n' || input === 'N' || key.escape) {
        setActiveDialog(null);
        setConfirmJobId(null);
      }
      return;
    }

    // -----------------------------------------------------------
    // STANDARD VIEW MODE KEY HANDLERS
    // -----------------------------------------------------------
    if (input === 'q') {
      exit();
      return;
    }

    if (input === 'e') {
      setActiveDialog('extensions');
      return;
    }

    if (input === 'a') {
      setActiveDialog('add-job');
      setFocusedField(0);
      return;
    }

    if (input === 't') {
      setActiveDialog('add-torrent');
      setTorrentUrl('');
      setTorrentJob(null);
      setTorrentStatus('');
      return;
    }

    if (input === 'c') {
      try {
        if (mode === 'local') {
          const { clearCompletedJobs } = await import('../../store/jobs');
          await clearCompletedJobs();
          const localList = await listJobs();
          setJobs(localList);
        } else {
          await fetch(`${apiBase}/jobs/clear-completed`, { method: 'POST' });
        }
        setStatusMessage('Cleared completed jobs.');
      } catch (err: any) {
        setStatusMessage(`Failed to clear jobs: ${err.message}`);
      }
      return;
    }

    if (input === 'o') {
      try {
        const checkRunning = async (port: number) => {
          try {
            const res = await fetch(`http://127.0.0.1:${port}/api/jobs`, { signal: AbortSignal.timeout(300) });
            return res.ok;
          } catch {
            return false;
          }
        };
        const isRunning = await checkRunning(serverPort);
        if (!isRunning) {
          setStatusMessage('Starting daemon...');
          const { spawn } = await import('node:child_process');
          const serverPath = path.join(process.cwd(), 'src/server/index.ts');
          const stateDir = path.join(homedir(), '.grabr');
          const pidFile = path.join(stateDir, 'daemon.pid');
          const logFile = path.join(stateDir, 'daemon.log');
          const out = fs.openSync(logFile, 'a');
          const err = fs.openSync(logFile, 'a');
          const child = spawn('bun', ['run', serverPath], {
            detached: true,
            stdio: ['ignore', out, err],
            cwd: process.cwd(),
            env: { ...process.env },
          });
          const pid = child.pid;
          if (pid) {
            fs.writeFileSync(pidFile, pid.toString(), 'utf-8');
          }
          child.unref();
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        const os = process.platform;
        const url = `http://127.0.0.1:${serverPort}`;
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
    if (!selectedJob) return;

    if (key.upArrow) {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
    } else if (key.downArrow) {
      setSelectedIndex((prev) => Math.min(jobs.length - 1, prev + 1));
    } else if (key.return) {
      // Open output folder in default file manager
      try {
        const os = process.platform;
        const folder = selectedJob.destination;
        const { spawn } = await import('node:child_process');
        if (os === 'darwin') {
          spawn('open', [folder], { stdio: 'ignore', detached: true }).unref();
        } else if (os === 'win32') {
          spawn('explorer', [folder], { stdio: 'ignore', detached: true }).unref();
        } else {
          spawn('xdg-open', [folder], { stdio: 'ignore', detached: true }).unref();
        }
        setStatusMessage(`Opened folder: ${folder}`);
      } catch (err: any) {
        setStatusMessage(`Failed to open folder: ${err.message}`);
      }
    } else if (input === 'p') {
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
      setConfirmJobId(selectedJob.id);
      setActiveDialog('delete-confirm');
    }
  });

  const activeDownloads = jobs.filter((j) => j.status === 'downloading');
  const overallSpeed = activeDownloads.reduce((sum, j) => sum + j.speed, 0);

  return (
    <Box flexDirection="column" padding={1} minHeight={18}>
      {/* 1. Header Panel */}
      <Box borderStyle="round" borderColor="cyan" paddingX={2} paddingY={0} marginBottom={1} flexDirection="row" justifyContent="space-between" alignItems="center">
        <Box flexDirection="column" paddingY={1}>
          <Text color="cyan" bold>
            {" █▀▀ █▀█ ▄▀█ █▄▄ █▀█\n" +
             " █▄█ █▀▄ █▀█ █▄█ █▀▄"}
          </Text>
          <Text color="gray">  Modern local-first downloader</Text>
        </Box>
        <Box flexDirection="column" alignItems="flex-end">
          <Box flexDirection="row">
            <Text color="cyan" bold>● </Text>
            <Text color="white" bold>{mode === 'local' ? 'Standalone' : 'Daemon Mode'}</Text>
          </Box>
          <Text color="gray">Port: {serverPort} | v{currentVersion}</Text>
          <Box flexDirection="row">
            <Text color="gray">Speed: </Text>
            <Text color="yellow" bold>{formatSpeed(overallSpeed)}</Text>
            <Text color="gray"> ({activeDownloads.length} active)</Text>
          </Box>
        </Box>
      </Box>

      {/* 2. Version alerts */}
      {latestVersion && isNewerVersion(currentVersion, latestVersion) && (
        <Box borderStyle="round" borderColor="green" paddingX={2} marginBottom={1}>
          <Text color="green" bold>✨ Update Available: v{latestVersion} | npm install -g @linuxctrl/grabr</Text>
        </Box>
      )}

      {/* 3. Main Split Area */}
      {activeDialog === 'add-job' ? (
        // Add Job Form View
        <Box borderStyle="round" borderColor="cyan" padding={1} flexDirection="column" flexGrow={1}>
          <Box marginBottom={1}>
            <Text color="cyan" bold>➕ ADD NEW DOWNLOAD JOB</Text>
          </Box>
          <FormInput label="URL" value={inputUrl} isFocused={focusedField === 0} placeholder="Paste link URL here..." />
          
          {isAnalyzingYt && (
            <Box marginY={1}>
              <Text color="yellow">⏳ Analyzing YouTube video formats... Please wait...</Text>
            </Box>
          )}

          {ytAnalysisError && (
            <Box marginY={1}>
              <Text color="red">✗ YouTube analysis failed: {ytAnalysisError}</Text>
            </Box>
          )}

          {ytFormats.length > 0 && (
            <Box flexDirection="row" marginBottom={0}>
              <Text color={focusedField === 1 ? 'cyan' : 'gray'} bold={focusedField === 1}>
                {focusedField === 1 ? '▶ ' : '  '}
                {"Choose Format".padEnd(15)}:{' '}
              </Text>
              {focusedField === 1 ? (
                <Box borderStyle="single" borderColor="cyan" paddingX={1}>
                  <Text color="white" bold>◀ {ytFormats[ytSelectedFormatIndex]?.label} ▶</Text>
                  <Text color="gray"> ({ytSelectedFormatIndex + 1}/{ytFormats.length})</Text>
                </Box>
              ) : (
                <Text color="white">{ytFormats[ytSelectedFormatIndex]?.label}</Text>
              )}
            </Box>
          )}

          <FormInput 
            label="Custom Name" 
            value={inputFilename} 
            isFocused={focusedField === (ytFormats.length > 0 ? 2 : 1)} 
            placeholder="Custom filename (optional)..." 
          />
          <FormInput 
            label="Save Dir" 
            value={inputOutDir} 
            isFocused={focusedField === (ytFormats.length > 0 ? 3 : 2)} 
            placeholder="Absolute directory path (optional)..." 
          />
          
          <Box marginTop={1} flexDirection="row" justifyContent="space-between">
            <Text color="gray">
              {focusedField === 1 && ytFormats.length > 0
                ? '◀/▶ change format | [Tab] cycle fields'
                : '[Tab] cycle fields'}
            </Text>
            <Text color="gray">[Enter] submit | [Esc] cancel</Text>
          </Box>
        </Box>
      ) : activeDialog === 'add-torrent' ? (
        <Box borderStyle="round" borderColor="green" padding={1} flexDirection="column" flexGrow={1}>
          {!torrentJob ? (
            // Phase 1: URL input
            <Box flexDirection="column">
              <Box marginBottom={1}>
                <Text color="green" bold>🧲 ADD TORRENT</Text>
              </Box>
              <Box flexDirection="row" marginBottom={1}>
                <Text color="gray" bold>  Magnet URL or torrent file:{' '}</Text>
              </Box>
              <Box borderStyle="single" borderColor="green" paddingX={1}>
                <Text color="white">{torrentUrl || ''}</Text>
                <Text color="green" bold>█</Text>
              </Box>
              {torrentStatus ? (
                <Box marginTop={1}>
                  <Text color={torrentStatus.startsWith('Error') ? 'red' : 'yellow'}>{torrentStatus === 'Adding torrent...' ? '⏳ ' : '✗ '}{torrentStatus}</Text>
                </Box>
              ) : null}
              <Box marginTop={1} flexDirection="row" justifyContent="space-between">
                <Text color="gray">Type URL or magnet link</Text>
                <Text color="gray">[Enter] submit | [Esc] cancel</Text>
              </Box>
            </Box>
          ) : (
            // Phase 2: File selection
            <Box flexDirection="column">
              <Box marginBottom={1}>
                <Text color="green" bold>📁 FILES: {torrentJob.name || torrentJob.id}</Text>
              </Box>
              <Box flexDirection="column" marginBottom={1}>
                {(torrentJob.files || []).map((f: any, i: number) => {
                  const isFocused = i === torrentFocusedIdx;
                  const mark = f.selected ? '✓' : '✗';
                  return (
                    <Box key={i} flexDirection="row">
                      <Text color={isFocused ? 'green' : 'gray'}>{isFocused ? '▶ ' : '  '}</Text>
                      <Text color={f.selected ? 'green' : 'red'} bold>{mark} </Text>
                      <Text color={isFocused ? 'white' : 'gray'} wrap="truncate-end">
                        {formatBytes(f.length).padStart(9)}  {f.path}
                      </Text>
                    </Box>
                  );
                })}
              </Box>
              <Box flexDirection="row" justifyContent="space-between">
                <Text color="gray">[↑↓] navigate | [Space] toggle file | [a] toggle all</Text>
                <Text color="gray">[Enter] confirm | [Esc] cancel</Text>
              </Box>
            </Box>
          )}
        </Box>
      ) : activeDialog === 'extensions' ? (
        // Extensions Table View
        <Box borderStyle="round" borderColor="cyan" padding={1} flexDirection="column" flexGrow={1}>
          <Box marginBottom={1}>
            <Text color="cyan" bold>🧩 GRABR BROWSER EXTENSIONS</Text>
          </Box>
          <Box flexDirection="column" paddingX={2} paddingY={1}>
            <Box flexDirection="row" gap={4} marginBottom={1}>
              <Text color="gray" bold>Browser</Text>
              <Text color="gray" bold>Store Link / Status</Text>
            </Box>
            <Box flexDirection="row" gap={4} marginBottom={1}>
              <Text color="green" bold>Firefox</Text>
              <Text color="white">https://addons.mozilla.org/fr/firefox/addon/grabr-integration/</Text>
              <Text color="green">✓</Text>
            </Box>
            <Box flexDirection="row" gap={4} marginBottom={1}>
              <Text color="yellow" bold>Chrome</Text>
              <Text color="gray">— (coming soon)</Text>
            </Box>
            <Box flexDirection="row" gap={4} marginBottom={1}>
              <Text color="yellow" bold>Edge</Text>
              <Text color="gray">— (coming soon)</Text>
            </Box>
          </Box>
          <Box marginTop={1}>
            <Text color="gray">[e] or [Esc] close</Text>
          </Box>
        </Box>
      ) : activeDialog === 'delete-confirm' && confirmJobId ? (
        // Delete Confirm View
        <Box borderStyle="round" borderColor="red" padding={1} flexDirection="column" flexGrow={1} alignItems="center" justifyContent="center">
          <Text color="red" bold>⚠️ DELETE CONFIRMATION</Text>
          <Box marginY={1}>
            <Text color="white">
              Are you sure you want to remove "{jobs.find((j) => j.id === confirmJobId)?.filename}"?
            </Text>
          </Box>
          <Box flexDirection="row">
            <Text color="red" bold>[y] Yes, Delete</Text>
            <Text color="gray">    |    </Text>
            <Text color="green" bold>[n] No, Keep</Text>
          </Box>
        </Box>
      ) : (
        // Standard View: List + Details Pane
        <Box flexDirection="row" flexGrow={1} gap={2}>
          {/* Queue List Pane */}
          <Box borderStyle="round" borderColor="gray" flexDirection="column" width={68} padding={0}>
            <Box borderStyle="single" borderBottom borderColor="gray" paddingX={1}>
              <Text color="gray" bold>QUEUE LIST ({jobs.length} jobs)</Text>
            </Box>
            <Box flexDirection="column" paddingY={0}>
              {jobs.length === 0 ? (
                <Box height={5} justifyContent="center" alignItems="center">
                  <Text color="gray">No jobs in queue. Press 'a' to add one!</Text>
                </Box>
              ) : (
                jobs.map((job, idx) => (
                  <JobRow key={job.id} job={job} isSelected={idx === selectedIndex} />
                ))
              )}
            </Box>
          </Box>

          {/* Details Pane */}
          <Box borderStyle="round" borderColor="gray" flexDirection="column" flexGrow={1} padding={1}>
            <Box marginBottom={1}>
              <Text color="gray" bold>JOB DETAILS</Text>
            </Box>
            {selectedJob ? (
              <Box flexDirection="column">
                <Box marginBottom={1}>
                  <Text color="cyan" bold wrap="truncate-end">{selectedJob.filename}</Text>
                </Box>
                <Box marginBottom={1}>
                  <Text color="gray">ID: {selectedJob.id}</Text>
                </Box>
                
                <Box flexDirection="row" justifyContent="space-between">
                  <Text color="gray">Status:</Text>
                  <Text color="white" bold>{selectedJob.status.toUpperCase()}</Text>
                </Box>

                <Box flexDirection="row" justifyContent="space-between">
                  <Text color="gray">Size:</Text>
                  <Text color="white">
                    {formatBytes(selectedJob.downloadedBytes)} / {selectedJob.totalBytes > 0 ? formatBytes(selectedJob.totalBytes) : 'Unknown'}
                  </Text>
                </Box>

                {selectedJob.status === 'downloading' && (
                  <>
                    <Box flexDirection="row" justifyContent="space-between">
                      <Text color="gray">Speed:</Text>
                      <Text color="yellow" bold>{formatSpeed(selectedJob.speed)}</Text>
                    </Box>
                    <Box flexDirection="row" justifyContent="space-between">
                      <Text color="gray">ETA:</Text>
                      <Text color="yellow" bold>{formatETA(selectedJob.eta)}</Text>
                    </Box>
                  </>
                )}

                <Box flexDirection="column" marginTop={1}>
                  <Text color="gray">Save Destination:</Text>
                  <Text color="white" wrap="truncate-middle">{selectedJob.destination}</Text>
                </Box>

                {/* Worker chunks visualizer */}
                {selectedJob.chunks && selectedJob.chunks.length > 0 && (
                  <Box flexDirection="column" marginTop={1}>
                    <Text color="gray">Worker Chunks:</Text>
                    <Box flexDirection="row" flexWrap="wrap" marginTop={0}>
                      {selectedJob.chunks.map((chunk, idx) => {
                        let char = '░';
                        let color = 'gray';
                        if (chunk.status === 'done') {
                          char = '█';
                          color = 'green';
                        } else if (chunk.status === 'downloading') {
                          char = '▒';
                          color = 'yellow';
                        } else if (chunk.status === 'failed') {
                          char = '✗';
                          color = 'red';
                        }
                        return <Text key={idx} color={color}>{char}</Text>;
                      })}
                    </Box>
                  </Box>
                )}
              </Box>
            ) : (
              <Box height={5} justifyContent="center" alignItems="center">
                <Text color="gray" italic>Select a job to view details</Text>
              </Box>
            )}
          </Box>
        </Box>
      )}

      {/* 4. Status Log Message */}
      {statusMessage && (
        <Box marginTop={1} paddingX={1}>
          <Text color="yellow">⚠️ {statusMessage}</Text>
        </Box>
      )}

      {/* 5. Footer Shortcut Legend */}
      <Box borderStyle="double" borderColor="gray" paddingX={1} marginTop={1} flexDirection="row" justifyContent="space-between">
        <Text color="gray">
          <Text color="cyan" bold>q</Text> quit | <Text color="cyan" bold>e</Text> extensions | <Text color="cyan" bold>a</Text> add url | <Text color="cyan" bold>t</Text> add torrent | <Text color="cyan" bold>p</Text> pause | <Text color="cyan" bold>r</Text> resume | <Text color="cyan" bold>x</Text> delete | <Text color="cyan" bold>c</Text> clear completed | <Text color="cyan" bold>Enter</Text> open folder | <Text color="cyan" bold>o</Text> web ui | <Text color="cyan" bold>↑↓</Text> navigate
        </Text>
        <Text color="gray">
          Total: {jobs.length} jobs
        </Text>
      </Box>
    </Box>
  );
}
