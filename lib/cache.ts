import NodeCache from 'node-cache';

export const cache = new NodeCache({
  stdTTL: 30,
  checkperiod: 60,
  useClones: false,
});

export const CK = {
  sessions: () => 'sessions:all',
  daemon: () => 'daemon:status',
  stats: (chatroomId: string, since: string, until: string) =>
    `stats:${chatroomId}:${since}:${until}`,
  statsRange: (since: string, until: string) => `stats-range:${since}:${until}`,
} as const;
