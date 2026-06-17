// ============================================================
// KONNEKT AI ナレッジハブ v2 — 事例登録 GAS エンドポイント
// ============================================================
// Script Properties に以下を設定してください:
//   CLAUDE_API_KEY   — Claude API キー
//   NOTION_TOKEN     — Notion Integration Token
//   SLACK_WEBHOOK_URL — Slack #ai-share Incoming Webhook URL
//   GITHUB_TOKEN     — GitHub PAT (repo スコープ)
// ============================================================

const NOTION_DB_ID     = '04dafa7303f84bc79b759196469c17c1';
const GITHUB_REPO      = 'fujimoto-cpu/cowork-guide';
const GITHUB_FILE_PATH = 'v2/data/cards.json';
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

    // 2. Claude Haiku でカテゴリ自動判定
    const { scenes, tags } = classifyWithClaude_(
      data.title, data.desc, data.tool,
      props.getProperty('CLAUDE_API_KEY')
    );

    // 3. cards.json 用 ID 生成
    const personKey = (data.person || 'anonymous').toLowerCase().replace(/[^a-z0-9]/g, '-');
    const cardId = `case-${personKey}-${Date.now()}`;

    // 4. Notion に保存
    saveToNotion_(data, scenes, tags, fileUrl, cardId, props.getProperty('NOTION_TOKEN'));

    // 5. cards.json 更新（GitHub API）
    updateCardsJson_(data, scenes, tags, fileUrl, cardId, props.getProperty('GITHUB_TOKEN'));

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
// 2. Claude Haiku でカテゴリ判定
// ------------------------------------------------------------
function classifyWithClaude_(title, desc, tool, apiKey) {
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

  const response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    payload: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    }),
    muteHttpExceptions: true,
  });

  try {
    const json = JSON.parse(response.getContentText());
    const text = json.content[0].text.trim();
    return JSON.parse(text);
  } catch (_) {
    // パース失敗時のフォールバック
    return { scenes: ['document'], tags: ['その他'] };
  }
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
    '説明': { rich_text: [{ text: { content: data.desc || '' } }] },
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

  const text = [
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
