/* CORI マスコット制御 API */

const CORI_QUOTES = {
  greet: [
    "やっほ〜！CORIだよ。今日も AI 活用していこ〜！",
    "おかえり！新しい事例 見てく？",
    "今月もう削減してる？",
    "誰かのスキルが、あなたの時間を救うかも！",
  ],
  encourage: [
    "あら、まだ事例がないみたい。1番乗りはきみ？",
    "条件を変えてもう一度探してみて！",
    "見つからなかったら、新しく登録するチャンスかも👀",
  ],
  celebrate: [
    "🎉 すごい！達成だね！",
    "✨ GMO 基準を超えたよ！",
    "🏆 共通ツール認定おめでとう！",
  ],
  invite: [
    "事例を登録すると評価にも繋がるよ📝",
    "あなたの工夫、他の人もきっと知りたい！",
    "ワークショップ前に登録しとくと発表ラクになるよ🚀",
  ],
};

async function fetchSvg() {
  // 現在のスクリプトのURL から mascot.svg の絶対パスを解決
  const scriptEl = document.currentScript || [...document.scripts].find((s) => s.src.includes("cori.js"));
  let base = "./assets/";
  if (scriptEl && scriptEl.src) {
    base = scriptEl.src.replace(/cori\.js.*$/, "");
  }
  const res = await fetch(base + "mascot.svg");
  if (!res.ok) throw new Error("mascot.svg not found at " + base);
  return res.text();
}

const CORI = {
  async load(targetEl, opts = {}) {
    const svg = await fetchSvg();
    const size = opts.size || 140;
    targetEl.innerHTML = `
      <div class="cori-wrap" style="width:${size}px;">
        <div class="cori-svg-host">${svg}</div>
        ${opts.bubble === false ? "" : '<div class="cori-bubble" style="display:none;"></div>'}
      </div>
    `;
    if (opts.message) CORI.say(targetEl, opts.message);
    if (opts.wave) CORI.wave(targetEl);
    return targetEl;
  },

  say(host, message) {
    const bubble = host.querySelector(".cori-bubble");
    if (!bubble) return;
    bubble.textContent = message;
    bubble.style.display = "block";
    bubble.classList.remove("cori-bubble-in");
    void bubble.offsetWidth;
    bubble.classList.add("cori-bubble-in");
  },

  random(host, category = "greet") {
    const pool = CORI_QUOTES[category] || CORI_QUOTES.greet;
    const msg = pool[Math.floor(Math.random() * pool.length)];
    CORI.say(host, msg);
  },

  wave(host) {
    const arm = host.querySelector(".cori-arm-left");
    if (arm) arm.classList.add("cori-wave");
  },

  jump(host) {
    const body = host.querySelector(".cori-svg");
    if (body) {
      body.classList.add("cori-jump");
      setTimeout(() => body.classList.remove("cori-jump"), 700);
    }
  },

  celebrate(host) {
    CORI.jump(host);
    CORI.random(host, "celebrate");
    if (window.confetti) {
      window.confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 },
        colors: ["#EC4899", "#8B5CF6", "#3B82F6", "#FCD34D", "#10B981"],
      });
    }
  },
};

window.CORI = CORI;
