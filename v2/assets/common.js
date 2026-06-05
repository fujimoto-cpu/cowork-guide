/* v2 共通スクリプト + ゲーミフィケーション拡張 (Phase 0.5) */

const ROLE_LABELS = {
  creative: { label: "企画・デザイン", icon: "🎨" },
  pm: { label: "PM・管理", icon: "📊" },
  backoffice: { label: "バックオフィス", icon: "📋" },
  sales: { label: "営業", icon: "💼" },
  cross: { label: "横断・共通", icon: "🔗" }
};

const ATTACHMENT_ICONS = {
  image: "🖼",
  pdf: "📄",
  pptx: "📊",
  docx: "📝",
  xlsx: "📈",
  video: "🎬",
  zip: "📦",
  other: "📎"
};

async function loadJSON(path) {
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

function formatMinutes(min) {
  if (min == null) return "—";
  if (min < 60) return `${min}分`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}時間`;
}

/* レアリティ判定：月間削減時間ベース */
function rarityFor(card) {
  const m = card.monthly_saved_minutes || (card.saved_minutes || 0);
  if (m >= 600) return 5;       // 月10h+
  if (m >= 240) return 4;       // 月4h+
  if (m >= 120) return 3;       // 月2h+
  if (m >= 30) return 2;        // 月30min+
  return 1;
}

function renderRarity(card) {
  const r = rarityFor(card);
  const stars = "⭐".repeat(r);
  return `<span class="rarity-badge" title="レアリティ ${r}/5">${stars}</span>`;
}

function renderRoleBadges(roles) {
  if (!Array.isArray(roles)) return "";
  return roles
    .map((r) => {
      const meta = ROLE_LABELS[r] || { label: r, icon: "•" };
      return `<span class="role-badge ${r}">${meta.icon} ${meta.label}</span>`;
    })
    .join(" ");
}

function renderTags(tags) {
  if (!Array.isArray(tags)) return "";
  return tags.map((t) => `<span class="tag-chip">${escapeHtml(t)}</span>`).join("");
}

function renderAttachment(att) {
  const icon = ATTACHMENT_ICONS[att.type] || ATTACHMENT_ICONS.other;
  const sizeKb = att.size_kb ? `${(att.size_kb / 1024).toFixed(1)}MB` : "";
  const caption = att.caption ? ` — ${escapeHtml(att.caption)}` : "";
  if (att.type === "image") {
    return `<a class="attachment-item" href="${att.url}" target="_blank">
      <span class="attachment-icon">${icon}</span>
      <span><strong>${escapeHtml(att.filename)}</strong>${caption} <span style="color:#9CA3AF">${sizeKb}</span></span>
    </a>`;
  }
  if (att.type === "video") {
    return `<div style="margin-bottom:8px;"><video controls style="max-width:100%;border-radius:8px;" src="${att.url}"></video>
      <div style="font-size:11px;color:#6B7280;margin-top:4px;">${escapeHtml(att.filename)}${caption}</div></div>`;
  }
  return `<a class="attachment-item" href="${att.url}" target="_blank">
    <span class="attachment-icon">${icon}</span>
    <span><strong>${escapeHtml(att.filename)}</strong>${caption} <span style="color:#9CA3AF">${sizeKb}</span></span>
  </a>`;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function matchSearch(card, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  const hay = [
    card.title,
    card.desc,
    card.person,
    card.tool,
    ...(card.tags || []),
    ...(card.role || [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

function renderCard(card) {
  const primaryRole = (card.role || [])[0] || "cross";
  const commonBadge = card.is_common_tool
    ? '<span class="common-tool-badge">⭐ 全社共通ツール</span>'
    : "";
  const personImg = card.person ? `<div class="person-chip"><span class="dot"></span>${escapeHtml(card.person)}</div>` : "";
  const savedPill = card.saved_minutes
    ? `<span class="stat-pill">⏱ 1回 -${formatMinutes(card.saved_minutes)}</span>`
    : card.stat_legacy
    ? `<span class="stat-pill">${escapeHtml(card.stat_legacy)}</span>`
    : "";
  const monthlyPill = card.monthly_saved_minutes
    ? `<span class="stat-pill" style="background:#FEF3C7;color:#92400E;">月 -${formatMinutes(card.monthly_saved_minutes)}</span>`
    : "";
  const toolChip = card.tool ? `<span class="tag-chip">🛠 ${escapeHtml(card.tool)}</span>` : "";
  const rarity = renderRarity(card);
  const attachStrip = (card.attachments || []).length
    ? `<div class="card-attach-strip">${card.attachments
        .slice(0, 4)
        .map((a) => `<span title="${escapeHtml(a.filename || a.type)}">${ATTACHMENT_ICONS[a.type] || ATTACHMENT_ICONS.other}</span>`)
        .join("")}</div>`
    : "";

  return `
    <div class="card" data-role="${primaryRole}" data-id="${escapeHtml(card.id)}" onclick="openCardModal('${escapeHtml(card.id)}')">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        ${rarity}
        ${commonBadge}
      </div>
      <div style="margin-bottom:8px;">${renderRoleBadges(card.role || [])}</div>
      <h3 class="card-title">${escapeHtml(card.title)}</h3>
      <p class="card-desc">${escapeHtml(card.desc || "")}</p>
      <div class="card-meta">
        ${personImg} ${savedPill} ${monthlyPill}
      </div>
      <div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px;">
        ${toolChip}${renderTags((card.tags || []).slice(0, 3))}
      </div>
      ${attachStrip}
    </div>
  `;
}

function renderCardDetail(card) {
  const attachments = (card.attachments || []).map(renderAttachment).join("");
  const skill = card.skill_link
    ? `<div style="margin:12px 0;padding:10px 14px;background:#F5F3FF;border-radius:8px;font-size:12px;">
        🛠 関連スキル: <code>${escapeHtml(card.skill_link)}</code>
      </div>`
    : "";
  const github = card.github_url
    ? `<a href="${card.github_url}" target="_blank" style="font-size:12px;color:#3B82F6;">GitHub →</a>`
    : "";
  const migrationNote = card.migration_note
    ? `<div style="background:#FEF3C7;color:#92400E;padding:8px 12px;border-radius:6px;font-size:11px;margin-bottom:12px;">
        📝 ${escapeHtml(card.migration_note)}
      </div>`
    : "";

  return `
    <div>
      ${migrationNote}
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;align-items:center;">
        ${renderRarity(card)}
        ${renderRoleBadges(card.role || [])}
        ${card.is_common_tool ? '<span class="common-tool-badge">⭐ 全社共通ツール</span>' : ""}
      </div>
      <h2 style="font-size:22px;font-weight:800;margin:0 0 12px;letter-spacing:-0.01em;">${escapeHtml(card.title)}</h2>
      <div style="display:flex;flex-wrap:wrap;gap:10px;font-size:12px;color:#6B7280;margin-bottom:16px;">
        ${card.person ? `<div>👤 <strong>${escapeHtml(card.person)}</strong></div>` : ""}
        ${card.tool ? `<div>🛠 ${escapeHtml(card.tool)}</div>` : ""}
        ${card.saved_minutes ? `<div>⏱ 1回あたり -${formatMinutes(card.saved_minutes)}</div>` : ""}
        ${card.monthly_saved_minutes ? `<div>📅 月 -${formatMinutes(card.monthly_saved_minutes)}</div>` : ""}
      </div>
      ${skill}
      ${github}
      <div style="margin:16px 0;">${card.detail || `<p>${escapeHtml(card.desc || "")}</p>`}</div>
      ${attachments ? `<h3 style="font-size:14px;font-weight:700;margin-top:20px;">📎 添付ファイル</h3>${attachments}` : ""}
      <div style="margin-top:24px;padding-top:12px;border-top:1px solid #E5E7EB;font-size:11px;color:#9CA3AF;">
        ${card.tags ? renderTags(card.tags) : ""}
        <div style="margin-top:6px;">更新: ${escapeHtml(card.updated_at || "")}</div>
      </div>
    </div>
  `;
}

/* ===== カウントアップ ===== */
function animateCount(el, target, opts = {}) {
  const duration = opts.duration || 1200;
  const decimals = opts.decimals || 0;
  const suffix = opts.suffix || "";
  const startVal = 0;
  const startTime = Date.now();
  const finalText = target.toFixed(decimals) + suffix;

  function tick() {
    const elapsed = Date.now() - startTime;
    const p = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    const val = startVal + (target - startVal) * eased;
    el.textContent = val.toFixed(decimals) + suffix;
    if (p < 1) {
      requestAnimationFrame(tick);
    } else {
      el.textContent = finalText;
    }
  }
  requestAnimationFrame(tick);

  // 保険：rAF が動かない環境でも最終値は必ず表示
  setTimeout(() => {
    if (el.textContent === "0" || el.textContent === "0" + suffix) {
      el.textContent = finalText;
    }
  }, duration + 800);
}

function observeCountUps() {
  document.querySelectorAll("[data-count]").forEach((el) => {
    if (el.dataset.counted) return;
    const target = parseFloat(el.dataset.count);
    const decimals = parseInt(el.dataset.decimals || "0", 10);
    const suffix = el.dataset.suffix || "";
    animateCount(el, target, { decimals, suffix });
    el.dataset.counted = "1";
  });
}

/* ===== モーダル ===== */
window._cardsCache = [];
window.openCardModal = function (id) {
  const card = window._cardsCache.find((c) => c.id === id);
  if (!card) return;
  const modal = document.getElementById("card-modal");
  if (!modal) return;
  document.getElementById("modal-body").innerHTML = renderCardDetail(card);
  modal.classList.add("active");
};
window.closeCardModal = function () {
  document.getElementById("card-modal")?.classList.remove("active");
};
