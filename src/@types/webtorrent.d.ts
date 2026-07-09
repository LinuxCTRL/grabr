declare module 'webtorrent' {
  import { EventEmitter } from 'node:events';

  interface TorrentFile {
    name: string;
    path: string;
    length: number;
    downloaded: number;
    progress: number;
    select: (sequential?: boolean) => void;
    deselect: () => void;
    createReadStream: (opts?: { start?: number; end?: number }) => NodeJS.ReadableStream;
  }

  interface Torrent {
    infoHash: string;
    magnetURI: string;
    name: string;
    length: number;
    downloaded: number;
    uploadSpeed: number;
    downloadSpeed: number;
    progress: number;
    ratio: number;
    numPeers: number;
    timeRemaining: number;
    received: number;
    files: TorrentFile[];
    pause: () => void;
    resume: () => void;
    destroy: (cb?: () => void) => void;
    on(event: 'download', listener: (bytes: number) => void): this;
    on(event: 'upload', listener: (bytes: number) => void): this;
    on(event: 'done', listener: () => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
    on(event: 'warning', listener: (err: Error) => void): this;
    on(event: 'metadata', listener: () => void): this;
    on(event: 'ready', listener: () => void): this;
  }

  interface Instance extends EventEmitter {
    torrents: Torrent[];
    add(
      torrentId: string | Buffer,
      opts?: { path?: string; announce?: string[]; maxWebConns?: number },
      ontorrent?: (torrent: Torrent) => void
    ): Torrent;
    seed(
      input: string | string[] | Buffer,
      opts?: { name?: string; path?: string; announce?: string[] },
      onseed?: (torrent: Torrent) => void
    ): Torrent;
    remove(torrentId: string | Buffer, cb?: (err?: Error) => void): void;
    destroy(cb?: () => void): void;
  }

  interface Options {
    maxConns?: number;
    nodeId?: string | Buffer;
    peerId?: string | Buffer;
    tracker?: boolean | Record<string, any>;
    dht?: boolean | Record<string, any>;
    webSeeds?: boolean;
    path?: string;
  }

  const WebTorrent: new (opts?: Options) => Instance;
  export default WebTorrent;
  export type { Instance as WebTorrentInstance, Torrent, TorrentFile, Options };
}
