import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface GrabrConfig {
  outputDir: string;
  maxConcurrent: number;
  defaultChunks: number;
  serverPort: number;
  theme: string;
}

const configDir = join(homedir(), '.grabr');
const configPath = join(configDir, 'config.json');

const defaultConfig: GrabrConfig = {
  outputDir: join(process.cwd(), 'downloads'),
  maxConcurrent: 3,
  defaultChunks: 4,
  serverPort: 7474,
  theme: 'dark',
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
    if (outputDir.startsWith('~/')) {
      outputDir = join(homedir(), outputDir.slice(2));
    }

    return {
      outputDir,
      maxConcurrent: parsed.maxConcurrent ?? defaultConfig.maxConcurrent,
      defaultChunks: parsed.defaultChunks ?? defaultConfig.defaultChunks,
      serverPort: parsed.serverPort ?? defaultConfig.serverPort,
      theme: parsed.theme ?? defaultConfig.theme,
    };
  } catch (err) {
    return defaultConfig;
  }
}

export function saveConfig(config: Partial<GrabrConfig>): void {
  const current = loadConfig();
  const updated = { ...current, ...config };
  try {
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }
    writeFileSync(configPath, JSON.stringify(updated, null, 2), 'utf-8');
  } catch (err) {
    // Ignore write error
  }
}
