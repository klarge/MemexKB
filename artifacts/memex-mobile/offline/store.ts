import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { fromByteArray } from 'base64-js';
import { scopeKey } from './content';
import type { CacheScope, CachedArticle, OfflineStore } from './types';

/** One serialized I/O queue ensures clearing an identity runs after any
 * already-started write, and stale queued writes cannot recreate its files. */
export class DeviceOfflineStore implements OfflineStore {
  private queue: Promise<unknown> = Promise.resolve();
  private directories = new Map<string, Promise<string>>();
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }
  private async directory(scope: CacheScope) {
    const key = scopeKey(scope);
    if (!this.directories.has(key)) this.directories.set(key, (async () => {
      if (!FileSystem.documentDirectory) throw new Error('Private device storage is unavailable.');
      const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, key);
      return `${FileSystem.documentDirectory}offline-kb/${hash}/`;
    })());
    return this.directories.get(key)!;
  }
  private async index(scope: CacheScope): Promise<Record<string, string>> {
    const value = await AsyncStorage.getItem(`${scopeKey(scope)}/index`);
    return value ? JSON.parse(value) : {};
  }
  async load(scope: CacheScope) {
    return this.serial(async () => {
      const index = await this.index(scope);
      const articles: CachedArticle[] = [];
      const directory = Platform.OS === 'web' ? '' : await this.directory(scope);
      for (const [id, file] of Object.entries(index)) {
        const json = Platform.OS === 'web'
          ? await AsyncStorage.getItem(`${scopeKey(scope)}/article/${id}`)
          : await FileSystem.readAsStringAsync(`${directory}${file}`);
        if (!json) continue;
        const article = JSON.parse(json) as CachedArticle;
        if (String(article.id) !== id || typeof article.slug !== 'string' || article.canAccess !== true) {
          throw new Error('Saved article metadata is invalid. Refresh your downloads.');
        }
        if (Platform.OS !== 'web') for (const [path, uri] of Object.entries(article.assetFiles ?? {})) {
          if (!uri.startsWith(directory) || !(await FileSystem.getInfoAsync(uri)).exists) {
            delete article.assetFiles![path];
            article.downloadComplete = false;
            article.downloadError = 'A saved image is missing. Download this article again.';
          }
        }
        articles.push(article);
      }
      return { articles, lastSyncedAt: await AsyncStorage.getItem(`${scopeKey(scope)}/last-refresh`) };
    });
  }
  async save(scope: CacheScope, article: CachedArticle, current: () => boolean) {
    return this.serial(async () => {
      if (!current()) return;
      const index = await this.index(scope);
      if (!current()) return;
      if (Platform.OS === 'web') {
        await AsyncStorage.setItem(`${scopeKey(scope)}/article/${article.id}`, JSON.stringify(article));
        if (!current()) return;
        index[article.id] = String(article.id);
        await AsyncStorage.setItem(`${scopeKey(scope)}/index`, JSON.stringify(index));
      } else {
        const directory = await this.directory(scope);
        await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
        if (!current()) return;
        // Publish an immutable file only after it is fully written. A crash
        // before the index update leaves the prior document intact.
        const file = `article-${article.id}-${Crypto.randomUUID()}.json`;
        await FileSystem.writeAsStringAsync(`${directory}${file}`, JSON.stringify(article));
        if (!current()) {
          await FileSystem.deleteAsync(`${directory}${file}`, { idempotent: true });
          return;
        }
        const previous = index[article.id];
        index[article.id] = file;
        await AsyncStorage.setItem(`${scopeKey(scope)}/index`, JSON.stringify(index));
        if (previous) await FileSystem.deleteAsync(`${directory}${previous}`, { idempotent: true });
      }
    });
  }
  async remove(scope: CacheScope, article: CachedArticle, current: () => boolean) {
    return this.serial(async () => {
      if (!current()) return;
      const index = await this.index(scope);
      const previous = index[article.id];
      delete index[article.id];
      if (!current()) return;
      await AsyncStorage.setItem(`${scopeKey(scope)}/index`, JSON.stringify(index));
      if (Platform.OS === 'web') {
        await AsyncStorage.removeItem(`${scopeKey(scope)}/article/${article.id}`);
      } else {
        const directory = await this.directory(scope);
        if (previous) await FileSystem.deleteAsync(`${directory}${previous}`, { idempotent: true });
        await FileSystem.deleteAsync(`${directory}assets-${article.id}/`, { idempotent: true });
      }
    });
  }
  async clear(scope: CacheScope) {
    return this.serial(async () => {
      const keys = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith(`${scopeKey(scope)}/`));
      await AsyncStorage.multiRemove(keys);
      if (Platform.OS !== 'web') await FileSystem.deleteAsync(await this.directory(scope), { idempotent: true });
    });
  }
  async timestamp(scope: CacheScope, value: string, current: () => boolean) {
    return this.serial(async () => { if (current()) await AsyncStorage.setItem(`${scopeKey(scope)}/last-refresh`, value); });
  }
  async asset(scope: CacheScope, articleId: number, path: string, bytes: Uint8Array, current: () => boolean) {
    return this.serial(async () => {
      if (!current()) throw new Error('Download cancelled.');
      // The web preview uses durable data URLs, not blob URLs which die on restart.
      const encoded = fromByteArray(bytes);
      if (Platform.OS === 'web') {
        const mime = bytes[0] === 255 ? 'image/jpeg' : bytes[0] === 71 ? 'image/gif' : bytes[0] === 82 ? 'image/webp' : 'image/png';
        return `data:${mime};base64,${encoded}`;
      }
      const directory = `${await this.directory(scope)}assets-${articleId}/`;
      await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
      if (!current()) throw new Error('Download cancelled.');
      const name = `${path.split('/').pop()}.image`;
      const uri = `${directory}${name}`;
      await FileSystem.writeAsStringAsync(uri, encoded, { encoding: FileSystem.EncodingType.Base64 });
      return uri;
    });
  }
  async forgetAsset(scope: CacheScope, articleId: number, path: string, current: () => boolean) {
    return this.serial(async () => {
      if (!current() || Platform.OS === 'web') return;
      const directory = await this.directory(scope);
      if (current()) await FileSystem.deleteAsync(`${directory}assets-${articleId}/${path.split('/').pop()}.image`, { idempotent: true });
    });
  }
}
