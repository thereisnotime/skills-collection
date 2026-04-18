/**
 * Boycott Filter — Background Service Worker
 *
 * Syncs the boycott list from the local server every 30s.
 * Updates badge when a match is found on the active tab.
 */

const SYNC_URL = 'http://127.0.0.1:7847/list';
const SYNC_INTERVAL_MS = 30_000;

// Sync list from local server into chrome.storage.local
async function syncList() {
  try {
    const res = await fetch(SYNC_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    await chrome.storage.local.set({ boycottList: data });
    // Notify all content scripts of the update
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'LIST_UPDATED', data });
      } catch {
        // Tab might not have content script
      }
    }
    return data;
  } catch (e) {
    // Server not running — use cached list
    console.log('Boycott Filter: sync failed, using cache —', e.message);
    return null;
  }
}

// Set badge on a tab
function updateBadge(tabId, matchCount) {
  if (matchCount > 0) {
    chrome.action.setBadgeText({ text: String(matchCount), tabId });
    chrome.action.setBadgeBackgroundColor({ color: '#DC2626', tabId });
  } else {
    chrome.action.setBadgeText({ text: '', tabId });
  }
}

// Listen for match reports from content scripts
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'MATCH_REPORT' && sender.tab) {
    updateBadge(sender.tab.id, msg.matches.length);
  }
  if (msg.type === 'REQUEST_SYNC') {
    syncList().then(data => sendResponse({ data }));
    return true; // async response
  }
});

// Periodic sync
setInterval(syncList, SYNC_INTERVAL_MS);

// Initial sync on install/startup
chrome.runtime.onInstalled.addListener(() => syncList());
chrome.runtime.onStartup.addListener(() => syncList());

// Also sync when service worker wakes up
syncList();
