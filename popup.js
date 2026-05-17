const DEFAULT_SETTINGS = { chatgpt: true, gemini: true };
const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS);

function readStored(area) {
  return new Promise((resolve) => {
    area.get(SETTINGS_KEYS, (stored) => {
      resolve(stored || {});
    });
  });
}

function mergeSettings(stored) {
  return { ...DEFAULT_SETTINGS, ...stored };
}

async function loadSettings() {
  const localStored = await readStored(chrome.storage.local);
  if (Object.keys(localStored).length > 0) {
    return mergeSettings(localStored);
  }

  const syncStored = await readStored(chrome.storage.sync);
  if (Object.keys(syncStored).length > 0) {
    const merged = mergeSettings(syncStored);
    chrome.storage.local.set(merged);
    return merged;
  }

  chrome.storage.local.set(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(state) {
  chrome.storage.local.set(state);
  chrome.storage.sync.set(state);
}

function init() {
  const chatgptToggle = document.getElementById('chatgpt-toggle');
  const geminiToggle = document.getElementById('gemini-toggle');
  const form = document.getElementById('widechat-form');

  if (!chatgptToggle || !geminiToggle || !form) return;

  loadSettings().then((state) => {
    chatgptToggle.checked = Boolean(state.chatgpt);
    geminiToggle.checked = Boolean(state.gemini);
  });

  form.addEventListener('change', () => {
    const state = {
      chatgpt: chatgptToggle.checked,
      gemini: geminiToggle.checked
    };

    saveSettings(state);
    chrome.runtime.sendMessage({ type: 'widechat:update', state }, () => {
      void chrome.runtime.lastError; // ignore "Receiving end does not exist"
    });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
