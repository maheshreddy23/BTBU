// ============================================================================
// BTBU v26 — Be The Best You
// Vanilla JS PWA. Screens: Home (dashboard) · Today (check-off) · Days · Stats · You.
// Data lives in localStorage on this device; v1 (btbu_data) and v25 (btbu_v2_*)
// data are migrated on first run and the originals are left untouched.
// ============================================================================

// Web Push reminders stay dormant until the Supabase function is deployed.
// Fill these in and set enabled:true — see README "Turning on reminders".
const PUSH_CONFIG = { enabled: false, vapidPublicKey: "", subscribeUrl: "" };

// Keys are shared with sync.js (v25 schema), so encrypted cloud sync carries everything across devices.
const K = { habits: "btbu_v2_habits", comps: "btbu_v2_completions", frozen: "btbu_freezes" };
const PREF_KEYS = { name: "btbu_display_name", handle: "btbu_username", photo: "btbu_avatar_user", mode: "btbu_theme", theme: "btbu_look", reminder: "btbu_reminder", pushOn: "btbu_push_on", onboarded: "btbu_v26_onboarded" };
const FREEZES_PER_MONTH = 2;
const GRAD = "linear-gradient(135deg,#9b7cff,#ff7ba0)";

const TEMPLATES = [
  { category: "Health & Wellness", icon: "🌿", habits: ["Drink 8 glasses of water", "Sleep 7+ hours", "Take vitamins", "Eat 3 servings of vegetables", "No sugary drinks"] },
  { category: "Mindfulness", icon: "🧘", habits: ["10-minute meditation", "5-minute gratitude journal", "Mindful breathing break", "Digital detox hour", "Evening reflection"] },
  { category: "Fitness", icon: "💪", habits: ["30-minute walk", "Workout session", "Stretch or yoga", "Take the stairs", "10,000 steps"] },
  { category: "Learning", icon: "📚", habits: ["Read 20 pages", "Practice a language", "Study or coursework", "Learn something new", "Watch educational content"] },
  { category: "Productivity", icon: "🎯", habits: ["Plan tomorrow tonight", "Top 3 priorities", "No social media before noon", "Tidy workspace", "Inbox zero"] }
];
// Per-habit identity, matched by keyword so typed habits get one too.
const META = [
  [/water|drink|hydrat/, "💧", "#4fc3f7"], [/walk|steps|stairs|run/, "🏃", "#ffd166"],
  [/read|pages|book/, "📚", "#a78bfa"], [/meditat|breath|mindful|pray|chant/, "🧘", "#06d6a0"],
  [/sleep|bed|wake/, "😴", "#ff7ba0"], [/plan|priorit|inbox|tidy|workspace/, "🎯", "#f78c6b"],
  [/workout|stretch|yoga|gym|exercise/, "💪", "#ff5f8f"], [/vitamin|veget|sugar|eat|fruit|diet/, "🥗", "#8ce99a"],
  [/journal|reflect|gratitude|write/, "✍️", "#c9bfff"], [/language|study|course|learn|educat/, "🧠", "#74c0fc"],
  [/social|detox|screen|phone/, "📵", "#ffa8a8"]
];
const meta = t => { const s = t.toLowerCase(); for (const [re, emoji, color] of META) if (re.test(s)) return { emoji, color }; return { emoji: "✦", color: "#9b7cff" }; };

// ---------- dates ----------
const key = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const parseKey = k => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
const shift = n => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return d; };
const todayKey = () => key(new Date());
const lastKeys = n => { const o = []; for (let i = n - 1; i >= 0; i--) o.push(key(shift(-i))); return o; };
const fmt = (k, o) => parseKey(k).toLocaleDateString("en", o);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => "h" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ---------- store ----------
const read = (k, f) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? f : v; } catch (e) { return f; } };
const db = {};
function load() {
  db.habits = read(K.habits, null); db.comps = read(K.comps, {}); db.frozen = read(K.frozen, {});
  db.prefs = {};
  for (const f in PREF_KEYS) { const v = localStorage.getItem(PREF_KEYS[f]); if (v !== null && v !== "") db.prefs[f] = v; }
  if (db.prefs.mode === "auto") db.prefs.mode = "system";
  db.prefs.pushOn = db.prefs.pushOn === "true"; db.prefs.onboarded = db.prefs.onboarded === "true";
}
load();
function save() {
  localStorage.setItem(K.habits, JSON.stringify(db.habits || []));
  localStorage.setItem(K.comps, JSON.stringify(db.comps));
  if (Object.keys(db.frozen).length) localStorage.setItem(K.frozen, JSON.stringify(db.frozen)); else localStorage.removeItem(K.frozen);
  for (const f in PREF_KEYS) {
    let v = db.prefs[f];
    if (f === "mode" && v === "system") v = "auto";          // v25 stores "auto"
    if (typeof v === "boolean") v = v ? "true" : "";
    if (v == null || v === "") localStorage.removeItem(PREF_KEYS[f]); else localStorage.setItem(PREF_KEYS[f], String(v));
  }
  const best = bestStreak(), prev = parseInt(localStorage.getItem("btbu_best_streak") || "0", 10) || 0;
  if (best > prev) localStorage.setItem("btbu_best_streak", String(best));
  scheduleSync();
}
// Push local edits shortly after they happen instead of waiting for the 60 s poll.
let syncT;
function scheduleSync() { if (!window.BTBU_SYNC || !BTBU_SYNC.isReady()) return; clearTimeout(syncT); syncT = setTimeout(() => BTBU_SYNC.syncNow(), 1500); }
const syncStatus = () => (window.BTBU_SYNC && BTBU_SYNC.status()) || {};
const syncIs = name => !!(window.BTBU_SYNC && BTBU_SYNC.status().state === BTBU_SYNC.STATES[name]);

function migrate() {
  if (db.habits) return;
  db.habits = [];
  // v25 data already lives under these keys. Only v1-era devices need converting.
  {
    // v1 (current GitHub main): { "Mon Oct 13 2026": [{text, done}] }
    const v1 = read("btbu_data", null);
    if (v1 && typeof v1 === "object") {
      const byText = {};
      Object.keys(v1).map(s => ({ s, d: new Date(s) })).filter(x => !isNaN(x.d)).sort((a, b) => a.d - b.d).forEach(({ s, d }) => {
        const k = key(d);
        (v1[s] || []).forEach(h => {
          if (!h || !h.text) return;
          if (!byText[h.text]) { byText[h.text] = { id: uid(), text: h.text, created_at: k, archived_at: null }; db.habits.push(byText[h.text]); }
          if (h.done) (db.comps[k] = db.comps[k] || []).push(byText[h.text].id);
        });
      });
    }
  }
  save();
}

// ---------- derived ----------
const activeOn = k => db.habits.filter(h => h.created_at <= k && (!h.archived_at || k < h.archived_at));
const doneOn = k => db.comps[k] || [];
const rate = k => { const a = activeOn(k).length; return a ? Math.min(1, doneOn(k).filter(id => activeOn(k).some(h => h.id === id)).length / a) : null; };
const dayOk = k => doneOn(k).length > 0 || !!db.frozen[k];
const startKey = () => db.habits.reduce((m, h) => !m || h.created_at < m ? h.created_at : m, null);

function streak() {
  let i = dayOk(todayKey()) ? 0 : 1, c = 0;
  for (;; i++) { const k = key(shift(-i)); if (!activeOn(k).length || !dayOk(k)) break; c++; }
  return c;
}
function bestStreak() {
  const s = startKey(); if (!s) return 0;
  let best = 0, run = 0; const t = todayKey();
  for (const d = parseKey(s); key(d) <= t; d.setDate(d.getDate() + 1)) {
    const k = key(d);
    if (activeOn(k).length && dayOk(k)) { run++; best = Math.max(best, run); }
    else if (k !== t) run = 0;
  }
  return best;
}
const monthKey = () => todayKey().slice(0, 7);
const freezesLeft = () => FREEZES_PER_MONTH - Object.values(db.frozen).filter(m => m === monthKey()).length;
// The most recent missed day in the last 3 that a freeze could rescue.
function freezeCandidate() {
  for (let i = 1; i <= 3; i++) { const k = key(shift(-i)); if (!activeOn(k).length) return null; if (!dayOk(k)) return k; }
  return null;
}
function habitRun(h) {
  let run = 0;
  for (let i = doneOn(todayKey()).includes(h.id) ? 0 : 1; ; i++) { const k = key(shift(-i)); if (h.created_at > k || !doneOn(k).includes(h.id)) break; run++; }
  return run;
}

// ---------- ui state ----------
const ui = { screen: "home", sheet: null, dayKey: null, tplSel: [], hit: null, draft: "", ob: 0, obSel: [], scrollDays: false };
const $ = id => document.getElementById(id);
let toastT;
function toast(m) { const t = $("toast"); t.textContent = m; t.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 2200); }

function applyTheme() {
  const p = db.prefs, root = document.documentElement;
  let m = p.mode || "system";
  if (m === "system") m = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  root.dataset.theme = p.theme || "genz"; root.dataset.mode = m;
  const bg = getComputedStyle(root).getPropertyValue("--bg").trim();
  document.querySelector('meta[name="theme-color"]').setAttribute("content", bg || "#0c0a12");
}

function setDone(id, k, on) {
  const l = (db.comps[k] || []).filter(x => x !== id);
  if (on) l.push(id);
  if (l.length) db.comps[k] = l; else delete db.comps[k];
  ui.hit = on ? id + "@" + k : null;
  save(); render();
}

// ---------- screens ----------
const greeting = () => { const h = new Date().getHours(), n = (db.prefs.name || "").trim().split(" ")[0]; const w = h < 12 ? "gm" : h < 18 ? "hey" : "evening"; return n ? w + ", " + esc(n.toLowerCase()) : w; };

function homeView() {
  const t = todayKey(), act = activeOn(t), done = doneOn(t), left = Math.max(0, act.length - done.length), s = streak();
  const bars = lastKeys(14).map(k => { const r = rate(k), fz = db.frozen[k];
    const bg = fz ? "var(--ice-b)" : r === null ? "var(--chip)" : r >= .99 ? GRAD : r >= .5 ? "rgba(155,124,255,.65)" : r > 0 ? "rgba(155,124,255,.3)" : "var(--chip)";
    return `<i style="height:${Math.max(8, Math.round((fz ? .5 : r || 0) * 100))}%;background:${bg}"></i>`; }).join("");
  const avg = n => { const v = lastKeys(n).map(rate).filter(r => r !== null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length * 100) : 0; };
  const a7 = avg(7), a14 = avg(14);
  const momentum = a7 >= a14 ? `Last 7 days at ${a7}% — ${a7 > a14 ? "trending up" : "holding steady"}` : `Last 7 days at ${a7}%, down from ${a14}%`;

  const fl = freezesLeft(), cand = freezeCandidate();
  const ice = Array.from({ length: FREEZES_PER_MONTH }, (_, i) => `<div class="ice${i < fl ? "" : " used"}">${i < fl ? "❄" : ""}</div>`).join("");
  const freezeAction = cand && fl > 0
    ? `<button class="pill" data-act="freeze" data-k="${cand}" style="margin-top:12px;width:100%;white-space:nowrap;padding:10px 8px">Save ${fmt(cand, { weekday: "short" })} ${parseKey(cand).getDate()}</button>`
    : `<div class="note" style="margin-top:auto;padding-top:12px">${fl} left this month — rescues a missed day</div>`;

  const now = new Date(), y = now.getFullYear(), mo = now.getMonth(), dim = new Date(y, mo + 1, 0).getDate();
  let ad = 0, tc = 0, th = 0, bd = 0;
  for (let d = 1; d <= Math.min(dim, now.getDate()); d++) { const k = key(new Date(y, mo, d)), a = activeOn(k).length; if (!a) continue; const c = doneOn(k).length; if (c) ad++; tc += c; th += a; bd = Math.max(bd, Math.round(Math.min(1, c / a) * 100)); }

  const k14 = lastKeys(14);
  const weak = act.map(h => { let n = 0, d = 0; for (const k of k14) { if (h.created_at > k) continue; d++; if (doneOn(k).includes(h.id)) n++; } return { h, p: d ? n / d : 0 }; }).sort((a, b) => a.p - b.p)[0];
  let focus = `<div class="card focus" data-act="go" data-s="today"><div class="chip">✦</div><div style="flex:1"><div class="kicker">Start here</div><div class="lead" style="margin:4px 0 0">Add your first habit</div></div><div style="color:var(--muted);font-size:18px">›</div></div>`;
  if (weak) { const m = meta(weak.h.text), ok = done.includes(weak.h.id);
    focus = `<div class="card focus" data-act="go" data-s="today" style="${ok ? `border-color:${m.color};background:transparent` : ""}">
      <div class="chip" style="${ok ? `background:${m.color}` : ""}">${m.emoji}</div>
      <div style="flex:1;min-width:0"><div class="kicker">${ok ? "Handled today" : "Needs attention"}</div>
      <div class="lead" style="margin:4px 0 0">${esc(weak.h.text)}</div>
      <div class="note" style="margin-top:3px">${Math.round(weak.p * 100)}% over the last 14 days — your weakest</div></div>
      <div style="color:var(--muted);font-size:18px">›</div></div>`; }

  return `<div class="page">
    <div class="between" style="align-items:center"><h1 class="h1">${greeting()}</h1><button class="iconbtn" data-act="sheet" data-s="settings" aria-label="Settings">≡</button></div>
    <div class="hero" data-act="sheet" data-s="share">
      <div class="kicker" style="color:#12081c;opacity:.75">Streak</div>
      <div class="row" style="align-items:flex-end;gap:10px;margin-top:2px"><b class="num">${s}</b><span class="unit">${s === 1 ? "day" : "days"}</span></div>
      <div class="msg">${!act.length ? "Add a habit to start your run" : left === 0 ? "Every habit done today — keep this going" : `${left} left today to keep it alive`}</div>
      <div class="cta">Share this <span>↗</span></div>
      <div class="fire">🔥</div>
    </div>
    <div class="row" style="align-items:stretch;gap:10px">
      <div class="card" style="flex:1;min-width:0"><div class="kicker">Momentum</div><div class="bars">${bars}</div><div class="note" style="margin-top:10px">${momentum}</div></div>
      <div class="card" style="flex:none;width:136px;display:flex;flex-direction:column"><div class="kicker">Freezes</div><div class="row" style="gap:6px;margin-top:12px">${ice}</div>${freezeAction}</div>
    </div>
    <div class="card"><div class="kicker">${now.toLocaleString("en", { month: "long" })} so far</div>
      <div class="figs"><div style="flex:1"><b>${ad}</b><span>active days</span></div><div style="flex:1"><b>${th ? Math.round(tc / th * 100) : 0}%</b><span>completion</span></div><div style="flex:1"><b>${bd}%</b><span>best day</span></div></div></div>
    ${focus}
  </div>`;
}

function habitRow(h, k, removable) {
  const on = doneOn(k).includes(h.id), m = meta(h.text), run = habitRun(h);
  return `<div class="habit${on ? " done" : ""}" data-act="toggle" data-id="${h.id}" data-k="${k}" style="${on ? `border-color:${m.color}` : ""}">
    <div class="chip${ui.hit === h.id + "@" + k ? " pop" : ""}" style="${on ? `background:${m.color}` : ""}">${m.emoji}</div>
    <div style="flex:1;min-width:0"><div class="t">${esc(h.text)}</div><div class="m">${run > 1 ? run + " day run" : on ? "done" : "not yet"}</div></div>
    ${removable ? `<button class="x" data-act="archive" data-id="${h.id}" aria-label="Remove">✕</button>` : ""}
    <div class="tick" style="${on ? `background:${m.color};border-color:${m.color};color:#12081c` : ""}">✓</div></div>`;
}

function todayView() {
  const t = todayKey(), act = activeOn(t), d = doneOn(t).length, left = Math.max(0, act.length - d), p = act.length ? Math.min(1, d / act.length) : 0, s = streak();
  return `<div class="page">
    <div class="between"><div><h1 class="h1">${new Date().toLocaleDateString("en", { weekday: "long" })}</h1><div class="sub">${new Date().toLocaleDateString("en", { month: "long", day: "numeric" })}</div></div>
      <button class="iconbtn" data-act="sheet" data-s="settings" aria-label="Settings">≡</button></div>
    <div class="card row" style="gap:20px;padding:22px;border-radius:26px">
      <div class="ring"><svg width="96" height="96" viewBox="0 0 96 96"><defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9b7cff"/><stop offset="1" stop-color="#ff7ba0"/></linearGradient></defs>
        <circle cx="48" cy="48" r="40" fill="none" stroke="var(--chip)" stroke-width="9"/>
        <circle cx="48" cy="48" r="40" fill="none" stroke="url(#rg)" stroke-width="9" stroke-linecap="round" stroke-dasharray="251.3" stroke-dashoffset="${(251.3 * (1 - p)).toFixed(1)}" style="transition:stroke-dashoffset .6s cubic-bezier(.16,1,.3,1)"/></svg>
        <b>${Math.round(p * 100)}%</b></div>
      <div style="min-width:0"><div style="font-size:22px;font-weight:800;color:var(--strong);letter-spacing:-.03em;line-height:1.15">${!act.length ? "Nothing yet" : left === 0 ? "Done for today" : `${d} of ${act.length} done`}</div>
        <div class="note" style="font-size:13px;margin-top:7px">${!act.length ? "Add a habit below to begin." : left === 0 ? `Day ${s} of the run — nothing left to check.` : `${left} more to close the day.`}</div></div>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px">${act.map(h => habitRow(h, t, true)).join("")}</div>
    ${act.length && left === 0 ? `<div class="celebrate"><div style="font-size:17px;font-weight:800;color:var(--strong)">Day ${s} locked in.</div>
      <div class="note" style="font-size:13px;margin-top:6px">Nothing left to check. Post it or leave it — your call.</div>
      <button class="pill" data-act="sheet" data-s="share" style="margin-top:14px;background:var(--btn);color:var(--btn-t);border:0">Share the day</button></div>` : ""}
    <div class="add"><input id="draft" placeholder="Add a habit" value="${esc(ui.draft)}" maxlength="80" autocomplete="off"><button id="addBtn" class="${ui.draft.trim() ? "on" : ""}" data-act="add">Add</button></div>
    <button class="note" data-act="sheet" data-s="library" style="text-align:center;padding:6px;font-size:13px">or pick from the library →</button>
  </div>`;
}

function daysView() {
  const t = todayKey(), now = new Date(), sk = startKey();
  const first = sk ? parseKey(sk) : now;
  const from = new Date(Math.min(first.getFullYear() * 12 + first.getMonth(), now.getFullYear() * 12 + now.getMonth() - 2) / 12 | 0, 0, 1);
  const startIdx = Math.min(first.getFullYear() * 12 + first.getMonth(), now.getFullYear() * 12 + now.getMonth() - 2);
  let html = "";
  for (let idx = startIdx; idx <= now.getFullYear() * 12 + now.getMonth() + 1; idx++) {
    const y = Math.floor(idx / 12), m = idx % 12, off = new Date(y, m, 1).getDay(), dim = new Date(y, m + 1, 0).getDate();
    let cells = "";
    for (let i = 0; i < off; i++) cells += `<div class="cell empty"></div>`;
    for (let d = 1; d <= dim; d++) {
      const k = key(new Date(y, m, d)), r = rate(k), fz = db.frozen[k];
      const bg = fz ? "" : r === null ? "" : r >= .99 ? `background:${GRAD};color:#12081c;font-weight:800` : r >= .5 ? "background:rgba(155,124,255,.55)" : r > 0 ? "background:rgba(155,124,255,.24)" : "";
      cells += `<div class="cell${k === t ? " today" : ""}${fz ? " frozen" : ""}" data-act="day" data-k="${k}" ${k === t ? 'data-today="1"' : ""} style="${bg}">${fz ? "❄" : d}</div>`;
    }
    html += `<div class="card month" data-mk="${y}-${m}"><div class="title">${new Date(y, m, 1).toLocaleString("en", { month: "long" })} ${y}</div>
      <div class="dow"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div><div class="grid7">${cells}</div></div>`;
  }
  void from;
  return `<div class="days"><div class="head between"><div><h1 class="h1" id="calYear">${now.getFullYear()}</h1><div class="sub" id="calMonth" style="text-transform:uppercase;letter-spacing:.12em;font-size:12px;font-weight:700">${now.toLocaleString("en", { month: "long" })}</div></div>
    <button class="pill" data-act="jumpToday">Today</button></div><div class="list scroll" id="calList">${html}</div></div>`;
}

function statsView() {
  const pts = lastKeys(30).map(k => ({ k, r: rate(k) }));
  const W = 320, H = 120, P = 8, st = (W - 2 * P) / 29, x = i => P + i * st, yv = r => H - P - (r || 0) * (H - 2 * P);
  const line = pts.map((p, i) => (i ? "L" : "M") + x(i).toFixed(1) + "," + yv(p.r).toFixed(1)).join(" ");
  const area = `M${P},${H - P} ` + pts.map((p, i) => "L" + x(i).toFixed(1) + "," + yv(p.r).toFixed(1)).join(" ") + ` L${W - P},${H - P} Z`;
  const valid = pts.filter(p => p.r !== null), avg = valid.length ? Math.round(valid.reduce((a, b) => a + b.r, 0) / valid.length * 100) : 0;

  const b = [[], [], [], [], [], [], []], sk = startKey();
  if (sk) for (const d = parseKey(sk); key(d) <= todayKey(); d.setDate(d.getDate() + 1)) { const r = rate(key(d)); if (r !== null) b[d.getDay()].push(r); }
  const av = b.map(a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0), mx = Math.max(...av, .001), L = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const bi = av.indexOf(Math.max(...av));

  const hk = lastKeys(30);
  const heat = activeOn(todayKey()).map(h => { const m = meta(h.text); let n = 0, d = 0;
    const cells = hk.map(k => { const tr = h.created_at <= k, on = tr && doneOn(k).includes(h.id); if (tr) { d++; if (on) n++; }
      return `<i data-act="heat" data-k="${k}" data-t="${esc(h.text)}" data-on="${on ? 1 : tr ? 0 : -1}" style="background:${on ? m.color : tr ? "var(--chip)" : "transparent"};${on ? "" : tr ? "border:1px solid var(--bd)" : "border:1px dashed var(--bd)"}"></i>`; }).join("");
    return { p: d ? Math.round(n / d * 100) : 0, html: `<div style="margin-bottom:16px"><div class="row" style="gap:9px;margin-bottom:8px"><div class="chip" style="width:24px;height:24px;border-radius:8px;font-size:13px;background:${m.color}">${m.emoji}</div>
      <div style="flex:1;min-width:0;font-size:14px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(h.text)}</div><div class="note" style="font-weight:800">${d ? Math.round(n / d * 100) : 0}%</div></div><div class="heat">${cells}</div></div>` }; })
    .sort((a, b) => b.p - a.p).map(x => x.html).join("");

  return `<div class="page">
    <div><h1 class="h1">Stats</h1><div class="sub">${sk ? "Since " + fmt(sk, { month: "long", day: "numeric", year: "numeric" }) : "Nothing tracked yet"}</div></div>
    <div class="card"><div class="kicker">Last 30 days</div><div class="lead">Averaging ${avg}% a day</div>
      <svg viewBox="0 0 320 120" preserveAspectRatio="none" style="width:100%;height:auto;display:block;overflow:visible">
        <defs><linearGradient id="sl" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#9b7cff"/><stop offset="1" stop-color="#ff7ba0"/></linearGradient>
        <linearGradient id="sa" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9b7cff" stop-opacity=".55"/><stop offset="1" stop-color="#ff7ba0" stop-opacity=".04"/></linearGradient></defs>
        <line x1="8" y1="112" x2="312" y2="112" stroke="var(--bds)"/><line x1="8" y1="8" x2="312" y2="8" stroke="var(--bds)" stroke-dasharray="2,3"/>
        <path d="${area}" fill="url(#sa)" opacity=".35"/><path d="${line}" fill="none" stroke="url(#sl)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
    <div class="card"><div class="kicker">By day of week</div><div class="lead">${valid.length ? L[bi] + " is your best day" : "Not enough data yet"}</div>
      ${av.map((v, i) => `<div class="dowrow"><div class="l">${L[i]}</div><div class="track"><i style="width:${(v / mx * 100).toFixed(0)}%"></i></div><div class="v">${Math.round(v * 100)}%</div></div>`).join("")}</div>
    <div class="card"><div class="kicker">Per habit — last 30 days</div><div class="lead">Tap a square for that day</div>${heat || '<div class="note">Add habits to see them here.</div>'}</div>
  </div>`;
}

function youView() {
  const p = db.prefs, sk = startKey(), s = syncStatus(), ready = syncIs("READY");
  const name = p.name || s.fullName || "", photo = p.photo || s.avatarUrl || "";
  const initial = esc((name.trim()[0] || "?").toUpperCase());
  const synced = ready ? (s.lastSyncAt ? "Encrypted · synced " + new Date(s.lastSyncAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "Encrypted · syncing…")
    : syncIs("ERROR") ? "Sync error — retrying" : "On this device only";
  return `<div class="page" style="align-items:stretch;text-align:center;padding-top:32px">
    <label class="avatar" aria-label="Change photo">${photo ? `<img src="${esc(photo)}" alt="">` : initial}<input type="file" accept="image/*" id="photoIn" class="hidden"></label>
    <div style="margin-top:8px"><input class="edit h1" id="nameIn" value="${esc(name)}" placeholder="Your name" maxlength="40" style="font-size:28px">
      <div class="row" style="justify-content:center;gap:0;color:var(--muted);font-weight:600"><span style="opacity:.6">@</span><input class="edit" id="handleIn" value="${esc(p.handle || "")}" placeholder="handle" maxlength="24" size="${Math.max(6, (p.handle || "").length + 1)}" style="width:auto;field-sizing:content;min-width:6ch;text-align:left;padding-left:2px;font-weight:600;color:var(--text);font-size:15px"></div></div>
    <div class="card" style="padding:4px 16px;text-align:left;margin-top:14px">
      ${s.email ? `<div class="kv"><span class="kicker">Account</span><span>${esc(s.email)}</span></div>` : ""}
      <div class="kv"><span class="kicker">Tracking since</span><span>${sk ? fmt(sk, { month: "short", day: "numeric", year: "numeric" }) : "—"}</span></div>
      <div class="kv"><span class="kicker">Personal best</span><span>${bestStreak()} day streak</span></div>
      <div class="kv"><span class="kicker">Your data</span><span>${synced}</span></div>
    </div>
    <button class="btn grad" data-act="sheet" data-s="share">Share your streak card</button>
    <button class="btn ghost" data-act="export">Export my data</button>
    ${ready ? `<button class="btn ghost" data-act="signout" style="color:var(--muted)">Sign out</button>` : ""}
  </div>`;
}

// ---------- sheets ----------
function sheetHead(title, sub) { return `<div class="between" style="align-items:center"><h3>${title}</h3><button class="x" data-act="close" aria-label="Close">✕</button></div>${sub ? `<div class="note" style="font-size:13px;margin:7px 0 0">${sub}</div>` : ""}`; }

function settingsSheet() {
  const p = db.prefs, th = p.theme || "genz", md = p.mode || "system";
  const seg = (name, cur, opts) => `<div class="seg">${opts.map(([v, l]) => `<button class="${cur === v ? "on" : ""}" data-act="pref" data-p="${name}" data-v="${v}">${l}</button>`).join("")}</div>`;
  const pushOk = PUSH_CONFIG.enabled && "PushManager" in window;
  return `${sheetHead("Settings")}<div class="scroll" style="display:flex;flex-direction:column;gap:14px;margin-top:16px">
    <div><div class="kicker" style="margin:0 0 8px 4px">Theme</div>${seg("theme", th, [["genz", "Gen-Z"], ["millennial", "Millennial"]])}</div>
    <div><div class="kicker" style="margin:0 0 8px 4px">Appearance</div>${seg("mode", md, [["dark", "Dark"], ["light", "Light"], ["system", "System"]])}</div>
    <div class="card" style="padding:14px 16px"><div class="between" style="align-items:center"><div><div style="font-weight:700">Daily reminder</div>
      <div class="note">${pushOk ? (p.pushOn ? "On" : "Off") : "Switches on once reminders are set up"}</div></div>
      <input type="time" id="remIn" value="${p.reminder || "20:00"}" style="background:var(--chip);border:0;border-radius:12px;padding:9px 10px;font-weight:700;color:var(--strong)"></div>
      ${pushOk ? `<button class="btn" data-act="push" style="margin-top:12px">${p.pushOn ? "Turn off reminders" : "Turn on reminders"}</button>` : ""}</div>
    <button class="menu" data-act="sheet" data-s="library"><span class="i">+</span><span style="flex:1"><b style="display:block">Habit library</b><span class="note">25 ready-made habits</span></span>›</button>
    <button class="menu" data-act="export"><span class="i">↓</span><span style="flex:1"><b style="display:block">Export my data</b><span class="note">Your habits, as a JSON file</span></span>›</button>
    <button class="menu" data-act="reset"><span class="i">↺</span><span style="flex:1"><b style="display:block">Reset everything</b><span class="note">Deletes all habits on this device</span></span>›</button>
    <div class="nigrah" style="margin:4px 4px 0"><b>निग्रह · Nigrah</b> — the quiet strength of self-control. BTBU is a small daily practice of it: choose, show up, repeat. <span style="opacity:.7">v26</span></div>
  </div>`;
}

function librarySheet(sel, onboarding) {
  const existing = new Set(activeOn(todayKey()).map(h => h.text));
  const groups = TEMPLATES.map(g => `<div style="margin-bottom:14px"><div class="kicker" style="margin:6px 0 9px">${g.icon}&nbsp; ${g.category}</div>
    <div style="display:flex;flex-direction:column;gap:7px">${g.habits.map(t => { const has = existing.has(t), on = sel.includes(t);
      return `<div class="opt${on ? " on" : ""}${has ? " off" : ""}" data-act="${has ? "" : onboarding ? "obPick" : "tplPick"}" data-t="${esc(t)}"><span class="box">✓</span><span>${esc(t)}${has ? " — added" : ""}</span></div>`; }).join("")}</div></div>`).join("");
  return groups;
}

function shareSheet() {
  return `${sheetHead("Share your streak")}<img class="share-preview" id="shareImg" alt="Your streak card">
    <div style="display:flex;gap:8px;margin-top:18px"><button class="btn" data-act="shareGo" style="flex:1">Share</button><button class="btn ghost" data-act="shareSave" style="width:auto;padding:15px 22px">Save</button></div>`;
}

function daySheet() {
  const k = ui.dayKey, a = activeOn(k), d = doneOn(k).length, t = todayKey();
  const tag = k === t ? "Today" : k > t ? "Upcoming" : "Past";
  return `${sheetHead(fmt(k, { weekday: "long", month: "long", day: "numeric" }))}
    <div class="row" style="gap:8px;margin-top:8px"><span class="kicker" style="padding:5px 10px;border-radius:999px;background:var(--chip)">${db.frozen[k] ? "❄ Frozen" : tag}</span><span class="note">${d} of ${a.length} done</span></div>
    <div class="scroll" style="display:flex;flex-direction:column;gap:8px;margin-top:16px">${a.length ? a.map(h => habitRow(h, k, false)).join("") : '<div class="note">No habits were tracked on this day.</div>'}</div>`;
}

// ---------- render ----------
function render() {
  const views = { home: homeView, today: todayView, days: daysView, stats: statsView, you: youView };
  $("screen").innerHTML = views[ui.screen]();
  $("screen").style.overflowY = ui.screen === "days" ? "hidden" : "auto";
  $("nav").innerHTML = [["home", "Home"], ["today", "Today"], ["days", "Days"], ["stats", "Stats"], ["you", "You"]]
    .map(([id, l]) => `<button class="${ui.screen === id ? "on" : ""}" data-act="go" data-s="${id}">${l}</button>`).join("");
  renderSheet();
  if (ui.screen === "days" && ui.scrollDays) { ui.scrollDays = false; requestAnimationFrame(jumpToday); }
  if (ui.screen === "days") $("calList").onscroll = syncCalHeader;
  ui.hit = null;
}

function renderSheet() {
  const s = ui.sheet, host = $("sheet");
  $("scrim").classList.toggle("hidden", !s);
  if (!s) { host.innerHTML = ""; return; }
  let inner = "";
  if (s === "settings") inner = settingsSheet();
  if (s === "share") inner = shareSheet();
  if (s === "day") inner = daySheet();
  if (s === "library") { const n = ui.tplSel.length;
    inner = `${sheetHead("Habit library", "Tap to select — they start today and repeat every day.")}<div class="scroll" style="flex:1;margin:14px 0">${librarySheet(ui.tplSel, false)}</div>
      <button class="btn" data-act="tplAdd" ${n ? "" : "disabled"}>${n ? `Add ${n} habit${n === 1 ? "" : "s"}` : "Pick a few"}</button>`; }
  const keepAnim = host.firstElementChild && host.firstElementChild.dataset.s === s;
  host.innerHTML = `<div class="sheet" data-s="${s}" style="${keepAnim ? "animation:none" : ""}">${inner}</div>`;
  if (s === "share") drawShare().then(c => { const img = $("shareImg"); if (img) img.src = c.toDataURL("image/png"); });
}

function jumpToday() {
  const el = $("calList"), t = el && el.querySelector('[data-today="1"]'); if (!t) return;
  const er = el.getBoundingClientRect(), tr = t.getBoundingClientRect();
  el.scrollTop = Math.max(0, el.scrollTop + (tr.top - er.top) - (el.clientHeight - tr.height) / 2);
  syncCalHeader();
}
function syncCalHeader() {
  const el = $("calList"); if (!el) return;
  const r = el.getBoundingClientRect(), mid = r.top + r.height / 2;
  let best = null, bd = Infinity;
  el.querySelectorAll("[data-mk]").forEach(c => { const b = c.getBoundingClientRect(); const d = mid >= b.top && mid <= b.bottom ? 0 : Math.min(Math.abs(b.top - mid), Math.abs(b.bottom - mid)); if (d < bd) { bd = d; best = c; } });
  if (!best) return;
  const [y, m] = best.dataset.mk.split("-").map(Number);
  $("calYear").textContent = y; $("calMonth").textContent = new Date(y, m, 1).toLocaleString("en", { month: "long" });
}

// ---------- share card (1080×1920 canvas) ----------
async function drawShare() {
  try { await document.fonts.load('800 100px "Bricolage Grotesque"'); } catch (e) {}
  const W = 1080, H = 1920, c = document.createElement("canvas"); c.width = W; c.height = H;
  const x = c.getContext("2d"), F = '"Bricolage Grotesque", system-ui, sans-serif';
  const g = x.createLinearGradient(0, 0, W * .6, H); g.addColorStop(0, "#7c5cff"); g.addColorStop(.45, "#a45cff"); g.addColorStop(1, "#ff5f8f");
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  const s = streak(), t = todayKey(), act = activeOn(t), left = act.length - doneOn(t).length;
  x.fillStyle = "#fff"; x.globalAlpha = .85; x.font = `800 40px ${F}`; x.fillText("B T B U", 90, 160); x.globalAlpha = 1;
  x.font = `800 440px ${F}`; x.fillText(String(s), 74, 860);
  const nw = x.measureText(String(s)).width;
  x.font = `700 76px ${F}`; x.fillText(s === 1 ? "day" : "days", 74 + nw + 24, 840);
  x.font = `600 56px ${F}`;
  const msg = act.length && left <= 0 ? `Closed every habit today — day ${s} of the run.` : `Day ${s} and counting.`;
  wrap(x, msg, 90, 990, W - 180, 70);
  x.globalAlpha = .75; x.font = `700 32px ${F}`; x.fillText("LAST 35 DAYS", 90, 1210); x.globalAlpha = 1;
  const cell = 116, gap = 14;
  lastKeys(35).forEach((k, i) => { const r = rate(k), fz = db.frozen[k];
    x.fillStyle = `rgba(255,255,255,${fz ? .5 : r === null ? .12 : (.14 + .76 * r).toFixed(2)})`;
    rr(x, 90 + (i % 7) * (cell + gap), 1250 + Math.floor(i / 7) * (cell + gap), cell, cell, 16); x.fill(); });
  x.fillStyle = "rgba(255,255,255,.3)"; x.fillRect(90, 1960 - 230, W - 180, 2);
  x.fillStyle = "#fff"; x.font = `800 46px ${F}`; x.fillText(db.prefs.handle ? "@" + db.prefs.handle : (db.prefs.name || "Be the best you"), 90, 1800);
  x.globalAlpha = .8; x.font = `600 34px ${F}`; x.textAlign = "right"; x.fillText("निग्रह · self-control, daily", W - 90, 1800); x.globalAlpha = 1; x.textAlign = "left";
  return c;
}
function rr(x, a, b, w, h, r) { x.beginPath(); x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r); x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath(); }
function wrap(x, text, a, b, max, lh) { let line = ""; for (const w of text.split(" ")) { const t = line ? line + " " + w : w; if (x.measureText(t).width > max && line) { x.fillText(line, a, b); b += lh; line = w; } else line = t; } x.fillText(line, a, b); }
async function shareCard(saveOnly) {
  const c = await drawShare();
  const blob = await new Promise(r => c.toBlob(r, "image/png"));
  const file = new File([blob], `btbu-streak-${todayKey()}.png`, { type: "image/png" });
  if (!saveOnly && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: "My BTBU streak", text: `Day ${streak()} on BTBU.` }); return; }
    catch (e) { if (e.name === "AbortError") return; }
  }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(saveOnly ? "Saved" : "Sharing isn't supported here — saved the image instead");
}

// ---------- reminders (Web Push) ----------
const b64 = s => { const p = "=".repeat((4 - s.length % 4) % 4), r = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from([...r].map(c => c.charCodeAt(0))); };
async function togglePush() {
  try {
    const reg = await navigator.serviceWorker.ready;
    if (db.prefs.pushOn) { const sub = await reg.pushManager.getSubscription(); if (sub) await sub.unsubscribe(); db.prefs.pushOn = false; save(); render(); toast("Reminders off"); return; }
    if (await Notification.requestPermission() !== "granted") { toast("Notifications are blocked in your browser settings"); return; }
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(PUSH_CONFIG.vapidPublicKey) });
    await syncReminder(sub);
    db.prefs.pushOn = true; save(); render(); toast("Reminder set for " + (db.prefs.reminder || "20:00"));
  } catch (e) { toast("Couldn't set up reminders"); }
}
async function syncReminder(sub) {
  if (!PUSH_CONFIG.enabled) return;
  if (!sub) { const reg = await navigator.serviceWorker.ready; sub = await reg.pushManager.getSubscription(); if (!sub) return; }
  await fetch(PUSH_CONFIG.subscribeUrl, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: sub, time: db.prefs.reminder || "20:00", tz: Intl.DateTimeFormat().resolvedOptions().timeZone }) });
}

// ---------- onboarding ----------
function obSteps() { return db.habits.length ? ["theme", "reminder"] : ["theme", "habits", "reminder"]; }
function renderOnboard() {
  const el = $("onboard"), steps = obSteps(), step = steps[ui.ob], p = db.prefs;
  el.classList.remove("hidden");
  const dots = `<div class="dots">${steps.map((_, i) => `<i class="${i <= ui.ob ? "on" : ""}"></i>`).join("")}</div>`;
  let body = "", next = "Continue", ok = true;
  if (step === "theme") {
    const card = (id, name, sw, txt) => `<button class="themecard${(p.theme || "genz") === id ? " on" : ""}" data-act="obTheme" data-v="${id}">
      <div class="sw" style="${sw}">${txt}</div><b style="font-size:16px;color:var(--strong)">${name}</b></button>`;
    body = `${dots}<h1 class="h1" style="margin-top:28px;font-size:34px">Be the best you.</h1>
      <div class="nigrah"><b>निग्रह · Nigrah</b> — the quiet strength of self-control.<br>A small daily practice of it starts here.</div>
      <input class="time" id="obName" placeholder="Your first name" value="${esc(p.name || "")}" maxlength="40" style="font-size:18px;text-align:left;margin-bottom:18px">
      <div class="kicker" style="margin:0 0 10px 4px">Pick your look</div>
      ${card("genz", "Gen-Z — loud, colourful, big numbers", "background:linear-gradient(135deg,#9b7cff,#ff7ba0);color:#12081c", `<b style="font-family:'Bricolage Grotesque';font-size:44px;font-weight:800;letter-spacing:-.06em;line-height:.9">37🔥</b>`)}
      ${card("millennial", "Millennial — calm, quiet, minimal", "background:#131318;border:1px solid rgba(255,255,255,.08);color:#fff", `<b style="font-size:30px;font-weight:700;letter-spacing:-.04em">37 <span style="font-size:13px;color:#8b8b96;font-weight:500">day streak</span></b>`)}
      <div class="note" style="text-align:center;margin-top:4px">Change it any time in Settings.</div>`;
  } else if (step === "habits") {
    ok = ui.obSel.length > 0;
    body = `${dots}<h1 class="h1" style="margin-top:28px">Pick your first habits.</h1><div class="note" style="font-size:14px;margin:8px 0 18px">Start small — three is plenty. You can add your own later.</div>${librarySheet(ui.obSel, true)}`;
    next = ok ? `Start with ${ui.obSel.length}` : "Pick at least one";
  } else {
    body = `${dots}<h1 class="h1" style="margin-top:28px">When should we nudge you?</h1>
      <div class="note" style="font-size:14px;margin:8px 0 22px">One reminder a day, at the time you're most likely to follow through.</div>
      <input type="time" class="time" id="obTime" value="${p.reminder || "20:00"}">
      <div class="note" style="text-align:center;margin-top:12px">${PUSH_CONFIG.enabled ? "We'll ask for notification permission next." : "Saved — reminders switch on in an upcoming update."}</div>`;
    next = "Let's go";
  }
  el.innerHTML = `<div class="body scroll">${body}</div><div class="foot">${ui.ob > 0 ? `<button class="btn ghost" data-act="obBack" style="width:auto;padding:15px 22px">Back</button>` : ""}
    <button class="btn" data-act="obNext" ${ok ? "" : "disabled"} style="flex:1">${next}</button></div>`;
}
async function obNext() {
  const steps = obSteps(), step = steps[ui.ob];
  if (step === "theme") { const n = $("obName"); if (n) db.prefs.name = n.value.trim(); }
  if (step === "reminder") { const t = $("obTime"); if (t) db.prefs.reminder = t.value || "20:00"; }
  if (ui.ob < steps.length - 1) { save(); ui.ob++; renderOnboard(); $("onboard").firstElementChild.scrollTop = 0; return; }
  const t = todayKey();
  ui.obSel.forEach(text => db.habits.push({ id: uid(), text, created_at: t, archived_at: null }));
  db.prefs.onboarded = true; save();
  $("onboard").classList.add("hidden"); ui.screen = "today"; render();
  if (PUSH_CONFIG.enabled) togglePush();
}

// ---------- events ----------
document.addEventListener("click", e => {
  const el = e.target.closest("[data-act]"); if (!el) return;
  const a = el.dataset.act, d = el.dataset;
  if (!a) return;
  if (a === "archive") { e.stopPropagation(); const h = db.habits.find(x => x.id === d.id);
    if (h && confirm(`Stop tracking "${h.text}"? Your past days keep their history.`)) {
      h.archived_at = todayKey(); const l = (db.comps[todayKey()] || []).filter(x => x !== h.id);
      if (l.length) db.comps[todayKey()] = l; else delete db.comps[todayKey()]; save(); render(); toast("Habit removed"); } return; }
  switch (a) {
    case "go": ui.sheet = null; ui.screen = d.s; ui.scrollDays = d.s === "days"; $("screen").scrollTop = 0; render(); break;
    case "toggle": setDone(d.id, d.k, !doneOn(d.k).includes(d.id)); break;
    case "add": addHabit(); break;
    case "sheet": ui.sheet = d.s; if (d.s === "library") ui.tplSel = []; renderSheet(); break;
    case "close": ui.sheet = null; renderSheet(); break;
    case "day": ui.dayKey = d.k; ui.sheet = "day"; renderSheet(); break;
    case "jumpToday": jumpToday(); break;
    case "heat": toast((d.on === "1" ? "✓ " : d.on === "0" ? "✗ " : "") + fmt(d.k, { month: "short", day: "numeric" }) + " — " + d.t + (d.on === "-1" ? " (not tracked yet)" : "")); break;
    case "freeze": if (freezesLeft() > 0) { db.frozen[d.k] = monthKey(); save(); render(); toast("❄ " + fmt(d.k, { weekday: "long" }) + " saved — streak intact"); } break;
    case "tplPick": ui.tplSel = ui.tplSel.includes(d.t) ? ui.tplSel.filter(x => x !== d.t) : ui.tplSel.concat(d.t); renderSheet(); break;
    case "tplAdd": { const t = todayKey(), have = new Set(activeOn(t).map(h => h.text)); let n = 0;
      ui.tplSel.forEach(text => { if (!have.has(text)) { db.habits.push({ id: uid(), text, created_at: t, archived_at: null }); n++; } });
      save(); ui.sheet = null; ui.screen = "today"; render(); if (n) toast(`Added ${n} habit${n === 1 ? "" : "s"}`); break; }
    case "pref": db.prefs[d.p] = d.v; save(); applyTheme(); render(); break;
    case "push": togglePush(); break;
    case "export": exportData(); break;
    case "signin": BTBU_SYNC.signInWithGoogle().catch(err => toast(err.message || "Sign-in failed")); break;
    case "signout": if (confirm("Sign out? Your data stays on this device but won't sync until you sign back in.")) BTBU_SYNC.signOut(); break;
    case "reset": if (confirm(syncIs("READY") ? "Delete every habit and all history — on all your synced devices? This can't be undone." : "Delete every habit and all history on this device? This can't be undone.")) {
      db.habits = []; db.comps = {}; db.frozen = {}; save(); ui.sheet = null; ui.screen = "today"; render(); toast("Everything cleared"); } break;
    case "shareGo": shareCard(false); break;
    case "shareSave": shareCard(true); break;
    case "obTheme": db.prefs.theme = d.v; { const n = $("obName"); if (n) db.prefs.name = n.value.trim(); } save(); applyTheme(); renderOnboard(); break;
    case "obPick": ui.obSel = ui.obSel.includes(d.t) ? ui.obSel.filter(x => x !== d.t) : ui.obSel.concat(d.t); renderOnboard(); break;
    case "obNext": obNext(); break;
    case "obBack": ui.ob = Math.max(0, ui.ob - 1); renderOnboard(); break;
  }
});
$("scrim").addEventListener("click", () => { ui.sheet = null; renderSheet(); });

document.addEventListener("input", e => {
  const id = e.target.id;
  if (id === "draft") { ui.draft = e.target.value; $("addBtn").classList.toggle("on", !!ui.draft.trim()); }
  if (id === "nameIn") { db.prefs.name = e.target.value; save(); }
  if (id === "handleIn") { const v = e.target.value.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase(); if (v !== e.target.value) e.target.value = v; }
});
document.addEventListener("change", e => {
  if (e.target.id === "remIn") { db.prefs.reminder = e.target.value; save(); syncReminder(); toast("Reminder time saved"); }
  if (e.target.id === "photoIn" && e.target.files[0]) setPhoto(e.target.files[0]);
  if (e.target.id === "handleIn") claimHandle(e.target.value);
});
document.addEventListener("keydown", e => { if (e.target.id === "draft" && e.key === "Enter") addHabit(); if (e.key === "Escape" && ui.sheet) { ui.sheet = null; renderSheet(); } });

function addHabit() {
  const v = ui.draft.trim(); if (!v) return;
  const t = todayKey();
  if (activeOn(t).some(h => h.text.toLowerCase() === v.toLowerCase())) { toast("Already tracking that one"); return; }
  db.habits.push({ id: uid(), text: v, created_at: t, archived_at: null }); ui.draft = ""; save(); render();
  const i = $("draft"); if (i) i.focus();
}
// Handles are globally unique once signed in (public.usernames, v25.1).
function claimHandle(v) {
  if (v === (db.prefs.handle || "")) return;
  if (!syncIs("READY")) { db.prefs.handle = v; save(); return; }
  BTBU_SYNC.claimUsername(v).then(n => { db.prefs.handle = n; save(); toast("@" + n + " is yours"); })
    .catch(err => { toast(err.message || "Couldn't claim that handle"); render(); });
}
function setPhoto(file) {
  const img = new Image(), url = URL.createObjectURL(file);
  img.onload = () => { const s = 256, c = document.createElement("canvas"); c.width = c.height = s;
    const m = Math.min(img.width, img.height); c.getContext("2d").drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, s, s);
    db.prefs.photo = c.toDataURL("image/jpeg", .82); save(); render(); URL.revokeObjectURL(url); };
  img.src = url;
}
function exportData() {
  const blob = new Blob([JSON.stringify({ app: "BTBU", version: 26, exported_at: new Date().toISOString(), habits: db.habits, completions: db.comps, freezes: db.frozen }, null, 2)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `btbu-export-${todayKey()}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000); toast("Exported");
}

// Re-render when the day rolls over or the tab comes back.
let lastDay = todayKey();
document.addEventListener("visibilitychange", () => { if (!document.hidden && todayKey() !== lastDay) { lastDay = todayKey(); render(); } });
matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => { if ((db.prefs.mode || "system") === "system") applyTheme(); });

// ---------- sign-in gate (v24+: Google sign-in required when sync is configured) ----------
const GOOGLE_G = `<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.715v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.614z"/><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/></svg>`;
function renderGate() {
  const g = $("gate");
  if (!window.BTBU_SYNC) { g.classList.add("hidden"); return false; }
  const s = BTBU_SYNC.status(), S = BTBU_SYNC.STATES;
  const gated = s.state !== S.READY && s.state !== S.UNCONFIGURED;
  g.classList.toggle("hidden", !gated);
  if (gated) g.innerHTML = `<div class="kicker" style="letter-spacing:.2em">BTBU</div>
    <h1 class="h1" style="font-size:36px;margin-top:18px">Be the best you.</h1>
    <div class="nigrah"><b>निग्रह · Nigrah</b> — the quiet strength of self-control.<br>Sign in to start. Your habits are end-to-end encrypted and synced across your devices.</div>
    <button class="btn ghost row" data-act="signin" ${s.state === S.CONNECTING ? "disabled" : ""} style="justify-content:center;gap:10px;font-size:15px">${GOOGLE_G}<span>${s.state === S.CONNECTING ? "Opening Google…" : "Continue with Google"}</span></button>
    ${s.state === S.ERROR && s.error ? `<div class="note" style="color:var(--warn);margin-top:12px">${esc(s.error)}</div>` : ""}
    <div class="note" style="margin-top:18px;text-align:center">No password to remember. We never see your habits in plaintext.</div>`;
  return gated;
}
function afterAuth() {
  if (renderGate()) return;
  if (!db.prefs.onboarded && $("onboard").classList.contains("hidden")) {
    if (!db.prefs.name && syncStatus().fullName) db.prefs.name = syncStatus().fullName;
    renderOnboard();
  }
}

// ---------- boot ----------
migrate(); applyTheme(); render();
// sync.js calls this after pulling remote changes.
window.btbuRefresh = () => { load(); applyTheme(); render(); if (!$("onboard").classList.contains("hidden")) renderOnboard(); };
if (window.BTBU_SYNC) {
  BTBU_SYNC.onChange(() => { afterAuth(); if (ui.screen === "you") render(); });
  afterAuth();
  BTBU_SYNC.init();
} else if (!db.prefs.onboarded) renderOnboard();
if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
