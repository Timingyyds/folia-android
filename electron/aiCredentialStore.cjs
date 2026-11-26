"use strict";

// electron/aiCredentialStore.cjs
// AI provider API keys at rest. electron-store writes config.json as plain JSON, so keys saved with
// a bare `store.set` end up readable by anything that can read the file (issue #586). Here they are
// sealed with Electron safeStorage (DPAPI on Windows, Keychain on macOS, libsecret/kwallet on Linux)
// and only the ciphertext reaches disk.
//
// The keys also stay inside the main process: the renderer only learns whether each one is saved
// (AI_API_KEYS_CONFIGURED), the same way the web build only knows the provider while the server
// holds the key. The settings form sends a key when the user types a new one, and '' to clear it.
//
// Linux without a real keyring selects `basic_text`, which "encrypts" with a hardcoded key. Unlike
// the KuGou/QQ/Bodian sessions, an API key is something the user typed in by hand, so dropping it on
// every restart would be a regression; in that case the key stays in plaintext, as before.
//
// The OpenAI-compatible key is also bound to the endpoint it was saved for (issue #643). The renderer
// can rewrite OPENAI_API_URL, so without the binding one save-settings call would point every later
// AI request, saved key included, at any host. Binding is by origin: a different path on the same
// server is still the server the user gave the key to.

const { normalizeOpenAIChatCompletionsUrl } = require('./aiTextClient.cjs');

const AI_CREDENTIAL_KEYS = Object.freeze(['GEMINI_API_KEY', 'OPENAI_API_KEY']);
const AI_API_KEYS_CONFIGURED_KEY = 'AI_API_KEYS_CONFIGURED';
const OPENAI_API_KEY_ENDPOINT_KEY = 'OPENAI_API_KEY_ENDPOINT';
const SEALED_SUFFIX = '_SEALED';

const sealedKeyOf = (key) => `${key}${SEALED_SUFFIX}`;
const isAiCredentialKey = (key) => AI_CREDENTIAL_KEYS.includes(key);
// Names the renderer may never write through save-settings: the ciphertext, the derived status and
// the endpoint the OpenAI-compatible key is bound to.
const isReservedAiCredentialKey = (key) => key === AI_API_KEYS_CONFIGURED_KEY
  || key === OPENAI_API_KEY_ENDPOINT_KEY
  || AI_CREDENTIAL_KEYS.some((name) => sealedKeyOf(name) === key);
const credentialKeyForProvider = (provider) => (provider === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY');

/**
 * Where an OPENAI_API_URL value sends requests, reduced to scheme and host (the raw value if it is
 * not a URL). src/utils/openAIEndpoint.ts mirrors this for the settings form's warning.
 */
const openAIEndpointOf = (rawUrl) => {
  const url = normalizeOpenAIChatCompletionsUrl(rawUrl);
  try {
    const { protocol, host } = new URL(url);
    return `${protocol}//${host}`;
  } catch {
    return url;
  }
};

/**
 * Wraps an electron-store instance so AI API keys are read and written through safeStorage.
 * Decryption is lazy: Linux safeStorage is only usable after `app.whenReady()`.
 */
function createAiCredentialStore({ store, safeStorage, platform = process.platform, warn = console.warn }) {
  if (!store || typeof store.get !== 'function' || typeof store.set !== 'function') {
    throw new TypeError('A compatible electron-store instance is required');
  }
  const cache = new Map();
  const warned = new Set();
  const warnOnce = (id, ...args) => {
    if (!warned.has(id)) {
      warned.add(id);
      warn(...args);
    }
  };

  const canEncrypt = () => {
    try {
      if (!safeStorage?.isEncryptionAvailable?.()) {
        return false;
      }
      if (platform === 'linux' && typeof safeStorage.getSelectedStorageBackend === 'function') {
        return safeStorage.getSelectedStorageBackend() !== 'basic_text';
      }
      return true;
    } catch {
      return false;
    }
  };

  const remove = (name) => {
    if (typeof store.delete === 'function') {
      store.delete(name);
    } else {
      store.set(name, undefined);
    }
  };

  const readPlain = (key) => {
    const plain = store.get(key);
    return typeof plain === 'string' ? plain : '';
  };

  const readSealed = (key) => {
    const sealed = store.get(sealedKeyOf(key));
    return typeof sealed === 'string' ? sealed : '';
  };

  const readCredential = (key) => {
    if (cache.has(key)) {
      return cache.get(key);
    }
    const plainValue = readPlain(key);
    const sealed = readSealed(key);
    if (sealed) {
      try {
        if (!canEncrypt()) {
          throw new Error('Encryption unavailable');
        }
        const value = safeStorage.decryptString(Buffer.from(sealed, 'base64'));
        cache.set(key, value);
        return value;
      } catch {
        // Ciphertext from another user/machine, or a keyring that is locked right now. Not cached,
        // and the blob is left alone, so the key comes back once the keyring unlocks. A plaintext
        // copy (older build, basic_text fallback) is still a usable key in the meantime.
        warnOnce(`decrypt:${key}`, `[AiCredentials] ${key} could not be decrypted; re-enter it in settings`);
        return plainValue;
      }
    }
    cache.set(key, plainValue);
    return plainValue;
  };

  // A saved OpenAI-compatible key counts only while OPENAI_API_URL still points at the endpoint it
  // was saved for. Checked on every read, outside the cache, because the URL can change at any time.
  const isBoundToCurrentEndpoint = (key) => {
    if (key !== 'OPENAI_API_KEY') {
      return true;
    }
    const bound = store.get(OPENAI_API_KEY_ENDPOINT_KEY);
    return typeof bound === 'string' && bound === openAIEndpointOf(store.get('OPENAI_API_URL'));
  };

  /**
   * The only way key material leaves this module. An OpenAI-compatible key whose endpoint has
   * changed reads as missing (and is kept, so pointing the URL back restores it); the UI then asks
   * for the key again, and AI requests refuse to run instead of sending it to the new host.
   */
  const get = (key) => {
    if (!isAiCredentialKey(key)) {
      return store.get(key);
    }
    const value = readCredential(key);
    if (value && !isBoundToCurrentEndpoint(key)) {
      warnOnce(`endpoint:${key}`, `[AiCredentials] ${key} was saved for another endpoint; re-enter it in settings`);
      return '';
    }
    return value;
  };

  /**
   * Whether a usable key is saved. A blob that cannot be decrypted right now counts as missing, so
   * the UI asks for the key again instead of offering AI features that would fail; typing a new
   * key overwrites the blob.
   */
  const isConfigured = (key) => Boolean(get(key));

  /** Saves a key, or clears it when `rawValue` is empty. */
  const set = (key, rawValue) => {
    if (!isAiCredentialKey(key)) {
      store.set(key, rawValue);
      return;
    }
    const value = typeof rawValue === 'string' ? rawValue.trim() : '';
    cache.set(key, value);
    if (!value) {
      remove(key);
      remove(sealedKeyOf(key));
      if (key === 'OPENAI_API_KEY') {
        remove(OPENAI_API_KEY_ENDPOINT_KEY);
      }
      return;
    }
    if (key === 'OPENAI_API_KEY') {
      // Whoever supplies the key itself may choose where it goes; the form saves OPENAI_API_URL first.
      store.set(OPENAI_API_KEY_ENDPOINT_KEY, openAIEndpointOf(store.get('OPENAI_API_URL')));
    }
    if (canEncrypt()) {
      try {
        store.set(sealedKeyOf(key), safeStorage.encryptString(value).toString('base64'));
        remove(key);
        return;
      } catch (error) {
        warn(`[AiCredentials] Encrypting ${key} failed; keeping it unencrypted`, error);
      }
    } else {
      warnOnce(`plain:${key}`, `[AiCredentials] OS credential encryption unavailable; ${key} is stored unencrypted`);
    }
    store.set(key, value);
    remove(sealedKeyOf(key));
  };

  /**
   * Upgrades keys saved by older versions: binds an OpenAI-compatible key saved before endpoint
   * binding existed to the current URL, then re-saves plaintext keys so they get sealed. Call after
   * app ready and before any window loads, so the binding reflects the URL the user saved.
   */
  const migrate = () => {
    const hasOpenAIKey = Boolean(readPlain('OPENAI_API_KEY') || readSealed('OPENAI_API_KEY'));
    if (hasOpenAIKey && typeof store.get(OPENAI_API_KEY_ENDPOINT_KEY) !== 'string') {
      store.set(OPENAI_API_KEY_ENDPOINT_KEY, openAIEndpointOf(store.get('OPENAI_API_URL')));
    }
    if (!canEncrypt()) {
      return;
    }
    for (const key of AI_CREDENTIAL_KEYS) {
      const plain = readPlain(key);
      if (plain) {
        set(key, plain);
      }
    }
  };

  /** Settings snapshot for the renderer: no key material, only which keys are saved. */
  const toPublicSettings = (settings) => {
    const result = { ...settings };
    const configured = {};
    for (const key of AI_CREDENTIAL_KEYS) {
      delete result[key];
      delete result[sealedKeyOf(key)];
      configured[key] = isConfigured(key);
    }
    result[AI_API_KEYS_CONFIGURED_KEY] = configured;
    return result;
  };

  /**
   * Key for the "test connection" button: the one typed in the form, or the saved one for that
   * provider when the field was left empty (the renderer no longer has the saved key to send).
   * The saved OpenAI-compatible key only goes to the endpoint it is bound to; otherwise an edited
   * URL (or a mod calling testAiConnection) would get the key sent to a host the user never saved
   * it for. Resolves to `{ apiKey }` or `{ error }`.
   */
  const resolveTestApiKey = (provider, typedKey, apiUrl) => {
    const typed = typeof typedKey === 'string' ? typedKey.trim() : '';
    if (typed) {
      return { apiKey: typed };
    }
    const saved = get(credentialKeyForProvider(provider));
    if (saved && provider === 'openai' && openAIEndpointOf(apiUrl) !== store.get(OPENAI_API_KEY_ENDPOINT_KEY)) {
      return { error: 'Enter the API key to test an endpoint other than the saved one.' };
    }
    return { apiKey: saved };
  };

  return {
    get,
    set,
    migrate,
    isConfigured,
    toPublicSettings,
    resolveTestApiKey,
    isEncrypted: canEncrypt,
    // Read-only store view for aiTextClient, which looks keys up with `store.get(name)`.
    settingsView: { get },
  };
}

module.exports = {
  AI_API_KEYS_CONFIGURED_KEY,
  AI_CREDENTIAL_KEYS,
  OPENAI_API_KEY_ENDPOINT_KEY,
  createAiCredentialStore,
  isAiCredentialKey,
  isReservedAiCredentialKey,
  openAIEndpointOf,
};
