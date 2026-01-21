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

    console.log('[字幕取得] 動画ID:', videoId);
    loadingDiv.textContent = '字幕を取得中... (方法1/3)';

    // 方法1: YouTubeのプレイヤーレスポンスから取得
    let captionTracks = null;
    let transcriptData = null;

    try {
      captionTracks = await getCaptionTracks();
      console.log('[字幕取得] 方法1: 字幕トラック取得成功', captionTracks);

      if (captionTracks && captionTracks.length > 0) {
        // 日本語の字幕を優先、なければ最初の字幕を使用
        let selectedTrack = captionTracks.find(track =>
          track.languageCode === 'ja' || track.languageCode === 'ja-JP'
        ) || captionTracks[0];

        console.log('[字幕取得] 選択された字幕:', selectedTrack.languageCode);
        transcriptData = await fetchCaptionData(selectedTrack.baseUrl);
      }
    } catch (error) {
      console.warn('[字幕取得] 方法1失敗:', error.message);
    }

    // 方法2: YouTube内部APIを直接使用
    if (!transcriptData || transcriptData.length === 0) {
      console.log('[字幕取得] 方法2を試行: 内部API');
      loadingDiv.textContent = '字幕を取得中... (方法2/3)';

      try {
        transcriptData = await fetchTranscriptionFromAPI(videoId);
        console.log('[字幕取得] 方法2: 成功');
      } catch (error) {
        console.warn('[字幕取得] 方法2失敗:', error.message);
      }
    }

    // 方法3: timedtext APIを直接使用
    if (!transcriptData || transcriptData.length === 0) {
      console.log('[字幕取得] 方法3を試行: timedtext API');
      loadingDiv.textContent = '字幕を取得中... (方法3/3)';

      try {
        transcriptData = await fetchTranscriptionFromTimedText(videoId);
        console.log('[字幕取得] 方法3: 成功');
      } catch (error) {
        console.warn('[字幕取得] 方法3失敗:', error.message);
      }
    }

    if (!transcriptData || transcriptData.length === 0) {
      throw new Error('この動画には字幕がありません。または字幕が取得できませんでした。');
    }

    // 字幕を表示
    displayTranscription(transcriptData);
    loadingDiv.style.display = 'none';
    console.log('[字幕取得] 完了:', transcriptData.length + '件');

  } catch (error) {
    console.error('[字幕取得] 最終エラー:', error);
    loadingDiv.innerHTML = `
      <div style="color: #d32f2f;">
        <strong>エラー:</strong> ${error.message}
        <br><br>
        <small>デバッグ情報をコンソールで確認してください (F12キー)</small>
      </div>
    `;
    textDiv.innerHTML = '';
  }
}

// YouTubeのプレイヤーレスポンスから字幕トラックを取得
function getCaptionTracks() {
  return new Promise((resolve, reject) => {
    try {
      let playerResponse = null;

      // 方法1: window.ytInitialPlayerResponse
      if (window.ytInitialPlayerResponse) {
        playerResponse = window.ytInitialPlayerResponse;
        console.log('[方法1] window.ytInitialPlayerResponse から取得');
      }

      // 方法2: scriptタグから取得（より堅牢な正規表現）
      if (!playerResponse) {
        const scripts = document.querySelectorAll('script');
        for (const script of scripts) {
          const content = script.textContent;
          if (content.includes('ytInitialPlayerResponse')) {
            try {
              // より堅牢な正規表現: 複数行にまたがるJSONも取得
              const matches = content.match(/var\s+ytInitialPlayerResponse\s*=\s*(\{[^;]+\});/);
              if (matches && matches[1]) {
                playerResponse = JSON.parse(matches[1]);
                console.log('[方法1] scriptタグから取得');
                break;
              }
            } catch (e) {
              console.warn('[方法1] JSON解析失敗:', e.message);
              continue;
            }
          }
        }
      }

      // 方法3: ytplayer.config から取得
      if (!playerResponse && window.ytplayer && window.ytplayer.config) {
        playerResponse = window.ytplayer.config.args.player_response;
        if (typeof playerResponse === 'string') {
          playerResponse = JSON.parse(playerResponse);
        }
        console.log('[方法1] ytplayer.config から取得');
      }

      if (!playerResponse) {
        console.error('[方法1] プレイヤーレスポンスが見つかりません');
        reject(new Error('プレイヤー情報が取得できません'));
        return;
      }

      console.log('[方法1] プレイヤーレスポンス:', playerResponse);

      const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

      if (!captionTracks || captionTracks.length === 0) {
        console.error('[方法1] 字幕トラックが見つかりません');
        reject(new Error('字幕トラックが見つかりません'));
        return;
      }

      console.log('[方法1] 字幕トラック数:', captionTracks.length);
      resolve(captionTracks);

    } catch (error) {
      console.error('[方法1] エラー:', error);
      reject(error);
    }
  });
}

// 字幕データを取得
async function fetchCaptionData(url) {
  console.log('[字幕データ取得] URL:', url);
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

  console.log('[字幕データ取得] 取得件数:', transcriptData.length);
  return transcriptData;
}

// 方法2: YouTube内部APIから字幕を取得
async function fetchTranscriptionFromAPI(videoId) {
  // YouTubeの内部APIエンドポイント
  const apiUrl = `https://www.youtube.com/youtubei/v1/get_transcript`;

  // リクエストパラメータ
  const params = {
    context: {
      client: {
        clientName: 'WEB',
        clientVersion: '2.20240101.00.00'
      }
    },
    params: btoa(`\n\x0b${videoId}`)
  };

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params)
    });

    if (!response.ok) {
      throw new Error(`API応答エラー: ${response.status}`);
    }

    const data = await response.json();
    const actions = data?.actions?.[0]?.updateEngagementPanelAction?.content?.transcriptRenderer?.body?.transcriptBodyRenderer?.cueGroups;

    if (!actions || actions.length === 0) {
      throw new Error('字幕データが見つかりません');
    }

    const transcriptData = [];
    actions.forEach(cueGroup => {
      const cue = cueGroup?.transcriptCueGroupRenderer?.cues?.[0]?.transcriptCueRenderer;
      if (cue) {
        const start = parseFloat(cue.startOffsetMs) / 1000;
        const duration = parseFloat(cue.durationMs) / 1000;
        const text = cue.cue.simpleText;

        transcriptData.push({
          start,
          duration,
          text
        });
      }
    });

    return transcriptData;
  } catch (error) {
    console.error('[方法2] エラー:', error);
    throw error;
  }
}

// 方法3: timedtext APIを直接使用
async function fetchTranscriptionFromTimedText(videoId) {
  // 字幕の言語リストを試す（日本語優先）
  const languages = ['ja', 'en', 'ko', 'zh-Hans', 'zh-Hant'];

  for (const lang of languages) {
    try {
      console.log(`[方法3] 言語 ${lang} を試行中...`);

      // timedtext APIのURL
      const url = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}&fmt=srv3`;

      const response = await fetch(url);

      if (!response.ok) {
        console.log(`[方法3] 言語 ${lang} は利用できません`);
        continue;
      }

      const text = await response.text();

      // XMLをパース
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(text, 'text/xml');

      const textElements = xmlDoc.querySelectorAll('text');

      if (textElements.length === 0) {
        console.log(`[方法3] 言語 ${lang} に字幕データがありません`);
        continue;
      }

      const transcriptData = [];
      textElements.forEach(element => {
        const start = parseFloat(element.getAttribute('start'));
        const duration = parseFloat(element.getAttribute('dur') || '0');
        const text = element.textContent
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/\n/g, ' ')
          .trim();

        if (text) {
          transcriptData.push({
            start,
            duration,
            text
          });
        }
      });

      if (transcriptData.length > 0) {
        console.log(`[方法3] 言語 ${lang} で取得成功: ${transcriptData.length}件`);
        return transcriptData;
      }

    } catch (error) {
      console.warn(`[方法3] 言語 ${lang} でエラー:`, error.message);
      continue;
    }
  }

  throw new Error('すべての言語で字幕の取得に失敗しました');
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
