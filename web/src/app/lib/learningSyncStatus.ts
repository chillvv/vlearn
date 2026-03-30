export type LearningSyncState = 'idle' | 'syncing' | 'synced' | 'error';

export type LearningSyncSnapshot = {
  state: LearningSyncState;
  updatedAt: number;
  message: string;
};

let snapshot: LearningSyncSnapshot = {
  state: 'idle',
  updatedAt: Date.now(),
  message: '未开始同步',
};

const listeners = new Set<(value: LearningSyncSnapshot) => void>();

export function getLearningSyncSnapshot() {
  return snapshot;
}

export function setLearningSyncSnapshot(next: Partial<LearningSyncSnapshot>) {
  snapshot = {
    ...snapshot,
    ...next,
    updatedAt: Date.now(),
  };
  listeners.forEach((listener) => listener(snapshot));
}

export function subscribeLearningSyncSnapshot(listener: (value: LearningSyncSnapshot) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
