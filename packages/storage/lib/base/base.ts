import { SessionAccessLevelEnum, StorageEnum } from './enums.js';
import type { BaseStorageType, StorageConfigType, ValueOrUpdateType } from './types.js';

/**
 * Chrome reference error while running `processTailwindFeatures` in tailwindcss.
 *  To avoid this, we need to check if globalThis.chrome is available and add fallback logic.
 */
const chrome = globalThis.chrome?.storage ? globalThis.chrome : undefined;
let webDatabase: Promise<IDBDatabase> | undefined;
const webChannel =
  !chrome && typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined'
    ? new BroadcastChannel('read-later-storage')
    : undefined;
const openWebDatabase = () => {
  if (!webDatabase)
    webDatabase = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('read-later', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('settings');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        webDatabase = undefined;
        reject(request.error);
      };
    });
  return webDatabase;
};
const readWebValue = async (key: string): Promise<unknown> => {
  if (typeof indexedDB !== 'undefined') {
    const db = await openWebDatabase();
    const value = await new Promise<unknown>((resolve, reject) => {
      const request = db.transaction('settings', 'readonly').objectStore('settings').get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (value !== undefined) return value;
  }
  const raw = globalThis.localStorage?.getItem(key);
  return raw ? JSON.parse(raw) : undefined;
};
const writeWebValue = async (key: string, value: unknown) => {
  if (typeof indexedDB !== 'undefined') {
    const db = await openWebDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('settings', 'readwrite');
      transaction.objectStore('settings').put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } else if (globalThis.localStorage) localStorage.setItem(key, JSON.stringify(value));
  webChannel?.postMessage(key);
};

/**
 * Sets or updates an arbitrary cache with a new value or the result of an update function.
 */
const updateCache = async <D>(valueOrUpdate: ValueOrUpdateType<D>, cache: D | null): Promise<D> => {
  // Type guard to check if our value or update is a function
  const isFunction = <D>(value: ValueOrUpdateType<D>): value is (prev: D) => D | Promise<D> =>
    typeof value === 'function';

  // Type guard to check in case of a function if it's a Promise
  const returnsPromise = <D>(func: (prev: D) => D | Promise<D>): func is (prev: D) => Promise<D> =>
    // Use ReturnType to infer the return type of the function and check if it's a Promise
    (func as (prev: D) => Promise<D>) instanceof Promise;
  if (isFunction(valueOrUpdate)) {
    // Check if the function returns a Promise
    if (returnsPromise(valueOrUpdate)) {
      return valueOrUpdate(cache as D);
    } else {
      return valueOrUpdate(cache as D);
    }
  } else {
    return valueOrUpdate;
  }
};

/**
 * If one session storage needs access from content scripts, we need to enable it globally.
 * @default false
 */
let globalSessionAccessLevelFlag: StorageConfigType['sessionAccessForContentScripts'] = false;

/**
 * Checks if the storage permission is granted in the manifest.json.
 */
const checkStoragePermission = (storageEnum: StorageEnum): void => {
  if (!chrome) {
    return;
  }

  if (!chrome.storage[storageEnum]) {
    throw new Error(`"storage" permission in manifest.ts: "storage ${storageEnum}" isn't defined`);
  }
};

/**
 * Creates a storage area for persisting and exchanging data.
 */
const createStorage = <D = string>(key: string, fallback: D, config?: StorageConfigType<D>): BaseStorageType<D> => {
  let cache: D | null = null;
  let initialCache = false;
  let listeners: Array<() => void> = [];

  const storageEnum = config?.storageEnum ?? StorageEnum.Local;
  const liveUpdate = config?.liveUpdate ?? false;

  const serialize = config?.serialization?.serialize ?? ((v: D) => v);
  const deserialize = config?.serialization?.deserialize ?? (v => v as D);

  // Set global session storage access level for StoryType.Session, only when not already done but needed.
  if (
    globalSessionAccessLevelFlag === false &&
    storageEnum === StorageEnum.Session &&
    config?.sessionAccessForContentScripts === true
  ) {
    checkStoragePermission(storageEnum);

    chrome?.storage[storageEnum]
      .setAccessLevel({
        accessLevel: SessionAccessLevelEnum.ExtensionPagesAndContentScripts,
      })
      .catch(error => {
        console.error(error);
        console.error('Please call .setAccessLevel() into different context, like a background script.');
      });
    globalSessionAccessLevelFlag = true;
  }

  // Register life cycle methods
  const get = async (): Promise<D> => {
    checkStoragePermission(storageEnum);
    const value = chrome?.storage ? await chrome.storage[storageEnum].get([key]) : { [key]: await readWebValue(key) };

    if (!value) {
      return fallback;
    }

    return deserialize(value[key]) ?? fallback;
  };

  const set = async (valueOrUpdate: ValueOrUpdateType<D>) => {
    if (!initialCache) {
      cache = await get();
    }
    const next = await updateCache(valueOrUpdate, cache);
    if (chrome?.storage) await chrome.storage[storageEnum].set({ [key]: serialize(next) });
    else await writeWebValue(key, serialize(next));
    cache = next;
    _emitChange();
  };

  const subscribe = (listener: () => void) => {
    listeners = [...listeners, listener];

    return () => {
      listeners = listeners.filter(l => l !== listener);
    };
  };

  const getSnapshot = () => cache;

  const _emitChange = () => {
    listeners.forEach(listener => listener());
  };

  // Listener for live updates from the browser
  const _updateFromStorageOnChanged = async (changes: { [key: string]: chrome.storage.StorageChange }) => {
    // Check if the key we are listening for is in the changes object
    if (changes[key] === undefined) return;

    const valueOrUpdate: ValueOrUpdateType<D> = deserialize(changes[key].newValue);

    if (cache === valueOrUpdate) return;

    cache = await updateCache(valueOrUpdate, cache);

    _emitChange();
  };

  get()
    .then(data => {
      cache = data;
      initialCache = true;
      _emitChange();
    })
    .catch(() => {
      // useStorage independently reads get() and sends its rejection to the visible error boundary.
      // Do not publish a fallback that would hide a broken or unavailable persistence layer.
    });

  // Register listener for live updates for our storage area
  if (liveUpdate) {
    chrome?.storage[storageEnum].onChanged.addListener(_updateFromStorageOnChanged);
    if (!chrome?.storage && typeof window !== 'undefined')
      window.addEventListener('storage', event => {
        if (event.key === key) {
          cache = event.newValue ? deserialize(JSON.parse(event.newValue)) : fallback;
          _emitChange();
        }
      });
    webChannel?.addEventListener('message', async event => {
      if (event.data === key) {
        cache = await get();
        _emitChange();
      }
    });
  }

  return {
    get,
    set,
    getSnapshot,
    subscribe,
  };
};

/** Migration only: remove retired sync credentials without touching reading data. */
const removeLegacySyncCredentials = async function removeLegacySyncCredentials(): Promise<void> {
  const keys = ['read-later-cloudkit', 'read-later-sync-status'];
  if (chrome) {
    await chrome.storage.local.remove(keys);
    return;
  }
  if (typeof indexedDB !== 'undefined') {
    const db = await openWebDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('settings', 'readwrite');
      for (const key of keys) transaction.objectStore('settings').delete(key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }
  for (const key of keys) globalThis.localStorage?.removeItem(key);
};

export { createStorage, removeLegacySyncCredentials };
