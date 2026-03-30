import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'aiweb.mobile.flags';

const defaultFlags = {
  biometricLogin: true,
  cameraUpload: true,
  realtimeSync: false,
};

let inMemoryFlags = { ...defaultFlags };

export async function warmFeatureFlags() {
  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  if (stored) {
    inMemoryFlags = { ...inMemoryFlags, ...JSON.parse(stored) };
  }
}

export function evaluateFlagsForUser(userId: string) {
  const rollout = hashToBucket(userId);
  inMemoryFlags = {
    ...inMemoryFlags,
    realtimeSync: rollout < 10,
  };
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(inMemoryFlags));
  return inMemoryFlags;
}

export function getFeatureFlags() {
  return inMemoryFlags;
}

function hashToBucket(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash % 100;
}
