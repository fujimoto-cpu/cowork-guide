// ============================================================
// KONNEKT AI ナレッジハブ v2 — 事例登録 GAS エンドポイント
// ============================================================
// Script Properties に以下を設定してください:
//   GEMINI_API_KEY   — Google AI Studio の API キー（無料）
//   NOTION_TOKEN     — Notion Integration Token
//   SLACK_WEBHOOK_URL — Slack #ai-share Incoming Webhook URL
//   GITHUB_TOKEN     — GitHub PAT (repo スコープ)
// ============================================================

const NOTION_DB_ID     = '38f7f11c9bd08097961bc9d6959cd80c';
const GITHUB_REPO      = 'fujimoto-cpu/cowork-guide';
const GITHUB_FILE_PATH = 'v2/data/cards.json';
const GITHUB_TOOLS_PATH = 'v2/data/tools.json';   // 2026-08-03 追加：ツール台帳
const DRIVE_FOLDER_NAME = 'KONNEKT AI活用事例 添付ファイル';

// scenes.json の id 一覧（カテゴリ判定用）
const SCENES = [
  { id: 'morning-brief',   label: '朝のブリーフィング' },
  { id: 'calendar-add',   label: 'カレンダー登録' },
  { id: 'mail-reply',     label: 'メール返信' },
  { id: 'minutes',        label: '議事録' },
  { id: 'slack-share',    label: 'Slack共有' },
  { id: 'research',       label: 'リサーチ' },
  { id: 'brand-analysis', label: 'ブランド分析' },
  { id: 'trend-collect',  label: 'トレンド収集' },
  { id: 'document',       label: '資料作成' },
  { id: 'proposal',       label: '提案資料' },
  { id: 'product-image',  label: '商品画像作成' },
  { id: 'design-template',label: 'デザイン版下' },
  { id: 'translation',    label: '韓国語翻訳' },
  { id: 'sns-schedule',   label: 'SNSスケジュール' },
  { id: 'auto-check',     label: 'AI自動判定' },
  { id: 'video-caption',  label: '動画字幕・編集' },
  { id: 'expense',        label: '経費申請' },
  { id: 'receipt',        label: 'レシート読取' },
  { id: 'shift',          label: 'シフト・人事' },
  { id: 'pl',             label: 'PL・予算' },
];

const TAGS = ['デザイン', '自動化', '資料作成', 'SNS', '経費', 'カレンダー', '初心者向け', 'その他'];

// Gemini のモデルは定期的に廃止される（旧 gemini-1.5-flash は 2026 年に完全 shutdown ＝ 404）。
// 1つに固定すると廃止された瞬間に静かにフォールバック値（その他／document）へ落ちるので、
// 生きているものが見つかるまで順に試す。先頭が新しい。
const MODEL_CANDIDATES = ['gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-flash-latest'];

// ------------------------------------------------------------
// メインエントリ
// ------------------------------------------------------------
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const props = PropertiesService.getScriptProperties();

    // 1. ファイルアップロード（添付あれば Google Drive へ）
    let fileUrl = null;
    if (data.file_base64 && data.file_name) {
      fileUrl = uploadToDrive_(data.file_base64, data.file_name, data.file_type);
    }

    // 2026-08-03 追加：登録種別で分岐（'tool' = 社内ツール台帳 / 既定 = 活用事例）
    // 旧フォーム（type を送ってこない）からのPOSTは今まで通り case として扱う＝後方互換。
    const isTool = data.type === 'tool';

    // 2. Gemini でカテゴリ自動判定（事例のみ。ツールはエリアをフォームで選ばせている）
    const { scenes, tags } = isTool
      ? { scenes: [], tags: ['ツール'] }
      : classifyWithGemini_(data.title, data.desc, data.tool, props.getProperty('GEMINI_API_KEY'));

    // 3. ID 生成
    // ★2026-08-03 修正：日本語名は [^a-z0-9] 置換で全文字がハイフンになり
    //   「藤本有璃子」→ 'case-------123' のようなIDが生まれていた。
    //   ハブ側のテスト判定 /^case-----/ に一致してしまい、日本語名の投稿が
    //   すべて「テスト投稿」として非表示にされていた（登録が消える主因）。
    //   連続ハイフンを畳み、英数字が1文字も残らない場合は 'member' を使う。
    const personKey = (data.person || 'anonymous').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'member';
    const cardId = `${isTool ? 'tool' : 'case'}-${personKey}-${Date.now()}`;

    // 4. Notion に保存（トークン未設定時はスキップ）
    //    ツールも同じDBに入れる（既存プロパティのみ使用＝DBスキーマ変更不要。
    //    タグの 'ツール' で事例と区別できる）。KONNEKT方針＝ナレッジはNotionに集約。
    const notionToken = props.getProperty('NOTION_TOKEN');
    if (notionToken) {
      saveToNotion_(data, scenes, tags, fileUrl, cardId, notionToken);
    }

    // 5. GitHub API でデータ更新
    if (isTool) {
      updateToolsJson_(data, cardId, props.getProperty('GITHUB_TOKEN'));
    } else {
      updateCardsJson_(data, scenes, tags, fileUrl, cardId, props.getProperty('GITHUB_TOKEN'));
    }

    // 6. Slack #ai-share に投稿
    postToSlack_(data, scenes, tags, cardId, props.getProperty('SLACK_WEBHOOK_URL'));

    return ContentService
      .createTextOutput(JSON.stringify({ success: true, id: cardId }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    console.error(err);
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ------------------------------------------------------------
// 1. Google Drive アップロード
// ------------------------------------------------------------
function uploadToDrive_(base64, fileName, mimeType) {
  // 共有フォルダを取得 or 作成
  let folders = DriveApp.getFoldersByName(DRIVE_FOLDER_NAME);
  let folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(DRIVE_FOLDER_NAME);

  const decoded = Utilities.base64Decode(base64);
  const blob = Utilities.newBlob(decoded, mimeType || 'application/octet-stream', fileName);
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

// ------------------------------------------------------------
// 2. Gemini でカテゴリ判定（無料枠：1日1500リクエスト）
// ------------------------------------------------------------
function classifyWithGemini_(title, desc, tool, apiKey) {
  const scenesList = SCENES.map(s => `${s.id} (${s.label})`).join(', ');
  const tagsList = TAGS.join(', ');

  const prompt = `以下のAI活用事例をカテゴリ判定してください。

タイトル: ${title}
説明: ${desc || ''}
ツール: ${tool || ''}

利用可能なscenes（1〜3つ選択、id で返す）:
${scenesList}

利用可能なtags（1〜3つ選択）:
${tagsList}

必ず以下のJSON形式のみで返してください（説明不要）:
{"scenes": ["scene-id"], "tags": ["タグ名"]}`;

  const FALLBACK = { scenes: ['document'], tags: ['その他'] };
  if (!apiKey) {
    console.warn('GEMINI_API_KEY が未設定。分類をフォールバック値にした。');
    return FALLBACK;
  }

  for (var i = 0; i < MODEL_CANDIDATES.length; i++) {
    const model = MODEL_CANDIDATES[i];
    const r = callGemini_(model, prompt, apiKey);
    if (r.parsed) return r.parsed;
    console.warn(`Gemini ${model} 失敗: ${r.why}`);
  }

  console.warn('Gemini のモデル候補が全滅。分類をフォールバック値にした。');
  return FALLBACK;
}

// ------------------------------------------------------------
// 2-a. Gemini 1回呼び出し（結果と失敗理由を必ず返す）
// ------------------------------------------------------------
// 2.5 以降のモデルは「思考」に出力トークンを使う。maxOutputTokens が小さいと
// 思考だけで枯渇して本文が空になり（finishReason: MAX_TOKENS）、
// 静かにフォールバックへ落ちる。だから枠を広げ、思考は明示的に切る。
// thinkingConfig を受け付けないモデルには 400 が返るので、その時だけ外して再試行する。
function callGemini_(model, prompt, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  function post(useThinkingConfig) {
    const gc = { maxOutputTokens: 2048, temperature: 0.1, responseMimeType: 'application/json' };
    if (useThinkingConfig) gc.thinkingConfig = { thinkingBudget: 0 };
    return UrlFetchApp.fetch(url, {
      method: 'post',
      headers: { 'Content-Type': 'application/json' },
      payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: gc }),
      muteHttpExceptions: true,
    });
  }

  let res = post(true);
  if (res.getResponseCode() === 400) res = post(false);   // thinkingConfig 非対応モデル用

  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code !== 200) {
    return { parsed: null, why: `HTTP ${code} — ${body.slice(0, 300)}`, code, body };
  }

  let json;
  try {
    json = JSON.parse(body);
  } catch (e) {
    return { parsed: null, why: `レスポンスがJSONでない: ${body.slice(0, 200)}`, code, body };
  }

  const cand = (json.candidates || [])[0];
  const finish = cand && cand.finishReason;
  const text = cand && cand.content && cand.content.parts && cand.content.parts[0]
    ? cand.content.parts[0].text : null;

  if (!text) {
    return {
      parsed: null,
      why: `本文が空（finishReason=${finish} / usage=${JSON.stringify(json.usageMetadata || {})}）`,
      code, body, finish,
    };
  }

  const cleaned = text.trim().replace(/```json\n?/g, '').replace(/```/g, '');
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && parsed.scenes && parsed.tags) return { parsed, why: 'ok', code, body, finish };
    return { parsed: null, why: `JSONだが scenes/tags が無い: ${cleaned.slice(0, 200)}`, code, body, finish };
  } catch (e) {
    return { parsed: null, why: `本文がJSONとして読めない: ${cleaned.slice(0, 200)}`, code, body, finish };
  }
}

// ------------------------------------------------------------
// 2-c. 分類の実地テスト（GASエディタで手動実行する用）
// ------------------------------------------------------------
// 使い方：関数リストで testClassify を選んで「実行」。
// 実際の分類プロンプトを投げて、モデルごとの結果と失敗理由を実行ログに出す。
// ※デプロイは不要（エディタ上の最新コードで動く）。
function testClassify() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) { console.log('GEMINI_API_KEY が未設定'); return; }

  const title = '会議の議事録を自動作成';
  const desc  = '会議の音声ファイルを渡すだけで議事録が自動で作成される。手作業の書き起こしと整形が不要になった。';
  const tool  = 'Claude Code';
  const prompt = `以下のAI活用事例をカテゴリ判定してください。

タイトル: ${title}
説明: ${desc}
ツール: ${tool}

利用可能なscenes（1〜3つ選択、id で返す）:
${SCENES.map(s => `${s.id} (${s.label})`).join(', ')}

利用可能なtags（1〜3つ選択）:
${TAGS.join(', ')}

必ず以下のJSON形式のみで返してください（説明不要）:
{"scenes": ["scene-id"], "tags": ["タグ名"]}`;

  const lines = ['===== 分類テスト ====='];
  MODEL_CANDIDATES.forEach(model => {
    const r = callGemini_(model, prompt, apiKey);
    if (r.parsed) {
      lines.push(`✅ ${model} → scenes=${JSON.stringify(r.parsed.scenes)} tags=${JSON.stringify(r.parsed.tags)}`);
    } else {
      lines.push(`❌ ${model} → ${r.why}`);
    }
  });
  lines.push('======================');
  lines.push('※ ✅が1つでも出れば分類は復活。全部❌なら理由がその行に出ている。');
  console.log(lines.join('\n'));
}

// ------------------------------------------------------------
// 2-b. セットアップ自己診断（GASエディタで手動実行する用）
// ------------------------------------------------------------
// 使い方：GASエディタ上部の関数リストで testSetup を選んで「実行」。
// 下の「実行ログ」に、鍵4本の設定状況と Gemini が生きているかが出る。
function testSetup() {
  const props = PropertiesService.getScriptProperties();
  const keys = ['GEMINI_API_KEY', 'NOTION_TOKEN', 'SLACK_WEBHOOK_URL', 'GITHUB_TOKEN'];
  const lines = ['===== セットアップ診断 ====='];

  keys.forEach(k => {
    const v = props.getProperty(k);
    lines.push(`${v ? '✅ 設定済み' : '❌ 未設定  '}  ${k}${v ? `（${v.length}文字）` : ''}`);
  });

  // Gemini のモデルが生きているか（キーがある時だけ）
  const apiKey = props.getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    lines.push('— Gemini: APIキーが無いので確認をスキップ');
  } else {
    MODEL_CANDIDATES.forEach(model => {
      const res = UrlFetchApp.fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'post',
          headers: { 'Content-Type': 'application/json' },
          payload: JSON.stringify({ contents: [{ parts: [{ text: 'ping。"ok"だけ返して。' }] }] }),
          muteHttpExceptions: true,
        }
      );
      const code = res.getResponseCode();
      // ⚠ これは「APIが応答するか」だけの確認。実際に分類できるかは別問題
      //   （2026-08-01：ここが全部✅なのに分類はフォールバックだった）。
      //   分類そのものの確認は testClassify を使う。
      const verdict = code === 200 ? '○ 応答あり'
        : code === 404 ? '❌ このモデルは廃止済み'
        : code === 403 ? '❌ キーが無効か権限なし'
        : code === 429 ? '⚠ 無料枠の上限'
        : `❌ ${code}`;
      lines.push(`Gemini ${model} → ${verdict}`);
    });
    lines.push('  ※ 応答ありは「APIが生きてる」だけ。分類できるかは testClassify で確認');
  }

  // Notion DB に届くか（トークンがある時だけ）
  const notionToken = props.getProperty('NOTION_TOKEN');
  if (!notionToken) {
    lines.push('— Notion: トークンが無いので確認をスキップ');
  } else {
    const res = UrlFetchApp.fetch(`https://api.notion.com/v1/databases/${NOTION_DB_ID}`, {
      headers: { 'Authorization': `Bearer ${notionToken}`, 'Notion-Version': '2022-06-28' },
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    lines.push(code === 200
      ? '✅ Notion「AI活用事例DB」に届いた'
      : code === 404
        ? '❌ Notion 404 — DBにインテグレーションを接続していない（DBの ••• → 接続 → 追加）'
        : `❌ Notion ${code}: ${res.getContentText().slice(0, 200)}`);
  }

  lines.push('============================');
  console.log(lines.join('\n'));
  return lines.join('\n');
}

// ------------------------------------------------------------
// 3. Notion DB に保存
// ------------------------------------------------------------
function saveToNotion_(data, scenes, tags, fileUrl, cardId, token) {
  const today = new Date().toISOString().split('T')[0];

  const properties = {
    'タイトル': { title: [{ text: { content: data.title || '' } }] },
    '投稿者': { rich_text: [{ text: { content: data.person || '' } }] },
    'ツール名': { rich_text: [{ text: { content: data.tool || '' } }] },
    '役割': { multi_select: (data.role || []).map(r => ({ name: r })) },
    'Before（分）': { number: data.before_minutes ? Number(data.before_minutes) : null },
    'After（分）': { number: data.after_minutes ? Number(data.after_minutes) : null },
    '月次頻度': { number: data.monthly_frequency ? Number(data.monthly_frequency) : null },
    // ツール登録のときは置き場所URLも説明に含める（DBスキーマを変えずに情報を落とさないため）
    '説明': { rich_text: [{ text: { content: data.type === 'tool'
        ? `${data.desc || ''}${data.tool_url ? `\n📍 ${data.tool_url}` : '\n📍 場所未定'}`
        : (data.desc || '') } }] },
    'タグ': { multi_select: tags.map(t => ({ name: t })) },
    'Scenes': { multi_select: scenes.map(s => ({ name: s })) },
    '添付ファイルURL': { rich_text: [{ text: { content: fileUrl || '' } }] },
    'cards_id': { rich_text: [{ text: { content: cardId } }] },
    '投稿日': { date: { start: today } },
    'Status': { select: { name: 'published' } },
  };

  UrlFetchApp.fetch('https://api.notion.com/v1/pages', {
    method: 'post',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    payload: JSON.stringify({
      parent: { database_id: NOTION_DB_ID },
      properties,
    }),
    muteHttpExceptions: true,
  });
}

// ------------------------------------------------------------
// 4-b. GitHub API で tools.json 更新（2026-08-03 新設）
//      01「社内ツール」台帳。cards.json と違い areas / kind / url を持つ。
// ------------------------------------------------------------
function updateToolsJson_(data, toolId, token) {
  const apiBase = `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_TOOLS_PATH}`;

  const getRes = UrlFetchApp.fetch(apiBase, {
    headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' },
  });
  const getJson = JSON.parse(getRes.getContentText());
  const sha = getJson.sha;
  const current = JSON.parse(Utilities.newBlob(Utilities.base64Decode(getJson.content.replace(/\n/g, ''))).getDataAsString());

  const url = (data.tool_url || '').trim();
  // 置き場所ラベル：URLがあればホスト名（+パス先頭）、無ければ「作った人に聞く」
  let locLabel, ask = false;
  if (url) {
    locLabel = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  } else {
    locLabel = `❓ 場所確認中（${data.person || '登録者'}に聞く）`;
    ask = true;
  }

  const newTool = {
    id: toolId,
    icon: (data.tool_icon || '').trim() || '🧰',
    name: data.title || '',
    owner: data.person || '',
    kind: ['common', 'personal', 'system'].indexOf(data.tool_kind) >= 0 ? data.tool_kind : 'personal',
    dekiru: data.desc || '',
    url: url || null,
    loc_label: locLabel,
    areas: Array.isArray(data.tool_areas) ? data.tool_areas : [],
    registered_at: new Date().toISOString().split('T')[0],
  };
  if (ask) newTool.ask = true;

  current.push(newTool);

  const updated = Utilities.base64Encode(
    Utilities.newBlob(JSON.stringify(current, null, 2)).getBytes()
  );

  UrlFetchApp.fetch(apiBase, {
    method: 'put',
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json',
    },
    contentType: 'application/json',
    payload: JSON.stringify({
      message: `feat: add tool ${toolId} by ${data.person || 'anonymous'}`,
      content: updated,
      sha,
    }),
    muteHttpExceptions: true,
  });
}

// ------------------------------------------------------------
// 4. GitHub API で cards.json 更新
// ------------------------------------------------------------
function updateCardsJson_(data, scenes, tags, fileUrl, cardId, token) {
  const apiBase = `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`;

  // 現在の cards.json を取得
  const getRes = UrlFetchApp.fetch(apiBase, {
    headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' },
  });
  const getJson = JSON.parse(getRes.getContentText());
  const sha = getJson.sha;
  const current = JSON.parse(Utilities.newBlob(Utilities.base64Decode(getJson.content.replace(/\n/g, ''))).getDataAsString());

  // 新エントリを追加
  const before = Number(data.before_minutes) || 0;
  const after  = Number(data.after_minutes)  || 0;
  const freq   = Number(data.monthly_frequency) || 0;

  const newCard = {
    id: cardId,
    version: 2,
    type: 'case',
    title: data.title || '',
    person: data.person || '',
    person_slack_id: null,
    role: data.role || [],
    tool: data.tool || '',
    before_minutes: before,
    after_minutes: after,
    saved_minutes: before - after,
    monthly_frequency: freq,
    monthly_saved_minutes: (before - after) * freq,
    tags,
    is_common_tool: false,
    common_tool_status: null,
    desc: data.desc || '',
    detail: `<p>${(data.detail || data.desc || '').replace(/\n/g, '<br>')}</p>`,
    skill_link: null,
    github_url: null,
    attachments: fileUrl ? [fileUrl] : [],
    stat_legacy: before && after ? `月${Math.round((before - after) * freq / 60 * 10) / 10}時間の削減` : '',
    created_at: new Date().toISOString().split('T')[0],
    updated_at: new Date().toISOString().split('T')[0],
    presented_at: null,
    scenes,
  };

  current.push(newCard);

  const newContent = Utilities.base64Encode(
    Utilities.newBlob(JSON.stringify(current, null, 2)).getBytes()
  );

  UrlFetchApp.fetch(apiBase, {
    method: 'put',
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    payload: JSON.stringify({
      message: `feat: add case ${cardId} by ${data.person || 'anonymous'}`,
      content: newContent,
      sha,
    }),
    muteHttpExceptions: true,
  });
}

// ------------------------------------------------------------
// 5. Slack #ai-share 投稿
// ------------------------------------------------------------
function postToSlack_(data, scenes, tags, cardId, webhookUrl) {
  if (!webhookUrl) return;

  const saved = (Number(data.before_minutes) - Number(data.after_minutes)) * Number(data.monthly_frequency);
  const savedText = saved > 0 ? `⏱ 月${Math.round(saved)}分削減` : '';
  const sceneLabels = scenes.map(id => {
    const s = SCENES.find(s => s.id === id);
    return s ? s.label : id;
  }).join(' / ');

  const text = data.type === 'tool'
    ? [
        `🧰 *新しい社内ツールが登録されました！*`,
        `*${data.tool_icon || '🧰'} ${data.title}*  by ${data.person || '匿名'}`,
        `✨ ${data.desc || ''}`,
        data.tool_url ? `📍 ${data.tool_url}` : `📍 場所確認中（${data.person || '登録者'}に聞く）`,
        `\nhttps://fujimoto-cpu.github.io/cowork-guide/v2/`,
      ].filter(Boolean).join('\n')
    : [
        `📣 *新しい活用事例が登録されました！*`,
        `*${data.title}*  by ${data.person || '匿名'}`,
        `🛠 ${data.tool || '—'}　${savedText}`,
        sceneLabels ? `🏷 ${sceneLabels}` : '',
        `\nhttps://fujimoto-cpu.github.io/cowork-guide/v2/`,
      ].filter(Boolean).join('\n');

  UrlFetchApp.fetch(webhookUrl, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ text }),
    muteHttpExceptions: true,
  });
}
