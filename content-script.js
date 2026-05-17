// Wide-mode content script for ChatGPT and Gemini.
(function () {
  const site = detectSite();
  if (!site) return;

  const DEFAULT_SETTINGS = { chatgpt: true, gemini: true };
  const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS);
  const STYLE_IDS = { chatgpt: 'widechat-style-chatgpt', gemini: 'widechat-style-gemini' };
  const ROOT_CLASSES = { chatgpt: 'widechat-enabled-chatgpt', gemini: 'widechat-enabled-gemini' };
  const GEMINI_MAX_WIDTH = '148rem';
  const GEMINI_USER_ROW_CLASS = 'widechat-user-row-right';
  const COMPOSER_SELECTOR =
    'textarea, [contenteditable="true"], [role="textbox"], input[type="text"], input[type="search"]';
  const CHATGPT_MESSAGE_SELECTOR = '[data-testid^="conversation-turn"], [data-message-author-role]';
  const CHATGPT_TABLE_CONTAINER_SELECTOR =
    '[data-message-author-role], [data-testid^="conversation-turn"], .markdown, .prose';
  const GEMINI_MESSAGE_SELECTOR = 'model-response, user-query, model-response-content, user-query-content';
  const GEMINI_QUERY_SELECTOR = 'user-query, user-query-content';
  const GEMINI_CONTENT_WIDE_SELECTOR =
    'model-response-content, user-query-content, .message-content, .text-content, .markdown, .prose';
  const GEMINI_LAYOUT_SELECTOR = '.conversation-container, .chat-content, .content-container, .main-content, c-wiz';
  const GEMINI_TABLE_SCOPE_SELECTOR = `${GEMINI_MESSAGE_SELECTOR}, ${GEMINI_CONTENT_WIDE_SELECTOR}`;
  const MAX_TABLE_WRAPPER_DEPTH = { chatgpt: 4, gemini: 6 };
  const MAX_GEMINI_LAYOUT_DEPTH = 4;

  const fallbackState = { chatgpt: new Map(), gemini: new Map() };
  const pendingMessageRoots = new Set();
  const pendingTables = new Set();
  const pendingGeminiQueries = new Set();

  let currentEnabled = false;
  let flushFrameId = 0;
  let tableLayoutState = new WeakMap();

  init();

  function detectSite() {
    const host = location.hostname;
    if (host.includes('chatgpt') || host.includes('openai.com')) return 'chatgpt';
    if (host.includes('gemini.google.com') || host.includes('bard.google.com')) return 'gemini';
    return null;
  }

  function getCssForSite(target) {
    if (target === 'chatgpt') {
      return `
/* ChatGPT wide mode */
html.${ROOT_CLASSES.chatgpt} :is(.text-token-text-primary > div > div, .min-w-fit > div) {
  max-width: 100% !important;
}

html.${ROOT_CLASSES.chatgpt} :is(main, [role="main"]) :is(div, section, article):has(
  [data-testid^="conversation-turn"],
  [data-message-author-role],
  table
) {
  width: 100% !important;
  max-width: 100% !important;
  margin-left: auto !important;
  margin-right: auto !important;
}

html.${ROOT_CLASSES.chatgpt} :is([data-testid^="conversation-turn"], [data-message-author-role]) {
  width: 100% !important;
  max-width: 100% !important;
  margin-left: auto !important;
  margin-right: auto !important;
}

html.${ROOT_CLASSES.chatgpt} :is(.markdown, .prose) {
  width: 100% !important;
  max-width: 100% !important;
}

html.${ROOT_CLASSES.chatgpt} table {
  width: 100% !important;
  max-width: 100% !important;
  margin-left: auto !important;
  margin-right: auto !important;
}
`;
    }

    if (target === 'gemini') {
      return `
/* Gemini wide mode */
html.${ROOT_CLASSES.gemini} :is(.conversation-container, .chat-content, .content-container, .main-content) {
  width: 100% !important;
  max-width: ${GEMINI_MAX_WIDTH} !important;
  margin-left: auto !important;
  margin-right: auto !important;
}

html.${ROOT_CLASSES.gemini} :is(${GEMINI_MESSAGE_SELECTOR}, ${GEMINI_CONTENT_WIDE_SELECTOR}) {
  width: 100% !important;
  max-width: none !important;
}

html.${ROOT_CLASSES.gemini} :is(${GEMINI_TABLE_SCOPE_SELECTOR}) table {
  width: 100% !important;
  max-width: 100% !important;
  margin-left: auto !important;
  margin-right: auto !important;
}

html.${ROOT_CLASSES.gemini} :is(.conversation-container, .chat-content, .content-container, .main-content, main, [role="main"]) span.user-query-container,
html.${ROOT_CLASSES.gemini} :is(.conversation-container, .chat-content, .content-container, .main-content, main, [role="main"]) div.user-query-container,
html.${ROOT_CLASSES.gemini} :is(.conversation-container, .chat-content, .content-container, .main-content, main, [role="main"]) .right-align-content,
html.${ROOT_CLASSES.gemini} :is(.conversation-container, .chat-content, .content-container, .main-content, main, [role="main"]) .${GEMINI_USER_ROW_CLASS} {
  width: 100% !important;
  max-width: 100% !important;
  margin-right: 0 !important;
  padding-right: 0 !important;
  display: flex !important;
  justify-content: flex-end !important;
}

html.${ROOT_CLASSES.gemini} :is(.conversation-container, .chat-content, .content-container, .main-content, main, [role="main"]) .user-query-bubble-with-background,
html.${ROOT_CLASSES.gemini} :is(.conversation-container, .chat-content, .content-container, .main-content, main, [role="main"]) .user-query-bubble-container {
  margin-left: auto !important;
  margin-right: 0 !important;
}
`;
    }

    return '';
  }

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

  function ensureStyle(enabled) {
    const id = STYLE_IDS[site];
    const css = getCssForSite(site);
    const existing = document.getElementById(id);

    if (!enabled) {
      if (existing && existing.parentNode) existing.remove();
      return;
    }

    if (existing) {
      if (existing.textContent !== css) existing.textContent = css;
      return;
    }

    const style = document.createElement('style');
    style.id = id;
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  function applyWideMode(enabled) {
    const wasEnabled = currentEnabled;
    currentEnabled = !!enabled;

    toggleRootClass(currentEnabled);
    ensureStyle(currentEnabled);

    if (!currentEnabled) {
      cancelScheduledFlush();
      clearPendingWork();
      clearFallback(site);
      tableLayoutState = new WeakMap();
      return;
    }

    if (!wasEnabled) {
      tableLayoutState = new WeakMap();
      queueInitialScan();
      return;
    }

    scheduleFlush();
  }

  function queueInitialScan() {
    const root = document.body || document.documentElement;
    if (!root) return;

    const messageSelector = site === 'chatgpt' ? CHATGPT_MESSAGE_SELECTOR : GEMINI_MESSAGE_SELECTOR;
    root.querySelectorAll(messageSelector).forEach((el) => pendingMessageRoots.add(el));
    root.querySelectorAll('table').forEach((table) => queueTable(table));

    if (site === 'gemini') {
      root.querySelectorAll(GEMINI_QUERY_SELECTOR).forEach((el) => pendingGeminiQueries.add(el));
    }

    scheduleFlush();
  }

  function scheduleFlush() {
    if (!currentEnabled || flushFrameId) return;
    flushFrameId = window.requestAnimationFrame(() => {
      flushFrameId = 0;
      flushPendingWork();
    });
  }

  function cancelScheduledFlush() {
    if (!flushFrameId) return;
    window.cancelAnimationFrame(flushFrameId);
    flushFrameId = 0;
  }

  function clearPendingWork() {
    pendingMessageRoots.clear();
    pendingTables.clear();
    pendingGeminiQueries.clear();
  }

  function flushPendingWork() {
    if (!currentEnabled) return;

    pruneFallback(site);

    const messageRoots = drainConnectedElements(pendingMessageRoots);
    const tables = drainConnectedElements(pendingTables);
    const geminiQueries = site === 'gemini' ? drainConnectedElements(pendingGeminiQueries) : [];

    messageRoots.forEach((messageRoot) => {
      if (site === 'chatgpt') processChatgptMessage(messageRoot);
      else processGeminiMessage(messageRoot);
    });

    if (site === 'gemini') {
      geminiQueries.forEach((queryEl) => processGeminiUserQueryElement(queryEl));
    }

    tables.forEach((table) => adjustTable(site, table));
  }

  function drainConnectedElements(set) {
    const elements = Array.from(set);
    set.clear();
    return elements.filter((el) => el && el.isConnected);
  }

  function processChatgptMessage(messageEl) {
    if (!messageEl.matches || !messageEl.matches(CHATGPT_MESSAGE_SELECTOR) || containsComposer(messageEl)) return;

    applyInline('chatgpt', messageEl, [
      { prop: 'max-width', value: '100%' },
      { prop: 'width', value: '100%' },
      { prop: 'margin-left', value: 'auto' },
      { prop: 'margin-right', value: 'auto' }
    ]);

    const contentTargets = messageEl.querySelectorAll('.markdown, .prose');
    applyInline('chatgpt', Array.from(contentTargets), [
      { prop: 'max-width', value: '100%' },
      { prop: 'width', value: '100%' }
    ]);
  }

  function processGeminiMessage(messageEl) {
    if (!messageEl.matches || !messageEl.matches(GEMINI_MESSAGE_SELECTOR) || containsComposer(messageEl)) return;

    const layoutTargets = collectGeminiLayoutTargets(messageEl);
    applyInline('gemini', layoutTargets, [
      { prop: 'max-width', value: GEMINI_MAX_WIDTH },
      { prop: 'width', value: '100%' },
      { prop: 'margin-left', value: 'auto' },
      { prop: 'margin-right', value: 'auto' }
    ]);

    const contentTargets = [messageEl, ...Array.from(messageEl.querySelectorAll(GEMINI_CONTENT_WIDE_SELECTOR))];
    applyInline('gemini', contentTargets, [
      { prop: 'max-width', value: 'none' },
      { prop: 'width', value: '100%' }
    ]);
  }

  function collectGeminiLayoutTargets(messageEl) {
    const targets = new Set();
    let current = messageEl.parentElement;
    let depth = 0;

    while (current && depth < MAX_GEMINI_LAYOUT_DEPTH) {
      if (current.matches && current.matches('main, [role="main"]')) break;
      if (!containsComposer(current) && (depth < 2 || current.matches(GEMINI_LAYOUT_SELECTOR))) {
        targets.add(current);
      }
      current = current.parentElement;
      depth += 1;
    }

    return Array.from(targets);
  }

  function adjustTable(siteKey, table) {
    if (!table || !table.isConnected || !isRelevantTable(siteKey, table)) return;

    if (siteKey === 'chatgpt') {
      adjustChatgptTable(table);
      return;
    }

    const columnCount = getTableColumnCount(table);
    const compact = columnCount > 0 && columnCount <= 4;
    const layout = compact ? 'fixed' : 'auto';

    normalizeGeminiTableAncestors(siteKey, table);

    const cached = tableLayoutState.get(table);

    if (cached && cached.columnCount === columnCount && cached.layout === layout && cached.compact === compact) {
      return;
    }

    tableLayoutState.set(table, { columnCount, layout, compact });
    applyTableStyle(siteKey, table, layout);
  }

  function adjustChatgptTable(table) {
    const container = table.closest(CHATGPT_TABLE_CONTAINER_SELECTOR) || table.parentElement;
    normalizeChatgptTableAncestors(table, CHATGPT_TABLE_CONTAINER_SELECTOR);

    const containerWidth = container ? Math.floor(container.getBoundingClientRect().width) : 0;
    const naturalWidth = measureNaturalWidth(table);
    const columnCount = getTableColumnCount(table);

    const useFixed =
      (columnCount > 0 && columnCount <= 4) ||
      (containerWidth > 0 && naturalWidth > 0 && naturalWidth < containerWidth * 0.9);

    applyTableStyle('chatgpt', table, useFixed ? 'fixed' : 'auto');
  }

  function isRelevantTable(siteKey, table) {
    const scopeSelector = siteKey === 'chatgpt' ? CHATGPT_TABLE_CONTAINER_SELECTOR : GEMINI_TABLE_SCOPE_SELECTOR;
    return Boolean(table.closest && table.closest(scopeSelector));
  }

  function getMessageRootForElement(el) {
    const messageSelector = site === 'chatgpt' ? CHATGPT_MESSAGE_SELECTOR : GEMINI_MESSAGE_SELECTOR;
    return el && el.closest ? el.closest(messageSelector) : null;
  }

  function queueTable(table) {
    if (!table || !table.isConnected || !isRelevantTable(site, table)) return;
    pendingTables.add(table);
  }

  function getTableColumnCount(table) {
    const headRow = table.tHead && table.tHead.rows && table.tHead.rows[0];
    const firstRow = headRow || table.querySelector('tr');
    if (!firstRow) return 0;
    return firstRow.querySelectorAll('th, td').length;
  }

  function measureNaturalWidth(table) {
    const prev = {
      width: table.style.width,
      minWidth: table.style.minWidth,
      maxWidth: table.style.maxWidth,
      tableLayout: table.style.tableLayout
    };

    table.style.width = 'auto';
    table.style.minWidth = '';
    table.style.maxWidth = '';
    table.style.tableLayout = 'auto';

    const width = Math.ceil(table.scrollWidth || 0);

    table.style.width = prev.width;
    table.style.minWidth = prev.minWidth;
    table.style.maxWidth = prev.maxWidth;
    table.style.tableLayout = prev.tableLayout;

    return width;
  }

  function applyTableStyle(siteKey, table, layout) {
    applyInline(siteKey, table, [
      { prop: 'display', value: 'table' },
      { prop: 'width', value: '100%' },
      { prop: 'min-width', value: '100%' },
      { prop: 'max-width', value: '100%' },
      { prop: 'table-layout', value: layout },
      { prop: 'margin-left', value: 'auto' },
      { prop: 'margin-right', value: 'auto' }
    ]);
  }

  function shouldSkipChatgptTableWrapper(el) {
    if (!el || !el.querySelector) return false;
    const tableChild = el.querySelector(':scope > table');
    if (!tableChild) return false;
    const stickyButton = el.querySelector(':scope > div.sticky button[aria-label], :scope > div.sticky button[title]');
    if (!stickyButton) return false;
    const label = (stickyButton.getAttribute('aria-label') || stickyButton.getAttribute('title') || '')
      .trim()
      .toLowerCase();
    if (!label) return true;
    return label.includes('copy') || label.startsWith('sao');
  }

  function normalizeChatgptTableAncestors(table, stopSelector) {
    let current = table.parentElement;
    let depth = 0;

    while (current && depth < 10) {
      if (current.nodeType === Node.ELEMENT_NODE) {
        const el = current;
        if (shouldSkipChatgptTableWrapper(el)) {
          current = current.parentElement;
          depth += 1;
          continue;
        }

        if (!containsComposer(el)) {
          const declarations = [
            { prop: 'width', value: '100%' },
            { prop: 'max-width', value: '100%' }
          ];
          if (isInlineLike(el)) {
            declarations.push({ prop: 'display', value: 'block' });
          }
          applyInline('chatgpt', el, declarations);
        }

        if (el.matches && el.matches(stopSelector)) break;
        if (el.matches && el.matches('main, [role="main"]')) break;
      }

      current = current.parentElement;
      depth += 1;
    }
  }

  function normalizeGeminiTableAncestors(siteKey, table) {
    let current = table.parentElement;
    let depth = 0;

    while (current && depth < MAX_TABLE_WRAPPER_DEPTH[siteKey]) {
      if (current.nodeType === Node.ELEMENT_NODE) {
        const el = current;

        if (!containsComposer(el)) {
          const declarations = [
            { prop: 'width', value: '100%' },
            { prop: 'max-width', value: '100%' }
          ];
          if (isInlineLike(el)) {
            declarations.push({ prop: 'display', value: 'block' });
          }
          applyInline(siteKey, el, declarations);
        }

        if (el.matches && el.matches(GEMINI_TABLE_SCOPE_SELECTOR)) break;
        if (el.matches && el.matches('main, [role="main"]')) break;
      }

      current = current.parentElement;
      depth += 1;
    }
  }

  function isInlineLike(el) {
    if (!el || !el.isConnected) return false;
    const display = window.getComputedStyle(el).display;
    return display === 'inline' || display === 'inline-block';
  }

  function containsComposer(el) {
    return el && el.querySelector && el.querySelector(COMPOSER_SELECTOR);
  }

  function toggleRootClass(enabled) {
    const cls = ROOT_CLASSES[site];
    if (!cls) return;
    const root = document.documentElement;
    if (enabled) root.classList.add(cls);
    else root.classList.remove(cls);
  }

  function processGeminiUserQueryElement(queryEl) {
    if (!queryEl || !queryEl.matches || !queryEl.matches(GEMINI_QUERY_SELECTOR)) return;

    const alignEl =
      queryEl.querySelector('.right-align-content, span.user-query-container, div.user-query-container') ||
      queryEl.closest('.right-align-content, span.user-query-container, div.user-query-container');

    if (alignEl && !alignEl.classList.contains(GEMINI_USER_ROW_CLASS)) {
      alignEl.classList.add(GEMINI_USER_ROW_CLASS);
    }
  }

  function queueRelevantNode(node) {
    const el = node && node.nodeType === Node.ELEMENT_NODE ? node : node && node.parentElement;
    if (!el) return;

    const messageRoot = getMessageRootForElement(el);
    if (messageRoot) pendingMessageRoots.add(messageRoot);

    const closestTable = el.closest && el.closest('table');
    if (closestTable) queueTable(closestTable);
    if (el.matches && el.matches('table')) queueTable(el);

    if (site === 'gemini') {
      const closestQuery = el.closest && el.closest(GEMINI_QUERY_SELECTOR);
      if (closestQuery) pendingGeminiQueries.add(closestQuery);
    }

    if (!el.querySelectorAll) return;

    const messageSelector = site === 'chatgpt' ? CHATGPT_MESSAGE_SELECTOR : GEMINI_MESSAGE_SELECTOR;
    el.querySelectorAll(messageSelector).forEach((messageEl) => pendingMessageRoots.add(messageEl));
    el.querySelectorAll('table').forEach((table) => queueTable(table));

    if (site === 'gemini') {
      el.querySelectorAll(GEMINI_QUERY_SELECTOR).forEach((queryEl) => pendingGeminiQueries.add(queryEl));
    }
  }

  function applyInline(siteKey, elements, declarations) {
    const map = fallbackState[siteKey];
    const list = Array.isArray(elements) ? elements : [elements];

    list.filter(Boolean).forEach((el) => {
      if (!el.isConnected) return;

      let prev = map.get(el);
      if (!prev) {
        prev = {};
        map.set(el, prev);
      }

      declarations.forEach(({ prop, value, priority = 'important' }) => {
        const currentValue = el.style.getPropertyValue(prop);
        const currentPriority = el.style.getPropertyPriority(prop);

        if (!prev[prop]) {
          prev[prop] = { value: currentValue, priority: currentPriority };
        }

        if (currentValue === value && currentPriority === priority) return;
        el.style.setProperty(prop, value, priority);
      });
    });
  }

  function pruneFallback(siteKey) {
    const map = fallbackState[siteKey];
    for (const [el] of map.entries()) {
      if (!el || !el.isConnected) map.delete(el);
    }
  }

  function clearFallback(siteKey) {
    const map = fallbackState[siteKey];
    for (const [el, prev] of map.entries()) {
      if (!el || !el.isConnected) continue;
      for (const prop of Object.keys(prev)) {
        el.style.setProperty(prop, prev[prop].value, prev[prop].priority);
      }
    }
    map.clear();
  }

  function init() {
    loadSettings().then((settings) => {
      applyWideMode(Boolean(settings[site]));
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync' && area !== 'local') return;
      if (site in changes) applyWideMode(Boolean(changes[site].newValue));
    });

    chrome.runtime.onMessage.addListener((message) => {
      if (message && message.type === 'widechat:update' && typeof message.state === 'object') {
        if (site in message.state) applyWideMode(Boolean(message.state[site]));
      }
    });

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        if (currentEnabled) queueInitialScan();
      });
    }

    const observer = new MutationObserver((mutations) => {
      if (!currentEnabled) return;

      mutations.forEach((mutation) => {
        queueRelevantNode(mutation.target);
        mutation.addedNodes.forEach((node) => queueRelevantNode(node));
      });

      scheduleFlush();
    });

    observer.observe(document.documentElement || document, { childList: true, subtree: true });
  }
})();
