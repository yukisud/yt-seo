// YouTube Transcription Extension - Content Script

// 文字起こしパネルを作成
function createTranscriptionPanel() {
  const panel = document.createElement('div');
  panel.id = 'yt-transcription-panel';
  panel.innerHTML = `
    <div class="yt-trans-header">
      <h3>文字起こし</h3>
      <div class="yt-trans-controls">
        <button id="yt-trans-fetch-btn">字幕を取得</button>
        <button id="yt-trans-copy-btn">コピー</button>
        <button id="yt-trans-close-btn">×</button>
      </div>
    </div>
    <div class="yt-trans-content">
      <div id="yt-trans-loading">字幕を取得するには「字幕を取得」ボタンをクリックしてください</div>
      <div id="yt-trans-text"></div>
    </div>
  `;

  document.body.appendChild(panel);

  // イベントリスナーを追加
  document.getElementById('yt-trans-fetch-btn').addEventListener('click', fetchTranscription);
  document.getElementById('yt-trans-copy-btn').addEventListener('click', copyTranscription);
  document.getElementById('yt-trans-close-btn').addEventListener('click', togglePanel);
}

// パネルの表示/非表示を切り替え
function togglePanel() {
  const panel = document.getElementById('yt-transcription-panel');
  if (panel) {
    panel.classList.toggle('hidden');
  } else {
    createTranscriptionPanel();
  }
}

// 動画IDを取得
function getVideoId() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('v');
}

// 字幕を取得
async function fetchTranscription() {
  const loadingDiv = document.getElementById('yt-trans-loading');
  const textDiv = document.getElementById('yt-trans-text');

  loadingDiv.style.display = 'block';
  loadingDiv.textContent = '字幕を取得中...';
  textDiv.innerHTML = '';

  try {
    const videoId = getVideoId();
    if (!videoId) {
      throw new Error('動画IDが取得できません');
    }

    // YouTubeのプレイヤーレスポンスから字幕トラックを取得
    const captionTracks = await getCaptionTracks();

    if (!captionTracks || captionTracks.length === 0) {
      throw new Error('この動画には字幕がありません');
    }

    // 日本語の字幕を優先、なければ最初の字幕を使用
    let selectedTrack = captionTracks.find(track =>
      track.languageCode === 'ja' || track.languageCode === 'ja-JP'
    ) || captionTracks[0];

    // 字幕データを取得
    const transcriptData = await fetchCaptionData(selectedTrack.baseUrl);

    // 字幕を表示
    displayTranscription(transcriptData);
    loadingDiv.style.display = 'none';

  } catch (error) {
    console.error('字幕の取得に失敗しました:', error);
    loadingDiv.textContent = `エラー: ${error.message}`;
    textDiv.innerHTML = '';
  }
}

// YouTubeのプレイヤーレスポンスから字幕トラックを取得
function getCaptionTracks() {
  return new Promise((resolve, reject) => {
    try {
      // ytInitialPlayerResponseを探す
      const scripts = document.querySelectorAll('script');
      let playerResponse = null;

      for (const script of scripts) {
        const content = script.textContent;
        if (content.includes('ytInitialPlayerResponse')) {
          const match = content.match(/ytInitialPlayerResponse\s*=\s*({.+?});/);
          if (match) {
            playerResponse = JSON.parse(match[1]);
            break;
          }
        }
      }

      if (!playerResponse) {
        // 別の方法: window.ytInitialPlayerResponseを試す
        if (window.ytInitialPlayerResponse) {
          playerResponse = window.ytInitialPlayerResponse;
        }
      }

      if (!playerResponse) {
        reject(new Error('プレイヤー情報が取得できません'));
        return;
      }

      const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

      if (!captionTracks) {
        reject(new Error('字幕トラックが見つかりません'));
        return;
      }

      resolve(captionTracks);

    } catch (error) {
      reject(error);
    }
  });
}

// 字幕データを取得
async function fetchCaptionData(url) {
  const response = await fetch(url);
  const text = await response.text();

  // XMLをパース
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(text, 'text/xml');

  const textElements = xmlDoc.querySelectorAll('text');
  const transcriptData = [];

  textElements.forEach(element => {
    const start = parseFloat(element.getAttribute('start'));
    const duration = parseFloat(element.getAttribute('dur'));
    const text = element.textContent
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n/g, ' ');

    transcriptData.push({
      start,
      duration,
      text
    });
  });

  return transcriptData;
}

// 字幕を表示
function displayTranscription(transcriptData) {
  const textDiv = document.getElementById('yt-trans-text');

  let html = '<div class="transcript-items">';

  transcriptData.forEach((item, index) => {
    const timestamp = formatTime(item.start);
    html += `
      <div class="transcript-item" data-time="${item.start}">
        <span class="timestamp">${timestamp}</span>
        <span class="text">${item.text}</span>
      </div>
    `;
  });

  html += '</div>';
  textDiv.innerHTML = html;

  // タイムスタンプをクリックすると動画がその位置に移動
  textDiv.querySelectorAll('.transcript-item').forEach(item => {
    item.addEventListener('click', () => {
      const time = parseFloat(item.getAttribute('data-time'));
      const video = document.querySelector('video');
      if (video) {
        video.currentTime = time;
        video.play();
      }
    });
  });
}

// 時間をフォーマット (秒 -> MM:SS)
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// 文字起こしをコピー
function copyTranscription() {
  const textDiv = document.getElementById('yt-trans-text');
  const items = textDiv.querySelectorAll('.transcript-item');

  if (items.length === 0) {
    alert('コピーする字幕がありません');
    return;
  }

  let text = '';
  items.forEach(item => {
    const timestamp = item.querySelector('.timestamp').textContent;
    const content = item.querySelector('.text').textContent;
    text += `[${timestamp}] ${content}\n`;
  });

  navigator.clipboard.writeText(text).then(() => {
    const copyBtn = document.getElementById('yt-trans-copy-btn');
    const originalText = copyBtn.textContent;
    copyBtn.textContent = 'コピーしました！';
    setTimeout(() => {
      copyBtn.textContent = originalText;
    }, 2000);
  }).catch(err => {
    console.error('コピーに失敗しました:', err);
    alert('コピーに失敗しました');
  });
}

// YouTubeプレイヤーの下に開くボタンを追加
function addOpenButton() {
  // 既にボタンが存在する場合は追加しない
  if (document.getElementById('yt-trans-open-btn')) {
    return;
  }

  const button = document.createElement('button');
  button.id = 'yt-trans-open-btn';
  button.textContent = '📝 文字起こし';
  button.className = 'yt-trans-open-button';
  button.addEventListener('click', togglePanel);

  // YouTube UIの下部に追加
  const interval = setInterval(() => {
    const targetElement = document.querySelector('#primary-inner');
    if (targetElement) {
      targetElement.insertBefore(button, targetElement.firstChild);
      clearInterval(interval);
    }
  }, 1000);

  // 10秒後にタイムアウト
  setTimeout(() => clearInterval(interval), 10000);
}

// 初期化
function init() {
  // URLが変更されたときに再初期化
  let lastUrl = location.href;
  new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      if (url.includes('/watch')) {
        setTimeout(() => {
          addOpenButton();
        }, 2000);
      }
    }
  }).observe(document, { subtree: true, childList: true });

  // 初回読み込み
  if (location.href.includes('/watch')) {
    setTimeout(() => {
      addOpenButton();
      createTranscriptionPanel();
    }, 2000);
  }
}

// スクリプト実行
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
