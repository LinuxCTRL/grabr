import { loadConfig, saveConfig } from '../../core/config';

export async function configCommand(args: string[]) {
  const subcommand = args[0];

  if (!subcommand || subcommand === 'list' || subcommand === 'show') {
    const config = loadConfig();
    console.log('\n  Grabr Configuration:\n');
    console.log(`  outputDir        ${config.outputDir}`);
    console.log(`  maxConcurrent    ${config.maxConcurrent}`);
    console.log(`  defaultChunks    ${config.defaultChunks}`);
    console.log(`  serverPort       ${config.serverPort}`);
    console.log(`  theme            ${config.theme}`);
    console.log('');
    console.log(`  Torrent:`);
    console.log(`    downloadDir         ${config.torrent.downloadDir}`);
    console.log(`    maxPeers            ${config.torrent.maxPeers}`);
    console.log(`    seedRatio           ${config.torrent.seedRatio}`);
    console.log(`    seedTime            ${config.torrent.seedTime}`);
    console.log(`    dhtEnabled          ${config.torrent.dhtEnabled}`);
    console.log(`    sequentialDownload  ${config.torrent.sequentialDownload}`);
    console.log(`    trackers            ${config.torrent.trackers.length > 0 ? config.torrent.trackers.join(', ') : '(none)'}`);
    console.log('');
    return;
  }

  if (subcommand === 'set') {
    const key = args[1];
    const value = args[2];

    if (!key || value === undefined) {
      console.error('Usage: grabr config set <key> <value>');
      console.error('');
      console.error('Examples:');
      console.error('  grabr config set maxConcurrent 5');
      console.error('  grabr config set theme light');
      console.error('  grabr config set torrent.seedRatio 2.0');
      console.error('  grabr config set torrent.dhtEnabled false');
      console.error('  grabr config set torrent.trackers udp://tracker.opentrackr.org:1337');
      return;
    }

    const config = loadConfig();

    if (key.startsWith('torrent.')) {
      const torrentKey = key.slice(8);
      const torrentUpdate: any = {};

      if (torrentKey === 'dhtEnabled' || torrentKey === 'sequentialDownload') {
        torrentUpdate[torrentKey] = value === 'true' || value === '1';
      } else if (torrentKey === 'maxPeers' || torrentKey === 'seedTime') {
        torrentUpdate[torrentKey] = parseInt(value, 10) || 0;
      } else if (torrentKey === 'seedRatio') {
        torrentUpdate.seedRatio = parseFloat(value) || 0;
      } else if (torrentKey === 'trackers') {
        torrentUpdate.trackers = value.split(',').map((s: string) => s.trim()).filter(Boolean);
      } else if (torrentKey === 'downloadDir') {
        torrentUpdate.downloadDir = value;
      } else {
        console.error(`Unknown torrent config key: ${torrentKey}`);
        return;
      }

      saveConfig({ torrent: torrentUpdate });
      console.log(`Set torrent.${torrentKey} = ${JSON.stringify(torrentUpdate[torrentKey])}`);
    } else if (key === 'outputDir') {
      saveConfig({ outputDir: value });
      console.log(`Set ${key} = ${value}`);
    } else if (key === 'maxConcurrent' || key === 'defaultChunks' || key === 'serverPort') {
      const numVal = parseInt(value, 10);
      if (isNaN(numVal)) {
        console.error(`${key} must be a number`);
        return;
      }
      saveConfig({ [key]: numVal } as any);
      console.log(`Set ${key} = ${numVal}`);
    } else if (key === 'theme') {
      if (value !== 'dark' && value !== 'light') {
        console.error('theme must be "dark" or "light"');
        return;
      }
      saveConfig({ theme: value });
      console.log(`Set ${key} = ${value}`);
    } else {
      console.error(`Unknown config key: ${key}`);
      console.error('Run "grabr config" to see available keys.');
    }
    return;
  }

  console.error('Usage: grabr config [list|set <key> <value>]');
}
