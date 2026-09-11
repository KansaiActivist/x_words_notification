// background.js
// Yahoo!リアルタイム検索の非公式APIを使い、
// 「特定アカウント × 特定キーワード」の新着投稿を監視して通知する。

const ALARM_NAME = "checkTweets";
const API_ENDPOINT = "https://search.yahoo.co.jp/realtime/api/v1/pagination";

// ---- 設定の読み書き ----

async function getSettings() {
  const data = await chrome.storage.local.get([
    "screenName",
    "keyword",
    "intervalMinutes",
    "lastSeenId",
    "monitoring",
    "lastChecked",
    "lastError",
  ]);
  return {
    screenName: data.screenName || "",
    keyword: data.keyword || "",
    intervalMinutes: data.intervalMinutes || 5,
    lastSeenId: data.lastSeenId || null,
    monitoring: !!data.monitoring,
    lastChecked: data.lastChecked || null,
    lastError: data.lastError || null,
  };
}

// ---- ハイライトタグの除去 ----
function cleanText(text) {
  if (!text) return "";
  return text.replace(/\tSTART\t/g, "").replace(/\tEND\t/g, "");
}

// ---- 本体のチェック処理 ----

async function checkTweets({ manual = false } = {}) {
  const settings = await getSettings();

  if (!settings.monitoring && !manual) return;
  if (!settings.screenName || !settings.keyword) {
    await chrome.storage.local.set({
      lastError: "アカウント名またはキーワードが未設定です",
    });
    return { newEntries: [], error: "アカウント名またはキーワードが未設定です" };
  }

  // ID:アカウント名 と キーワード のAND検索。新着順（mdを省略）で取得。
  const query = `ID:${settings.screenName} ${settings.keyword}`;
  const params = new URLSearchParams({
    p: query,
    results: "40",
  });

  try {
    const res = await fetch(`${API_ENDPOINT}?${params.toString()}`, {
      headers: {
        Accept: "application/json, text/plain, */*",
      },
    });

    if (!res.ok) {
      const errMsg = `APIエラー: HTTP ${res.status}`;
      await chrome.storage.local.set({ lastError: errMsg, lastChecked: Date.now() });
      return { newEntries: [], error: errMsg };
    }

    const data = await res.json();
    const entries = data?.timeline?.entry || [];

    // 新着順のはずだが念のため createdAt 降順にソート
    entries.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    let newEntries = [];

    if (entries.length > 0) {
      if (settings.lastSeenId) {
        const idx = entries.findIndex((e) => e.id === settings.lastSeenId);
        newEntries = idx === -1 ? entries : entries.slice(0, idx);
      } else {
        // 初回実行時は過去分をまとめて通知しないよう、基準点の記録のみ行う
        newEntries = [];
      }

      await chrome.storage.local.set({
        lastSeenId: entries[0].id,
        lastChecked: Date.now(),
        lastError: null,
      });
    } else {
      await chrome.storage.local.set({ lastChecked: Date.now(), lastError: null });
    }

    // 通知（古い順に、最大5件まで）
    const toNotify = newEntries.slice(0, 5).reverse();
    for (const entry of toNotify) {
      const bodyText = cleanText(entry.displayText).slice(0, 150);
      chrome.notifications.create(`tweet-${entry.id}`, {
        type: "basic",
        iconUrl: "icon128.png",
        title: `@${entry.screenName} の新着投稿にヒット`,
        message: bodyText || "(本文なし)",
        priority: 2,
      });
    }

    return { newEntries, error: null };
  } catch (err) {
    const errMsg = `通信エラー: ${err.message}`;
    await chrome.storage.local.set({ lastError: errMsg, lastChecked: Date.now() });
    return { newEntries: [], error: errMsg };
  }
}

// 通知クリックでポストを開く
chrome.notifications.onClicked.addListener((notifId) => {
  if (notifId.startsWith("tweet-")) {
    const id = notifId.replace("tweet-", "");
    chrome.tabs.create({ url: `https://x.com/i/status/${id}` });
    chrome.notifications.clear(notifId);
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    checkTweets();
  }
});

// popup.js からのメッセージ処理
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "startMonitoring") {
    (async () => {
      const interval = Math.max(1, Number(msg.intervalMinutes) || 5);
      await chrome.storage.local.set({
        screenName: msg.screenName.trim().replace(/^@/, ""),
        keyword: msg.keyword.trim(),
        intervalMinutes: interval,
        monitoring: true,
        lastSeenId: null, // アカウント/キーワード変更時は基準をリセット
        lastError: null,
      });
      chrome.alarms.create(ALARM_NAME, { periodInMinutes: interval });
      await checkTweets(); // 基準点を確立（初回は通知しない）
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (msg.type === "stopMonitoring") {
    (async () => {
      await chrome.storage.local.set({ monitoring: false });
      chrome.alarms.clear(ALARM_NAME);
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (msg.type === "checkNow") {
    (async () => {
      const result = await checkTweets({ manual: true });
      sendResponse(result);
    })();
    return true;
  }

  if (msg.type === "getStatus") {
    (async () => {
      const settings = await getSettings();
      sendResponse(settings);
    })();
    return true;
  }
});
