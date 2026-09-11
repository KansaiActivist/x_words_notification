const $screenName = document.getElementById("screenName");
const $keyword = document.getElementById("keyword");
const $interval = document.getElementById("interval");
const $status = document.getElementById("status");
const $startBtn = document.getElementById("startBtn");
const $stopBtn = document.getElementById("stopBtn");
const $checkNowBtn = document.getElementById("checkNowBtn");

function fmtTime(ts) {
  if (!ts) return "まだチェックしていません";
  const d = new Date(ts);
  return d.toLocaleString("ja-JP");
}

async function refreshStatus() {
  const status = await chrome.runtime.sendMessage({ type: "getStatus" });
  if (!status) return;

  if (status.screenName) $screenName.value = status.screenName;
  if (status.keyword) $keyword.value = status.keyword;
  if (status.intervalMinutes) $interval.value = status.intervalMinutes;

  const badge = status.monitoring
    ? '<span class="badge on">監視中</span>'
    : '<span class="badge off">停止中</span>';

  let html = `${badge}<br/>`;
  html += `<span class="label">最終チェック:</span> ${fmtTime(status.lastChecked)}<br/>`;
  if (status.screenName && status.keyword) {
    html += `<span class="label">対象:</span> @${status.screenName} / 「${status.keyword}」`;
  }
  if (status.lastError) {
    html += `<div class="error">⚠️ ${status.lastError}</div>`;
  }

  $status.innerHTML = html;
}

$startBtn.addEventListener("click", async () => {
  const screenName = $screenName.value.trim().replace(/^@/, "");
  const keyword = $keyword.value.trim();
  const intervalMinutes = Number($interval.value) || 5;

  if (!screenName || !keyword) {
    alert("アカウント名とキーワードを両方入力してください");
    return;
  }

  $startBtn.disabled = true;
  $startBtn.textContent = "開始中...";
  try {
    await chrome.runtime.sendMessage({
      type: "startMonitoring",
      screenName,
      keyword,
      intervalMinutes,
    });
    await refreshStatus();
  } finally {
    $startBtn.disabled = false;
    $startBtn.textContent = "監視開始";
  }
});

$stopBtn.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "stopMonitoring" });
  await refreshStatus();
});

$checkNowBtn.addEventListener("click", async () => {
  $checkNowBtn.disabled = true;
  $checkNowBtn.textContent = "チェック中...";
  try {
    // 手動チェック前に、現在の入力値を保存しておく（未開始でも設定は使う）
    const screenName = $screenName.value.trim().replace(/^@/, "");
    const keyword = $keyword.value.trim();
    if (screenName && keyword) {
      await chrome.storage.local.set({ screenName, keyword });
    }
    await chrome.runtime.sendMessage({ type: "checkNow" });
    await refreshStatus();
  } finally {
    $checkNowBtn.disabled = false;
    $checkNowBtn.textContent = "今すぐチェック";
  }
});

refreshStatus();
