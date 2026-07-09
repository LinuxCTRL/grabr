import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';

export interface TorrentConfig {
  downloadDir: string;
  maxPeers: number;
  seedRatio: number;
  seedTime: number;
  dhtEnabled: boolean;
  sequentialDownload: boolean;
  trackers: string[];
}

export interface GrabrConfig {
  outputDir: string;
  maxConcurrent: number;
  defaultChunks: number;
  serverPort: number;
  theme: string;
  torrent: TorrentConfig;
}

const configDir = join(homedir(), '.grabr');
const configPath = join(configDir, 'config.json');

/**
 * Resolves the default downloads directory in a cross-platform manner,
 * respecting localized system folders for Windows, macOS, and Linux
 * (including languages like Arabic, Portuguese, French, and Spanish).
 */
export function getDefaultDownloadsDir(): string {
  const home = homedir();
  const currentPlatform = platform();

  // 1. Linux XDG User Directories Check
  if (currentPlatform === 'linux') {
    const xdgConfigPath = join(home, '.config', 'user-dirs.dirs');
    if (existsSync(xdgConfigPath)) {
      try {
        const content = readFileSync(xdgConfigPath, 'utf-8');
        const match = content.match(/^XDG_DOWNLOAD_DIR="([^"]+)"/m);
        if (match && match[1]) {
          let xdgPath = match[1];
          // Replace $HOME or ${HOME} references with the actual home path
          xdgPath = xdgPath.replace(/\$HOME|\$\{HOME\}/g, home);
          if (existsSync(xdgPath)) {
            return xdgPath;
          }
        }
      } catch {
        // Fall back to manual checks if reading XDG config fails
      }
    }
  }

  // 2. Standard "Downloads" path check (typical for Windows, macOS, and standard Linux)
  const standardDownloads = join(home, 'Downloads');
  if (existsSync(standardDownloads)) {
    return standardDownloads;
  }

  // 3. Fallback check for common localized Downloads folder names on different OS locales
  const localizedNames = [
    'Downloads',
    'Transferências', // Portuguese
    'التنزيلات',       // Arabic
    'Téléchargements', // French
    'Descargas',       // Spanish
    'Download'         // German / Alternative
  ];

  for (const name of localizedNames) {
    const candidate = join(home, name);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  // 4. Default fallback if no directory matches
  return standardDownloads;
}

const defaultConfig: GrabrConfig = {
  outputDir: getDefaultDownloadsDir(),
  maxConcurrent: 3,
  defaultChunks: 4,
  serverPort: 7474,
  theme: 'dark',
  torrent: {
    downloadDir: join(homedir(), '.grabr', 'torrents'),
    maxPeers: 100,
    seedRatio: 0,
    seedTime: 0,
    dhtEnabled: true,
    sequentialDownload: false,
    trackers: [],
  },
};

export function loadConfig(): GrabrConfig {
  if (!existsSync(configDir)) {
    try {
      mkdirSync(configDir, { recursive: true });
    } catch {
      // Fallback if home directory is read-only
    }
  }

  if (!existsSync(configPath)) {
    try {
      writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), 'utf-8');
    } catch {
      // Ignore write error
    }
    return defaultConfig;
  }

  try {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    
    let outputDir = parsed.outputDir || defaultConfig.outputDir;
    
    // Migration: If the outputDir points to the old default project-relative downloads folder,
    // automatically migrate it to the user's home Downloads folder.
    if (outputDir.endsWith('grabr/downloads')) {
      outputDir = getDefaultDownloadsDir();
      try {
        const updated = { ...parsed, outputDir };
        writeFileSync(configPath, JSON.stringify(updated, null, 2), 'utf-8');
      } catch {
        // Ignore write error
      }
    }

    if (outputDir.startsWith('~/')) {
      outputDir = join(homedir(), outputDir.slice(2));
    }

    const torrentParsed = parsed.torrent || {};
    return {
      outputDir,
      maxConcurrent: parsed.maxConcurrent ?? defaultConfig.maxConcurrent,
      defaultChunks: parsed.defaultChunks ?? defaultConfig.defaultChunks,
      serverPort: parsed.serverPort ?? defaultConfig.serverPort,
      theme: parsed.theme ?? defaultConfig.theme,
      torrent: {
        downloadDir: torrentParsed.downloadDir ?? defaultConfig.torrent.downloadDir,
        maxPeers: torrentParsed.maxPeers ?? defaultConfig.torrent.maxPeers,
        seedRatio: torrentParsed.seedRatio ?? defaultConfig.torrent.seedRatio,
        seedTime: torrentParsed.seedTime ?? defaultConfig.torrent.seedTime,
        dhtEnabled: torrentParsed.dhtEnabled ?? defaultConfig.torrent.dhtEnabled,
        sequentialDownload: torrentParsed.sequentialDownload ?? defaultConfig.torrent.sequentialDownload,
        trackers: torrentParsed.trackers ?? defaultConfig.torrent.trackers,
      },
    };
  } catch (err) {
    return defaultConfig;
  }
}

export function saveConfig(config: Partial<GrabrConfig> & { torrent?: Partial<TorrentConfig> }): void {
  const current = loadConfig();
  const updated = {
    ...current,
    ...config,
    torrent: { ...current.torrent, ...(config.torrent || {}) },
  };
  try {
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }
    writeFileSync(configPath, JSON.stringify(updated, null, 2), 'utf-8');
  } catch (err) {
    // Ignore write error
  }
}
