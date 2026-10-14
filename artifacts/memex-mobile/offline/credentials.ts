import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export interface AuthUser { id: number; email: string; name: string; role: string }
export interface SavedSession { server: string; cookie: string; user: AuthUser; offlineUntil: number }
export const OFFLINE_ACCESS_MS = 7 * 24 * 60 * 60 * 1000;
const KEY = 'memex-session-v2';

export async function loadSession(): Promise<SavedSession | null> {
  const value = Platform.OS === 'web' ? await AsyncStorage.getItem(KEY) : await SecureStore.getItemAsync(KEY);
  if (!value) return null;
  const session = JSON.parse(value) as SavedSession;
  if (!session.server || !session.cookie || !Number.isSafeInteger(session.user?.id) || !Number.isFinite(session.offlineUntil)) {
    throw new Error('Stored sign-in data is invalid. Please sign in again.');
  }
  return session;
}
export async function saveSession(session: SavedSession) {
  const value = JSON.stringify(session);
  if (Platform.OS === 'web') await AsyncStorage.setItem(KEY, value);
  else await SecureStore.setItemAsync(KEY, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
}
export async function deleteSession() {
  if (Platform.OS === 'web') await AsyncStorage.removeItem(KEY);
  else await SecureStore.deleteItemAsync(KEY);
}
