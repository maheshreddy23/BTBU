// ============================================================================
// BTBU v27 — Community: feed, stories, challenges, circles, profiles.
// Talks to Supabase directly; schema in supabase/migrations/v27_community.sql.
// Habits never leave the encrypted sync path. Community sees only what a person
// posts, plus a done/not-done flag per day that their circle members can see.
// Uses globals from app.js at call time: esc, toast, render, renderSheet, ui, db,
// todayKey, parseKey, streak, activeOn, doneOn, GRAD.
// ============================================================================
(function () {
  const FILTER = ["idiot", "stupid", "loser", "ugly", "fatso", "worthless", "retard", "slut", "whore", "kys"];
  const CATS = { Fitness: "💪", Study: "📚", Mind: "🧘", Fasting: "🪔", Campus: "🎓", Other: "✦" };
  const COVERS = { violet: "linear-gradient(150deg,#2e2257,#7c5cff)", rose: "linear-gradient(150deg,#3d1830,#e0517f)", amber: "linear-gradient(150deg,#3d2a10,#e0952f)",
    teal: "linear-gradient(150deg,#0e3431,#0fb88c)", blue: "linear-gradient(150deg,#13263f,#3f8fe0)", ink: "linear-gradient(150deg,#1a1529,#3a2d55)" };
  const AVC = ["#ffd166", "#a78bfa", "#ff7ba0", "#06d6a0", "#74c0fc", "#f78c6b", "#8ce99a", "#ffa8a8", "#4fc3f7", "#c9bfff"];
  const REASONS = ["Harassment or bullying", "Hate speech", "Self-harm or unsafe dieting", "Spam or scam", "Nudity or sexual content", "False health claims", "Someone under 18"];
  const PSEL = "user_id,handle,name,avatar_url";
  const POST_SEL = `id,author,body,media_url,media_kind,card_n,challenge_id,quote_of,held,created_at,a:profiles!posts_author_fkey(${PSEL}),likes(count),comments(count),reposts(count)`;
  const SVG = {
    heart: f => `<svg width="19" height="19" viewBox="0 0 24 24" fill="${f}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/></svg>`,
    chat: `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5z"/></svg>`,
    repost: `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`,
    send: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`
  };

  const S = {
    me: null, meLoaded: false, tab: "feed", feed: [], suggested: [], feedAt: 0, loading: false,
    following: new Set(), likes: new Set(), reposts: new Set(), muted: new Set(), quoted: {}, chById: {},
    stories: [], seen: new Set(readLS("btbu_c_seen", [])),
    challenges: [], mine: new Set(), myCheckins: {}, checkedToday: new Set(), cat: "All",
    circles: [], requests: [], counts: null, myPosts: [],
    layer: null, d: {}, chatTimer: null, storyTimer: null
  };
  function readLS(k, f) { try { return JSON.parse(localStorage.getItem(k)) || f; } catch (e) { return f; } }

  // ---------------------------------------------------------------- basics
  const sb = () => (window.BTBU_SYNC && BTBU_SYNC.client && BTBU_SYNC.client()) || null;
  const me = () => (window.BTBU_SYNC && BTBU_SYNC.userId && BTBU_SYNC.userId()) || null;
  const online = () => !!(sb() && me() && BTBU_SYNC.isReady());
  const bad = t => { const w = String(t || "").toLowerCase().split(/[^a-z]+/); return FILTER.some(f => w.includes(f)); };
  const n = v => (v && v[0] && v[0].count) || 0;
  const fmtN = x => x >= 1000 ? (x / 1000).toFixed(1).replace(/\.0$/, "") + "k" : String(x);
  const ago = iso => { const s = (Date.now() - new Date(iso)) / 1000; if (s < 60) return "now"; if (s < 3600) return Math.floor(s / 60) + "m"; if (s < 86400) return Math.floor(s / 3600) + "h"; if (s < 604800) return Math.floor(s / 86400) + "d"; return new Date(iso).toLocaleDateString("en", { month: "short", day: "numeric" }); };
  const color = h => { let x = 7; for (const c of String(h || "?")) x = (x * 31 + c.charCodeAt(0)) % 9973; return AVC[x % AVC.length]; };
  const ini = p => { const s = ((p && (p.name || p.handle)) || "?").trim(); const parts = s.split(/\s+/); return esc(((parts[0] || "?")[0] + (parts[1] ? parts[1][0] : "")).toUpperCase()); };
  const av = (p, size, extra) => p && p.avatar_url
    ? `<span class="c-av" style="width:${size}px;height:${size}px;${extra || ""}"><img src="${esc(p.avatar_url)}" alt="" loading="lazy"></span>`
    : `<span class="c-av" style="width:${size}px;height:${size}px;font-size:${Math.round(size * .34)}px;background:${color(p && p.handle)};${extra || ""}">${ini(p)}</span>`;
  const first = p => esc(((p && (p.name || p.handle)) || "").split(" ")[0]);
  const err = e => { console.warn(e); toast((e && e.message) || "Something went wrong"); };
  const redraw = () => { render(); renderLayer(); };
  function chDay(c) { const d = Math.floor((parseKey(todayKey()) - parseKey(c.starts_on)) / 864e5) + 1; return d; }
  function chStatus(c) { const d = chDay(c); return d < 1 ? (d === 0 ? "Starts tomorrow" : "Starts " + parseKey(c.starts_on).toLocaleDateString("en", { month: "short", day: "numeric" })) : d > c.days ? "Finished" : `Day ${d} of ${c.days}`; }
  const live = c => { const d = chDay(c); return d >= 1 && d <= c.days; };

  // ---------------------------------------------------------------- media
  async function compress(file) {
    if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
    const img = await createImageBitmap(file).catch(() => null); if (!img) return file;
    const s = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement("canvas");
    c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return await new Promise(r => c.toBlob(r, "image/jpeg", .85));
  }
  function videoLength(file) {
    return new Promise(res => { const v = document.createElement("video"); v.preload = "metadata"; v.onloadedmetadata = () => { res(v.duration); URL.revokeObjectURL(v.src); }; v.onerror = () => res(0); v.src = URL.createObjectURL(file); });
  }
  async function checkFile(file) {
    if (!file) return null;
    const kind = file.type.startsWith("video/") ? "video" : file.type.startsWith("image/") ? "photo" : null;
    if (!kind) throw new Error("Pick a photo or a video");
    if (kind === "video") { if (file.size > 25 * 1024 * 1024) throw new Error("Videos can be up to 25 MB"); if (await videoLength(file) > 61) throw new Error("Videos can be up to 60 seconds"); }
    return { file, kind, preview: URL.createObjectURL(file) };
  }
  async function upload(m) {
    const body = m.kind === "photo" ? await compress(m.file) : m.file;
    const ext = m.kind === "photo" ? "jpg" : ((m.file.name.split(".").pop() || "mp4").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4");
    const path = `${me()}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.${ext}`;
    const { error } = await sb().storage.from("media").upload(path, body, { contentType: m.kind === "photo" ? "image/jpeg" : m.file.type, upsert: false });
    if (error) throw error;
    return { url: sb().storage.from("media").getPublicUrl(path).data.publicUrl, kind: m.kind };
  }
  const mediaTag = (url, kind, cls) => kind === "video"
    ? `<video class="${cls || "c-media"}" src="${esc(url)}" controls playsinline preload="metadata"></video>`
    : `<img class="${cls || "c-media"}" src="${esc(url)}" alt="" loading="lazy">`;

  // ---------------------------------------------------------------- loading
  async function loadMe() {
    const { data, error } = await sb().from("profiles").select("*").eq("user_id", me()).maybeSingle();
    if (error) throw error;
    S.me = data; S.meLoaded = true;
  }
  async function loadSocial() {
    const [f, m] = await Promise.all([
      sb().from("follows").select("followee").eq("follower", me()).eq("status", "accepted"),
      sb().from("mutes").select("muted").eq("muter", me())
    ]);
    S.following = new Set((f.data || []).map(r => r.followee));
    S.muted = new Set((m.data || []).map(r => r.muted));
  }
  async function loadFeed() {
    const ids = [me(), ...S.following];
    const [a, b, r] = await Promise.all([
      sb().from("posts").select(POST_SEL).in("author", ids).order("created_at", { ascending: false }).limit(40),
      sb().from("posts").select(POST_SEL).not("author", "in", `(${ids.join(",")})`).order("created_at", { ascending: false }).limit(12),
      S.following.size ? sb().from("reposts").select(`created_at,user_id,u:profiles!reposts_user_id_fkey(${PSEL}),post:posts!reposts_post_id_fkey(${POST_SEL})`).in("user_id", [...S.following]).order("created_at", { ascending: false }).limit(20) : { data: [] }
    ]);
    if (a.error) throw a.error;
    const items = (a.data || []).map(p => ({ p, at: p.created_at }))
      .concat((r.data || []).filter(x => x.post).map(x => ({ p: x.post, at: x.created_at, by: x.u })))
      .filter(x => !S.muted.has(x.p.author))
      .sort((x, y) => y.at.localeCompare(x.at));
    const seen = new Set(), out = [];
    for (const it of items) { if (seen.has(it.p.id)) continue; seen.add(it.p.id); out.push(it); }
    const sug = (b.data || []).filter(p => !S.muted.has(p.author));
    S.suggested = [...new Map(sug.map(p => [p.author, p.a])).values()].filter(Boolean).slice(0, 8);
    sug.forEach((p, i) => { const at = Math.min(out.length, 2 + i * 4); out.splice(at, 0, { p, at: p.created_at, sug: true }); });
    S.feed = out;
    await hydrate(out.map(x => x.p));
    S.feedAt = Date.now();
  }
  async function hydrate(posts) {
    const ids = posts.map(p => p.id), q = posts.map(p => p.quote_of).filter(Boolean), cids = posts.map(p => p.challenge_id).filter(Boolean);
    if (!ids.length) return;
    const [l, rp, qq, ch] = await Promise.all([
      sb().from("likes").select("post_id").eq("user_id", me()).in("post_id", ids),
      sb().from("reposts").select("post_id").eq("user_id", me()).in("post_id", ids),
      q.length ? sb().from("posts").select(`id,body,media_url,media_kind,a:profiles!posts_author_fkey(${PSEL})`).in("id", q) : { data: [] },
      cids.length ? sb().from("challenges").select("id,title,category,days,starts_on").in("id", cids) : { data: [] }
    ]);
    (l.data || []).forEach(x => S.likes.add(x.post_id));
    (rp.data || []).forEach(x => S.reposts.add(x.post_id));
    (qq.data || []).forEach(x => { S.quoted[x.id] = x; });
    (ch.data || []).forEach(x => { S.chById[x.id] = x; });
  }
  async function loadStories() {
    const ids = [me(), ...S.following];
    const { data } = await sb().from("stories").select(`id,author,body,bg,media_url,media_kind,created_at,a:profiles!stories_author_fkey(${PSEL})`)
      .gt("expires_at", new Date().toISOString()).in("author", ids).order("created_at");
    const g = new Map();
    (data || []).filter(s => !S.muted.has(s.author)).forEach(s => { if (!g.has(s.author)) g.set(s.author, { a: s.a, items: [] }); g.get(s.author).items.push(s); });
    const mine = g.get(me()); g.delete(me());
    S.stories = (mine ? [mine] : []).concat([...g.values()]);
    S.myStory = !!mine;
  }
  async function loadChallenges() {
    const [c, m, k] = await Promise.all([
      sb().from("challenges").select(`*,h:profiles!challenges_host_fkey(${PSEL}),challenge_members(count)`).order("starts_on", { ascending: false }).limit(80),
      sb().from("challenge_members").select("challenge_id").eq("user_id", me()),
      sb().from("checkins").select("challenge_id,day").eq("user_id", me())
    ]);
    if (c.error) throw c.error;
    S.challenges = c.data || [];
    S.challenges.forEach(x => { S.chById[x.id] = x; });
    S.mine = new Set((m.data || []).map(x => x.challenge_id));
    S.myCheckins = {}; S.checkedToday = new Set();
    (k.data || []).forEach(x => { S.myCheckins[x.challenge_id] = (S.myCheckins[x.challenge_id] || 0) + 1; if (x.day === todayKey()) S.checkedToday.add(x.challenge_id); });
  }
  async function loadCircles() {
    const { data, error } = await sb().from("circle_members").select("circle_id,circles(id,name,owner,invite_code)").eq("user_id", me());
    if (error) throw error;
    const circles = (data || []).map(x => x.circles).filter(Boolean), ids = circles.map(c => c.id);
    let members = [], status = [], msgs = [];
    if (ids.length) {
      const mm = await sb().from("circle_members").select(`circle_id,user_id,p:profiles!circle_members_user_id_fkey(${PSEL})`).in("circle_id", ids);
      members = mm.data || [];
      const uids = [...new Set(members.map(x => x.user_id))];
      const [st, ms] = await Promise.all([
        sb().from("day_status").select("user_id,done").eq("day", todayKey()).in("user_id", uids),
        sb().from("circle_messages").select("id,circle_id,author,kind,body,target,created_at").in("circle_id", ids).order("id", { ascending: false }).limit(200)
      ]);
      status = st.data || []; msgs = ms.data || [];
    }
    const done = new Set(status.filter(s => s.done).map(s => s.user_id)), seen = readLS("btbu_c_read", {});
    let lastNudge = parseInt(localStorage.getItem("btbu_c_nudge") || "0", 10);
    S.circles = circles.map(c => {
      const mem = members.filter(m => m.circle_id === c.id), my = msgs.filter(m => m.circle_id === c.id);
      return { ...c, members: mem.map(m => ({ ...m.p, done: done.has(m.user_id) })), last: my[0] || null,
        unread: my.filter(m => m.id > (seen[c.id] || 0) && m.author !== me()).length };
    });
    const nudges = msgs.filter(m => m.kind === "nudge" && m.target === me() && m.id > lastNudge);
    if (nudges.length) {
      const m = nudges[0], c = S.circles.find(x => x.id === m.circle_id), who = c && c.members.find(x => x.user_id === m.author);
      toast(`${who ? who.name || "@" + who.handle : "Someone"} nudged you${c ? " in " + c.name : ""}`);
      localStorage.setItem("btbu_c_nudge", String(Math.max(...nudges.map(x => x.id))));
    }
    const rq = await sb().from("follows").select(`follower,p:profiles!follows_follower_fkey(${PSEL})`).eq("followee", me()).eq("status", "pending");
    S.requests = rq.data || [];
  }
  async function loadCounts() {
    const c = (t, f) => { let q = sb().from(t).select("*", { count: "exact", head: true }); for (const k in f) q = q.eq(k, f[k]); return q; };
    const [p, fr, fg, mp] = await Promise.all([
      c("posts", { author: me() }), c("follows", { followee: me(), status: "accepted" }), c("follows", { follower: me(), status: "accepted" }),
      sb().from("posts").select("id,body,media_url,media_kind,card_n,created_at").eq("author", me()).order("created_at", { ascending: false }).limit(60)
    ]);
    S.counts = { posts: p.count || 0, followers: fr.count || 0, following: fg.count || 0 };
    S.myPosts = mp.data || [];
  }
  async function refresh(force) {
    if (!online() || S.loading) return;
    if (!force && Date.now() - S.feedAt < 20000) return;
    S.loading = true;
    try {
      if (!S.meLoaded) await loadMe();
      if (!S.me) { S.loading = false; render(); return; }
      await loadSocial();
      await Promise.all([loadFeed(), loadStories(), loadChallenges(), loadCircles()]);
    } catch (e) {
      if (!S.meLoaded) { S.meLoaded = true; S.loadErr = (e && e.message) || "Couldn't reach the server"; }
      else err(e);
    }
    S.loading = false; redraw();
  }

  // ---------------------------------------------------------------- views
  const iconBtn = (act, inner, extra) => `<button class="iconbtn" data-act="${act}" ${extra || ""}>${inner}</button>`;
  function gateCard(title, note, btn) {
    return `<div class="card" style="text-align:center;padding:26px 20px"><div style="font-size:34px">✦</div><div class="lead" style="margin:10px 0 6px">${title}</div><div class="note" style="font-size:13px">${note}</div>${btn || ""}</div>`;
  }
  function view() {
    const head = `<div class="between" style="align-items:center"><h1 class="h1">Community</h1>
      <div class="row" style="gap:8px">${online() && S.me ? iconBtn("c:create", "+", 'style="font-size:22px" aria-label="Create"') +
        iconBtn("c:inbox", SVG.chat + (unread() ? `<span class="c-badge">${unread()}</span>` : ""), 'style="position:relative" aria-label="Circles"') : ""}
      <button class="c-ring" data-act="go" data-s="you" aria-label="Profile">${av(S.me || { name: db.prefs.name, handle: db.prefs.handle, avatar_url: db.prefs.photo }, 34)}</button></div></div>`;
    if (!window.BTBU_SYNC || !BTBU_SYNC.client) return `<div class="page">${head}${gateCard("Community needs an account", "This copy of BTBU runs on this device only. Community switches on when the app is connected to Supabase.")}</div>`;
    if (!online()) return `<div class="page">${head}${gateCard("Sign in to join", "Posts, challenges and circles need you signed in.")}</div>`;
    if (!S.meLoaded) { refresh(true); return `<div class="page">${head}<div class="note" style="text-align:center;padding:40px">Loading…</div></div>`; }
    if (S.loadErr && !S.me) {
      const setup = /schema cache|does not exist|relation/i.test(S.loadErr);
      return `<div class="page">${head}${gateCard(setup ? "Community isn't switched on yet" : "Couldn't load Community",
        setup ? "The server is missing the community tables. Whoever runs this BTBU needs to run supabase/migrations/v27_community.sql in Supabase." : esc(S.loadErr),
        `<button class="btn" data-act="c:retry" style="margin-top:16px">Try again</button>`)}</div>`;
    }
    if (!S.me) return `<div class="page">${head}${gateCard("Set up your community profile", "Pick a handle and who can see your posts. Your habits stay encrypted either way.", `<button class="btn" data-act="c:join" style="margin-top:16px">Get started</button>`)}</div>`;
    const tabs = `<div class="seg">${[["feed", "Feed"], ["challenges", "Challenges"]].map(([k, l]) => `<button class="${S.tab === k ? "on" : ""}" data-act="c:tab" data-v="${k}">${l}</button>`).join("")}</div>`;
    return `<div class="page" style="padding-left:0;padding-right:0"><div style="padding:0 20px">${head}</div>
      ${storiesRow()}<div style="padding:0 20px">${tabs}</div>
      ${S.tab === "feed" ? feedView() : challengesView()}</div>`;
  }
  const unread = () => S.circles.reduce((a, c) => a + c.unread, 0) + S.requests.length;
  function storiesRow() {
    const mine = S.myStory;
    const meP = S.me;
    const others = S.stories.filter(g => g.a && g.a.user_id !== me());
    return `<div class="c-hscroll scroll" style="padding:2px 20px">
      <button class="c-story" data-act="${mine ? "c:story" : "c:createStory"}" data-i="0"><span class="c-sring" style="background:${mine ? GRAD : "var(--chip)"}">${av(meP, 58, "border:3px solid var(--bg)")}<i class="c-plus">+</i></span><span>Your story</span></button>
      ${others.map((g, i) => { const seen = g.items.every(s => S.seen.has(s.id));
        return `<button class="c-story" data-act="c:story" data-i="${i + (mine ? 1 : 0)}"><span class="c-sring" style="background:${seen ? "var(--chip)" : GRAD}">${av(g.a, 58, "border:3px solid var(--bg)")}</span><span style="color:${seen ? "var(--faint)" : "var(--text)"}">${first(g.a)}</span></button>`; }).join("")}
    </div>`;
  }
  function feedView() {
    if (S.loading && !S.feed.length) return `<div class="note" style="text-align:center;padding:30px">Loading…</div>`;
    let html = "", sugShown = false;
    S.feed.forEach((it, i) => {
      html += postCard(it.p, it);
      if (!sugShown && i === 1 && S.suggested.length) { sugShown = true; html += suggestBlock(); }
    });
    if (!sugShown && S.suggested.length) html += suggestBlock();
    if (!S.feed.length) html += `<div class="card" style="text-align:center"><div class="lead" style="margin:0 0 6px">Your feed is quiet</div><div class="note">Follow people from Challenges, or post your first check-in.</div><button class="btn" data-act="c:create" style="margin-top:14px">Create a post</button></div>`;
    return `<div style="display:flex;flex-direction:column;gap:12px;padding:0 12px">${html}</div>`;
  }
  function suggestBlock() {
    const list = S.suggested.filter(p => p.user_id !== me() && !S.following.has(p.user_id));
    if (!list.length) return "";
    return `<div class="card" style="padding:16px 0"><div class="between" style="padding:0 16px;margin-bottom:12px"><div class="kicker">Suggested for you</div></div>
      <div class="c-hscroll scroll" style="padding:0 16px">${list.map(p => `<div class="c-sug"><button data-act="c:user" data-id="${p.user_id}">${av(p, 56)}</button>
        <b>${esc(p.name || "@" + p.handle)}</b><span class="note">@${esc(p.handle)}</span>
        <button class="c-btn on" data-act="c:follow" data-id="${p.user_id}">Follow</button></div>`).join("")}</div></div>`;
  }
  function postCard(p, it) {
    it = it || {};
    const a = p.a || {}, liked = S.likes.has(p.id), rp = S.reposts.has(p.id), mine = p.author === me();
    const q = p.quote_of && S.quoted[p.quote_of], ch = p.challenge_id && S.chById[p.challenge_id];
    const showFollow = !mine && !S.following.has(p.author) && it.sug;
    return `<article class="card c-post">
      ${it.by ? `<div class="c-meta" style="padding:0 16px 10px">${SVG.repost.replace(/19/g, "13")} ${first(it.by)} reposted</div>` : ""}
      <div class="row" style="gap:10px;padding:0 16px">
        <button data-act="c:user" data-id="${p.author}">${av(a, 38)}</button>
        <div style="flex:1;min-width:0"><button data-act="c:user" data-id="${p.author}" style="text-align:left;display:block"><b class="c-name">${esc(a.name || "@" + a.handle)}</b></button>
          <div class="c-meta">@${esc(a.handle || "")} · ${ago(p.created_at)}${it.sug ? " · Suggested" : ""}${p.held ? " · held for review" : ""}</div></div>
        ${showFollow ? `<button class="c-btn on" data-act="c:follow" data-id="${p.author}">Follow</button>` : ""}
        <button class="c-dots" data-act="c:menu" data-id="${p.id}" aria-label="More">⋯</button>
      </div>
      ${p.body ? `<div class="c-body">${esc(p.body)}</div>` : ""}
      ${p.media_url ? `<div class="c-mwrap" ${p.media_kind === "photo" ? `data-act="c:dbl" data-id="${p.id}"` : ""}>${mediaTag(p.media_url, p.media_kind)}</div>` : ""}
      ${p.card_n != null ? `<div class="c-card"><div class="kicker" style="color:#fff;opacity:.8">BTBU · streak</div><div class="row" style="align-items:flex-end;gap:8px;margin-top:10px"><b>${p.card_n}</b><span>days</span></div><div class="c-cardh">@${esc(a.handle || "")}</div></div>` : ""}
      ${q ? `<div class="c-quote"><div class="row" style="gap:8px">${av(q.a, 22)}<b style="font-size:13px">${esc((q.a && (q.a.name || q.a.handle)) || "")}</b></div>${q.body ? `<div style="font-size:14px;color:var(--muted);margin-top:6px">${esc(q.body)}</div>` : ""}${q.media_url ? `<div style="margin-top:8px">${mediaTag(q.media_url, q.media_kind, "c-media sm")}</div>` : ""}</div>` : ""}
      ${ch ? `<button class="c-chlink" data-act="c:ch" data-id="${ch.id}"><span>${CATS[ch.category] || "✦"}</span><span style="flex:1;min-width:0;text-align:left"><b>${esc(ch.title)}</b><span class="c-meta" style="display:block">${chStatus(ch)}</span></span><span>›</span></button>` : ""}
      <div class="row" style="gap:2px;padding:6px 8px 0">
        <button class="c-act" data-act="c:like" data-id="${p.id}" style="color:${liked ? "var(--ac2)" : "var(--muted)"}">${SVG.heart(liked ? "currentColor" : "none")}${fmtN(n(p.likes))}</button>
        <button class="c-act" data-act="c:comments" data-id="${p.id}">${SVG.chat}${fmtN(n(p.comments))}</button>
        <button class="c-act" data-act="c:repost" data-id="${p.id}" style="color:${rp ? "var(--ok)" : "var(--muted)"}">${SVG.repost}${fmtN(n(p.reposts))}</button>
        <span style="flex:1"></span>
        <button class="c-act" data-act="c:share" data-id="${p.id}" aria-label="Share">${SVG.send}</button>
      </div></article>`;
  }
  function challengesView() {
    const all = S.challenges, mine = all.filter(c => S.mine.has(c.id) && chDay(c) <= c.days);
    const match = c => S.cat === "All" || c.category === S.cat;
    const open = all.filter(c => !S.mine.has(c.id) && chDay(c) <= c.days && match(c));
    return `<div style="display:flex;flex-direction:column;gap:14px;padding:0 20px">
      <button class="c-host" data-act="c:host"><span class="c-hosti">+</span><span style="flex:1;text-align:left"><b>Host a challenge</b><span class="note" style="display:block;margin-top:3px">Anyone can host. Members check in daily with a photo or video.</span></span></button>
      ${mine.length ? `<div class="kicker" style="margin-top:4px">You're in · ${mine.length}</div>${mine.map(myChRow).join("")}` : ""}
      <div class="kicker" style="margin-top:6px">Open to join</div>
      <div class="c-hscroll scroll" style="margin:0 -20px;padding:0 20px;gap:6px">${["All", ...Object.keys(CATS)].map(k => `<button class="c-chip${S.cat === k ? " on" : ""}" data-act="c:cat" data-v="${k}">${k === "All" ? "All" : CATS[k] + " " + k}</button>`).join("")}</div>
      ${open.map(chCard).join("") || `<div class="card note" style="text-align:center;padding:24px">Nothing open here yet. Host the first one.</div>`}
    </div>`;
  }
  function myChRow(c) {
    const d = chDay(c), started = live(c), chk = S.checkedToday.has(c.id), done = S.myCheckins[c.id] || 0;
    return `<div class="card c-mych" data-act="c:ch" data-id="${c.id}">
      <div class="row" style="gap:12px"><span class="c-cov" style="background:${COVERS[c.cover] || COVERS.violet}">${CATS[c.category] || "✦"}</span>
        <div style="flex:1;min-width:0"><b class="c-name" style="font-size:16px">${esc(c.title)}</b><div class="c-meta">${chStatus(c)} · ${done} check-in${done === 1 ? "" : "s"}</div></div>
        ${started ? `<button class="c-btn ${chk ? "" : "on"}" data-act="${chk ? "c:ch" : "c:proof"}" data-id="${c.id}">${chk ? "Done ✓" : "Check in"}</button>` : `<span class="c-btn">Joined</span>`}</div>
      <div class="track" style="margin-top:12px"><i style="width:${started ? Math.round(Math.min(d, c.days) / c.days * 100) : 0}%"></i></div></div>`;
  }
  function chCard(c) {
    const j = S.mine.has(c.id);
    return `<div class="card c-chcard" data-act="c:ch" data-id="${c.id}">
      <div class="c-chcov" style="background:${COVERS[c.cover] || COVERS.violet}"><span class="c-em">${CATS[c.category] || "✦"}</span><span class="c-tag">${esc(c.category)}</span><span class="c-tag light">${chStatus(c)}</span></div>
      <div style="padding:14px 16px 16px"><b class="c-name" style="font-size:17px">${esc(c.title)}</b>
        <div class="c-meta" style="margin-top:3px">by ${esc((c.h && (c.h.name || "@" + c.h.handle)) || "")} · ${c.days} days · 📷 daily proof</div>
        <div class="between" style="align-items:center;margin-top:12px"><span class="c-meta" style="font-weight:700">${fmtN(n(c.challenge_members))} in</span>
          <button class="c-btn ${j ? "" : "on"}" data-act="${j ? "c:ch" : "c:joinch"}" data-id="${c.id}">${j ? "Joined" : "Join"}</button></div></div></div>`;
  }

  // ---------------------------------------------------------------- profile (You tab)
  function profileHeader() {
    const p = S.me, c = S.counts;
    if (online() && S.me && !c && !S.countsBusy) { S.countsBusy = true; loadCounts().then(render).catch(err).finally(() => { S.countsBusy = false; }); }
    const counts = c ? [["posts", c.posts], ["followers", c.followers], ["following", c.following]] : [["posts", "–"], ["followers", "–"], ["following", "–"]];
    return { p, counts: `<div class="c-counts">${counts.map(([l, v]) => `<div><b>${typeof v === "number" ? fmtN(v) : v}</b><span>${l}</span></div>`).join("")}</div>` };
  }
  function profileGrid() {
    if (!online()) return `<div class="note" style="text-align:center;padding:30px 20px">Sign in to post.</div>`;
    if (!S.me) return `<div style="padding:20px">${gateCard("No posts yet", "Set up your community profile to start posting.", `<button class="btn" data-act="c:join" style="margin-top:16px">Get started</button>`)}</div>`;
    if (!S.myPosts.length) return `<div style="padding:20px">${gateCard("No posts yet", "Share a check-in, a streak card or a win.", `<button class="btn" data-act="c:create" style="margin-top:16px">Create a post</button>`)}</div>`;
    return `<div class="c-grid">${S.myPosts.map(p => `<button class="c-tile" data-act="c:openpost" data-id="${p.id}" style="${p.card_n != null ? "background:" + GRAD : ""}">
      ${p.media_url ? (p.media_kind === "video" ? `<video src="${esc(p.media_url)}#t=0.1" preload="metadata" muted playsinline></video><i class="c-play">▶</i>` : `<img src="${esc(p.media_url)}" alt="" loading="lazy">`)
        : p.card_n != null ? `<b class="c-tilen">${p.card_n}</b>` : `<span class="c-tilet">${esc(p.body.slice(0, 80))}</span>`}</button>`).join("")}</div>`;
  }
  function profileChallenges() {
    if (!online() || !S.me) return `<div class="note" style="text-align:center;padding:30px 20px">Join a challenge from Community.</div>`;
    const mine = S.challenges.filter(c => S.mine.has(c.id));
    if (!mine.length) return `<div style="padding:20px">${gateCard("No challenges yet", "Join one or host your own.", `<button class="btn" data-act="c:goch" style="margin-top:16px">Browse challenges</button>`)}</div>`;
    const liveL = mine.filter(c => chDay(c) <= c.days), done = mine.filter(c => chDay(c) > c.days);
    return `<div style="padding:18px 20px;display:flex;flex-direction:column;gap:10px">
      ${liveL.length ? `<div class="kicker">Live</div>${liveL.map(myChRow).join("")}` : ""}
      ${done.length ? `<div class="kicker" style="margin-top:8px">Finished</div>${done.map(c => `<div class="card row" style="gap:12px;padding:14px" data-act="c:ch" data-id="${c.id}"><span class="c-cov">${CATS[c.category] || "✦"}</span><div style="flex:1;min-width:0"><b class="c-name">${esc(c.title)}</b><div class="c-meta">${S.myCheckins[c.id] || 0}/${c.days} check-ins</div></div><span class="c-tag ok">Completed</span></div>`).join("")}` : ""}
    </div>`;
  }

  // ---------------------------------------------------------------- sheets
  function head(t, sub) { return `<div class="between" style="align-items:center"><h3>${t}</h3><button class="x" data-act="close" aria-label="Close">✕</button></div>${sub ? `<div class="note" style="font-size:13px;margin:7px 0 0">${sub}</div>` : ""}`; }
  function sheet(name) {
    const d = S.d;
    if (name === "c:join") {
      const v = d.vis || "public";
      return `${head("Your community profile", "Your habits stay encrypted either way. This only covers posts, stories and your profile.")}
        <div class="scroll" style="display:flex;flex-direction:column;gap:12px;margin-top:16px">
        <label class="kicker">Handle</label><div class="c-input row" style="gap:2px"><span style="color:var(--muted)">@</span><input id="c_handle" value="${esc(d.handle != null ? d.handle : (db.prefs.handle || ""))}" maxlength="20" placeholder="yourname" autocomplete="off" style="flex:1"></div>
        <label class="kicker">Name</label><input class="c-input" id="c_name" value="${esc(d.name != null ? d.name : (db.prefs.name || ""))}" maxlength="40" placeholder="Your name">
        <label class="kicker">Who can see your posts?</label>
        ${[["public", "🌐", "Public", "Anyone can see your posts and follow you."], ["private", "🔒", "Private", "You approve followers. Challenge check-ins stay visible to members."]].map(([k, i, t, x]) =>
          `<button class="opt${v === k ? " on" : ""}" data-act="c:vis" data-v="${k}" style="align-items:flex-start"><span class="box" style="margin-top:2px">✓</span><span><b style="display:block">${i} ${t}</b><span class="note">${x}</span></span></button>`).join("")}
        <button class="opt${d.adult ? " on" : ""}" data-act="c:adult"><span class="box">✓</span><span>I'm 18 or older</span></button>
        <div class="note">Community is 18+ for now. Under-18 accounts need verified parental consent under India's DPDP Act, which isn't built yet.</div>
        </div><button class="btn" data-act="c:saveProfile" style="margin-top:14px" ${d.adult ? "" : "disabled"}>${d.busy ? "Saving…" : "Continue"}</button>`;
    }
    if (name === "c:create") {
      const mode = d.mode || "post";
      const seg = `<div class="seg" style="margin-top:14px">${[["post", "Post"], ["story", "Story"]].map(([k, l]) => `<button class="${mode === k ? "on" : ""}" data-act="c:mode" data-v="${k}">${l}</button>`).join("")}</div>`;
      const pick = `<input type="file" id="c_file" accept="image/*,video/*" class="hidden">`;
      if (mode === "story") {
        const bg = d.bg || "violet";
        return `${head("Create")}${seg}<div class="scroll" style="display:flex;flex-direction:column;gap:12px;margin-top:16px">
          <div class="c-storyprev" style="background:${COVERS[bg]}">${d.media ? mediaTag(d.media.preview, d.media.kind, "c-media fill") : ""}<b>${esc(d.text || (d.media ? "" : "Day " + streak()))}</b>${d.sticker !== false ? `<span class="c-tag">🔥 ${streak()}-day streak</span>` : ""}</div>
          <input class="c-input" id="c_text" value="${esc(d.text || "")}" maxlength="120" placeholder="Add text">
          <div class="between" style="align-items:center"><div class="row" style="gap:8px">${Object.keys(COVERS).slice(0, 5).map(k => `<button class="c-swatch" data-act="c:bg" data-v="${k}" style="background:${COVERS[k]};${bg === k ? "box-shadow:0 0 0 2px var(--sheet),0 0 0 4px var(--strong)" : ""}"></button>`).join("")}</div>
            <button class="c-chip${d.sticker !== false ? " on" : ""}" data-act="c:sticker">🔥 Streak</button></div>
          <label class="btn ghost" for="c_file">${d.media ? "Change photo or video" : "Add photo or video"}</label>${pick}
          </div><button class="btn" data-act="c:postStory" style="margin-top:12px">${d.busy ? "Sharing…" : "Share to your story"}</button>`;
      }
      const can = (d.body || "").trim() || d.media || d.card;
      return `${head("Create")}${seg}<div class="scroll" style="display:flex;flex-direction:column;gap:12px;margin-top:16px">
        <div class="row" style="gap:10px">${av(S.me, 38)}<div><b class="c-name">${esc(S.me.name || "@" + S.me.handle)}</b><div class="c-meta">${S.me.is_private ? "🔒 Visible to your followers" : "🌐 Visible to everyone"}</div></div></div>
        <textarea class="c-input" id="c_body" rows="4" maxlength="2000" placeholder="Share a win, a slip, or a check-in…">${esc(d.body || "")}</textarea>
        ${d.media ? `<div class="c-mwrap" style="margin:0;position:relative">${mediaTag(d.media.preview, d.media.kind)}<button class="x c-rm" data-act="c:rmMedia">✕</button></div>` : ""}
        ${d.card ? `<div class="c-card" style="margin:0;position:relative"><div class="kicker" style="color:#fff;opacity:.8">BTBU · streak</div><div class="row" style="align-items:flex-end;gap:8px;margin-top:10px"><b>${streak()}</b><span>days</span></div><button class="x c-rm" data-act="c:card">✕</button></div>` : ""}
        <div class="row" style="gap:8px"><label class="c-tool" for="c_file">📷<span>Photo / video</span></label>${pick}<button class="c-tool${d.card ? " on" : ""}" data-act="c:card">🔥<span>Streak card</span></button></div>
        <div class="note">Posts with filtered words are held for review.</div>
        </div><button class="btn" data-act="c:post" style="margin-top:12px" ${can && !d.busy ? "" : "disabled"}>${d.busy ? "Posting…" : "Post"}</button>
        <button class="note" data-act="c:host" style="text-align:center;padding:10px 0 0;font-size:13px">or host a challenge →</button>`;
    }
    if (name === "c:comments") {
      const list = d.comments;
      return `${head("Comments")}<div class="scroll" style="flex:1;min-height:120px;display:flex;flex-direction:column;gap:16px;margin:16px 0">
        ${list == null ? `<div class="note">Loading…</div>` : list.length ? list.map(c => `<div class="row" style="gap:10px;align-items:flex-start">${av(c.a, 34)}<div style="flex:1;min-width:0">
          <div style="font-size:13px"><b>${esc((c.a && (c.a.name || "@" + c.a.handle)) || "")}</b> <span class="c-meta" style="display:inline">${ago(c.created_at)}${c.held ? " · held" : ""}</span></div>
          <div style="font-size:14px;margin-top:2px;white-space:pre-wrap;word-break:break-word">${esc(c.body)}</div></div>
          ${c.author === me() || d.postAuthor === me() ? `<button class="c-dots" data-act="c:delComment" data-id="${c.id}" aria-label="Delete">✕</button>` : `<button class="c-dots" data-act="c:reportComment" data-id="${c.id}" aria-label="Report">⚑</button>`}</div>`).join("")
          : `<div class="note">No comments yet. Say something kind.</div>`}</div>
        <div class="row" style="gap:8px">${av(S.me, 36)}<input class="c-input" id="c_comment" maxlength="500" placeholder="Add a comment" style="flex:1" value="${esc(d.draft || "")}"><button class="c-btn on" data-act="c:addComment">Post</button></div>`;
    }
    if (name === "c:repost") {
      const p = d.post, on = p && S.reposts.has(p.id);
      if (!d.quote) return `${head("Repost")}<div style="display:flex;flex-direction:column;gap:8px;margin-top:16px">
        <button class="menu" data-act="c:plainRepost"><span class="i">${SVG.repost}</span><span style="flex:1"><b style="display:block">${on ? "Undo repost" : "Repost"}</b><span class="note">Shows the post to your followers as is</span></span></button>
        <button class="menu" data-act="c:startQuote"><span class="i" style="font-size:22px;font-weight:800">❝</span><span style="flex:1"><b style="display:block">Quote</b><span class="note">Add your take above the original</span></span></button></div>`;
      return `${head("Quote")}<textarea class="c-input" id="c_quote" rows="3" maxlength="2000" placeholder="Add your take" style="margin-top:16px">${esc(d.qtext || "")}</textarea>
        <div class="c-quote" style="margin:10px 0 0"><b style="font-size:12px;color:var(--muted)">${esc((p.a && (p.a.name || p.a.handle)) || "")}</b><div style="font-size:13px;margin-top:3px">${esc((p.body || "").slice(0, 140))}</div></div>
        <button class="btn" data-act="c:postQuote" style="margin-top:14px">${d.busy ? "Posting…" : "Post quote"}</button>`;
    }
    if (name === "c:menu") {
      const p = d.post; if (!p) return head("Post");
      if (d.report) return `${head("Why are you reporting this?", "Reports are anonymous. A person reviews each one within 24 hours.")}<div class="scroll" style="display:flex;flex-direction:column;gap:6px;margin-top:14px">
        ${REASONS.map(r => `<button class="menu" data-act="c:report" data-v="${esc(r)}" style="padding:13px 16px"><span style="flex:1;font-weight:700">${r}</span>›</button>`).join("")}</div>`;
      const h = esc((p.a && p.a.handle) || "");
      const rows = p.author === me()
        ? [["c:delPost", "🗑", "Delete post", "Removes it everywhere"], ["c:share", "⧉", "Copy link", ""]]
        : [["c:reportStart", "⚑", "Report post", "Harassment, unsafe advice, spam…"], ["c:block", "⛔", "Block @" + h, "They can't see your profile, posts or challenges"],
           ["c:mute", "🔕", "Mute @" + h, "Hide their posts and stories. They won't know."], ["c:share", "⧉", "Copy link", ""]];
      return `${head("Post options")}<div style="display:flex;flex-direction:column;gap:8px;margin-top:16px">${rows.map(([a, i, l, x]) => `<button class="menu" data-act="${a}" data-id="${p.id}"><span class="i">${i}</span><span style="flex:1"><b style="display:block">${l}</b>${x ? `<span class="note">${x}</span>` : ""}</span></button>`).join("")}</div>`;
    }
    if (name === "c:proof") {
      const c = S.chById[d.cid]; if (!c) return head("Check in");
      return `${head(`Day ${chDay(c)} check-in`, esc(c.title))}<div class="scroll" style="display:flex;flex-direction:column;gap:12px;margin-top:16px">
        ${d.media ? `<div class="c-mwrap" style="margin:0;position:relative">${mediaTag(d.media.preview, d.media.kind)}<button class="x c-rm" data-act="c:rmMedia">✕</button></div>`
          : `<label class="c-drop" for="c_file"><span style="font-size:30px">📷</span><b>Add a photo or video</b><span class="note">Proof is required · videos up to 60 s</span></label>`}
        <input type="file" id="c_file" accept="image/*,video/*" capture="environment" class="hidden">
        <input class="c-input" id="c_caption" maxlength="280" placeholder="Caption (optional)" value="${esc(d.caption || "")}">
        <button class="opt${d.toFeed !== false ? " on" : ""}" data-act="c:toFeed"><span class="box">✓</span><span>Also post to my feed</span></button>
        </div><button class="btn" data-act="c:postProof" style="margin-top:12px" ${d.media && !d.busy ? "" : "disabled"}>${d.busy ? "Uploading…" : "Post check-in"}</button>`;
    }
    if (name === "c:circleNew") {
      return `${head("Circles", "Small private groups, up to 12 people. Only circle members can nudge you.")}<div style="display:flex;flex-direction:column;gap:10px;margin-top:16px">
        <label class="kicker">Start a circle</label><div class="row" style="gap:8px"><input class="c-input" id="c_cname" maxlength="40" placeholder="e.g. Hostel 4 · 6am crew" style="flex:1"><button class="c-btn on" data-act="c:createCircle">Create</button></div>
        <label class="kicker" style="margin-top:8px">Have an invite code?</label><div class="row" style="gap:8px"><input class="c-input" id="c_code" maxlength="12" placeholder="8-letter code" style="flex:1;text-transform:lowercase"><button class="c-btn on" data-act="c:joinCircle">Join</button></div></div>`;
    }
    return head("");
  }

  // ---------------------------------------------------------------- full-screen layers
  function renderLayer() {
    const el = document.getElementById("layer"); if (!el) return;
    const L = S.layer;
    el.classList.toggle("hidden", !L);
    if (!L) { el.innerHTML = ""; return; }
    let html = "";
    if (L.type === "ch") html = chLayer(L);
    if (L.type === "host") html = hostLayer(L);
    if (L.type === "inbox") html = inboxLayer();
    if (L.type === "chat") html = chatLayer(L);
    if (L.type === "user") html = userLayer(L);
    if (L.type === "story") html = storyLayer(L);
    if (L.type === "post") html = `<div class="c-lhead"><button class="iconbtn" data-act="c:back">‹</button><b class="c-name" style="flex:1">Post</b></div><div class="scroll" style="flex:1;padding:12px 12px 40px">${L.post ? postCard(L.post) : `<div class="note">Loading…</div>`}</div>`;
    const keep = el.firstElementChild && el.dataset.t === L.type;
    el.dataset.t = L.type;
    const sc = el.querySelector(".scroll"), top = keep && sc ? sc.scrollTop : 0;
    el.innerHTML = html;
    const ns = el.querySelector(".scroll"); if (ns && keep) ns.scrollTop = top;
    if (L.type === "chat") { const m = document.getElementById("c_msgs"); if (m && L.stick !== false) m.scrollTop = m.scrollHeight; }
  }
  function chLayer(L) {
    const c = S.chById[L.id]; if (!c) return `<div class="c-lhead"><button class="iconbtn" data-act="c:back">‹</button></div><div class="note" style="padding:20px">Loading…</div>`;
    const j = S.mine.has(c.id), d = chDay(c), started = live(c), chk = S.checkedToday.has(c.id), h = c.h || {};
    const lb = L.lb, scope = L.scope || "all";
    const cta = !j ? ["c:joinch", "Join challenge · free", true] : !started ? ["", d < 1 ? "You're in · " + chStatus(c).toLowerCase() : "Finished", false] : chk ? ["", "Checked in today ✓", false] : ["c:proof", "Check in · Day " + d, true];
    return `<div class="scroll" style="flex:1;padding-bottom:110px">
      <div class="c-chhero" style="background:${COVERS[c.cover] || COVERS.violet}">
        <div class="between" style="position:relative;z-index:1"><button class="iconbtn c-glass" data-act="c:back">‹</button><button class="iconbtn c-glass" data-act="c:shareCh" data-id="${c.id}">${SVG.send}</button></div>
        <span class="c-em big">${CATS[c.category] || "✦"}</span>
        <div style="position:relative;z-index:1"><span class="c-tag">${esc(c.category)}</span><h1 class="h1" style="color:#fff;margin-top:10px;max-width:290px">${esc(c.title)}</h1></div></div>
      <div style="padding:18px 20px;display:flex;flex-direction:column;gap:16px">
        <div class="row" style="gap:12px"><button data-act="c:user" data-id="${c.host}">${av(h, 40)}</button><div style="flex:1;min-width:0"><div class="c-meta">Hosted by</div><b class="c-name">${esc(h.name || "@" + h.handle)}</b></div>
          ${c.host !== me() ? `<button class="c-btn ${S.following.has(c.host) ? "" : "on"}" data-act="c:follow" data-id="${c.host}">${S.following.has(c.host) ? "Following" : "Follow"}</button>` : `<button class="c-btn" data-act="c:delCh" data-id="${c.id}">Delete</button>`}</div>
        <div class="row" style="gap:8px;align-items:stretch">${[[c.days, "days"], [fmtN(n(c.challenge_members)), "joined"], started ? ["Day " + d, "today"] : [d < 1 ? parseKey(c.starts_on).toLocaleDateString("en", { month: "short", day: "numeric" }) : "Done", d < 1 ? "starts" : "status"]]
          .map(([v, l]) => `<div class="card" style="flex:1;padding:14px"><b style="font-size:22px;font-weight:800;color:var(--strong);letter-spacing:-.03em">${v}</b><div class="c-meta" style="margin-top:4px">${l}</div></div>`).join("")}</div>
        ${c.habit ? `<div style="font-size:15px"><b>Daily habit:</b> ${esc(c.habit)}</div>` : ""}
        <div class="c-rule"><span>📷</span><div><b>Photo or video proof, every day</b><div class="note">Check-ins go to the challenge wall. You choose whether each one also goes to your feed.</div></div></div>
        <div class="card"><div class="between" style="align-items:center"><div class="kicker">Leaderboard</div>
          <div class="seg" style="padding:3px;gap:2px">${[["all", "Everyone"], ["following", "Following"]].map(([k, l]) => `<button class="${scope === k ? "on" : ""}" data-act="c:lbScope" data-v="${k}" style="padding:6px 10px;font-size:11px">${l}</button>`).join("")}</div></div>
          <div style="display:flex;flex-direction:column;gap:4px;margin-top:12px">${lb == null ? `<div class="note">Loading…</div>` : !lb.length ? `<div class="note">Nobody here yet.</div>` :
            lb.map((r, i) => `<button class="c-lbrow${r.user_id === me() ? " me" : ""}" data-act="c:user" data-id="${r.user_id}"><span class="c-rank" style="color:${i < 3 ? "#ffd166" : "var(--muted)"}">${i + 1}</span>${av(r, 32)}<span style="flex:1;min-width:0;text-align:left"><b style="display:block;font-size:14px">${r.user_id === me() ? "You" : esc(r.name || r.handle)}</b><span class="c-meta">@${esc(r.handle)}</span></span><b style="font-size:13px">${r.checkins}/${Math.max(1, Math.min(d, c.days))}</b></button>`).join("")}</div></div>
        ${started ? `<div><div class="kicker" style="margin-bottom:10px">Today's check-ins</div>${L.wall == null ? `<div class="note">Loading…</div>` : L.wall.length ? `<div class="c-wall">${L.wall.map(w => `<div class="c-wtile">${mediaTag(w.media_url, w.media_kind, "c-media fill")}<span class="c-wav">${av(w.p, 24, "border:2px solid var(--bg)")}</span></div>`).join("")}</div>` : `<div class="note">No check-ins yet today. Be first.</div>`}</div>` : ""}
        ${j && c.host !== me() ? `<button class="note" data-act="c:leaveCh" data-id="${c.id}" style="text-align:center;padding:8px">Leave challenge</button>` : ""}
        ${c.host !== me() ? `<button class="note" data-act="c:reportCh" data-id="${c.id}" style="text-align:center;padding:4px">Report challenge</button>` : ""}
      </div></div>
      <div class="c-foot"><button class="btn" ${cta[2] ? `data-act="${cta[0]}" data-id="${c.id}"` : "disabled"}>${cta[1]}</button></div>`;
  }
  function hostLayer(L) {
    const h = L.h, steps = ["Name your challenge", "Set the rules", "Review and publish"], s = L.step;
    const chip = (act, v, on, label) => `<button class="c-chip${on ? " on" : ""}" data-act="${act}" data-v="${v}">${label}</button>`;
    const starts = startOptions();
    let body = "";
    if (s === 0) body = `<label class="kicker">Challenge name</label><input class="c-input" id="c_h_title" maxlength="60" placeholder="e.g. No sugar till Diwali" value="${esc(h.title)}">
      <label class="kicker">The daily habit</label><input class="c-input" id="c_h_habit" maxlength="80" placeholder="e.g. 20 pages before bed" value="${esc(h.habit)}">
      <label class="kicker">Category</label><div class="row" style="flex-wrap:wrap;gap:6px">${Object.keys(CATS).map(k => chip("c:hcat", k, h.category === k, CATS[k] + " " + k)).join("")}</div>
      <label class="kicker">Cover</label><div class="row" style="gap:10px">${Object.keys(COVERS).map(k => `<button class="c-swatch sq" data-act="c:hcov" data-v="${k}" style="background:${COVERS[k]};${h.cover === k ? "box-shadow:0 0 0 2px var(--bg),0 0 0 4px var(--strong)" : ""}"></button>`).join("")}</div>`;
    if (s === 1) body = `<label class="kicker">How long</label><div class="c-dur">${[7, 14, 21, 30, 40].map(x => `<button class="c-chip${h.days === x ? " on" : ""}" data-act="c:hdays" data-v="${x}"><b>${x}</b><span>days</span></button>`).join("")}</div>
      <label class="kicker">Starts</label><div class="row" style="flex-wrap:wrap;gap:6px">${starts.map(o => chip("c:hstart", o.k, h.starts_on === o.k, o.l)).join("")}</div>
      <label class="kicker">Rules for every BTBU challenge</label>
      ${[["📷", "Photo or video proof", "One check-in per member, every day"], ["🌐", "Open to anyone, free", "No approvals, no entry fees"], ["🏆", "Leaderboard on", "Everyone, or just people you follow"]].map(([i, t, x]) => `<div class="c-rule"><span>${i}</span><div><b>${t}</b><div class="note">${x}</div></div><span style="margin-left:auto;color:var(--faint)">🔒</span></div>`).join("")}`;
    if (s === 2) body = `${chCard({ id: "", title: h.title || "Untitled challenge", category: h.category, cover: h.cover, days: h.days, starts_on: h.starts_on, h: S.me, challenge_members: [{ count: 1 }] }).replace('data-act="c:ch" data-id=""', "").replace(/data-act="c:joinch"[^>]*>Join/, ">You")}
      <div class="note" style="font-size:13px;line-height:1.5">Hosts keep the space safe: no medical or weight-loss claims, no paid entry, nothing aimed at under-18s. Members can report the challenge, and the keyword filter applies to every check-in.</div>
      <button class="opt${h.agree ? " on" : ""}" data-act="c:hagree"><span class="box">✓</span><span>I'll follow the host guidelines</span></button>`;
    const ok = s === 0 ? h.title.trim().length >= 3 : s === 2 ? h.agree && !L.busy : true;
    return `<div class="c-lhead"><button class="iconbtn" data-act="c:back">✕</button><span class="kicker" style="margin-left:auto">Step ${s + 1} of 3</span></div>
      <div style="padding:0 20px"><h1 class="h1">${steps[s]}</h1><div class="dots" style="margin-top:14px">${steps.map((_, i) => `<i class="${i <= s ? "on" : ""}" style="flex:1"></i>`).join("")}</div></div>
      <div class="scroll" style="flex:1;padding:22px 20px;display:flex;flex-direction:column;gap:12px">${body}</div>
      <div class="row" style="padding:12px 20px max(22px,env(safe-area-inset-bottom));gap:8px">${s > 0 ? `<button class="btn ghost" data-act="c:hback" style="width:auto;padding:15px 22px">Back</button>` : ""}
        <button class="btn" data-act="c:hnext" style="flex:1" ${ok ? "" : "disabled"}>${s < 2 ? "Next" : L.busy ? "Publishing…" : "Publish challenge"}</button></div>`;
  }
  function startOptions() {
    const t = parseKey(todayKey()), k = d => { const x = new Date(t); x.setDate(x.getDate() + d); return x; };
    const tm = k(1), mon = k(((8 - t.getDay()) % 7) || 7), nm = new Date(t.getFullYear(), t.getMonth() + 1, 1);
    const f = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    const out = [{ k: f(tm), l: "Tomorrow" }];
    if (f(mon) !== f(tm)) out.push({ k: f(mon), l: "Mon, " + mon.toLocaleDateString("en", { month: "short", day: "numeric" }) });
    out.push({ k: f(nm), l: nm.toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric" }) });
    return out;
  }
  function inboxLayer() {
    return `<div class="c-lhead"><button class="iconbtn" data-act="c:back">‹</button><h1 class="h1" style="flex:1;font-size:26px">Circles</h1><button class="iconbtn" data-act="c:circleNew" style="font-size:22px">+</button></div>
      <div class="note" style="padding:0 20px;font-size:13px">Small private groups. Only people in a circle can nudge you.</div>
      <div class="scroll" style="flex:1;padding:16px 20px 30px;display:flex;flex-direction:column;gap:10px">
      ${S.requests.length ? `<div class="kicker">Follow requests · ${S.requests.length}</div>${S.requests.map(r => `<div class="card row" style="gap:12px;padding:12px 14px">${av(r.p, 40)}<div style="flex:1;min-width:0"><b class="c-name">${esc((r.p && (r.p.name || r.p.handle)) || "")}</b><div class="c-meta">@${esc((r.p && r.p.handle) || "")}</div></div>
        <button class="c-btn on" data-act="c:approve" data-id="${r.follower}">Approve</button><button class="c-btn" data-act="c:decline" data-id="${r.follower}">✕</button></div>`).join("")}<div class="kicker" style="margin-top:8px">Your circles</div>` : ""}
      ${S.circles.length ? S.circles.map(c => { const done = c.members.filter(m => m.done).length, l = c.last, who = l && c.members.find(m => m.user_id === l.author);
        return `<button class="card c-circ" data-act="c:chat" data-id="${c.id}"><span class="c-cov">${esc((c.name.match(/\p{Extended_Pictographic}/u) || ["◎"])[0])}</span>
          <span style="flex:1;min-width:0;text-align:left"><b class="c-name" style="display:block">${esc(c.name)}</b><span class="c-meta c-ell" style="display:block">${l ? (l.kind === "nudge" ? "Nudge" : (l.author === me() ? "You" : first(who)) + ": " + esc(l.body)) : "No messages yet"}</span><span class="c-meta" style="display:block;font-weight:700;margin-top:3px">${done} of ${c.members.length} done today</span></span>
          ${c.unread ? `<span class="c-badge static">${c.unread}</span>` : ""}</button>`; }).join("")
        : `<div class="card" style="text-align:center"><div class="lead" style="margin:0 0 6px">No circles yet</div><div class="note">Start one with your hostel floor, family or a friend who keeps you honest.</div><button class="btn" data-act="c:circleNew" style="margin-top:14px">Start or join a circle</button></div>`}
      </div>`;
  }
  function chatLayer(L) {
    const c = S.circles.find(x => x.id === L.id); if (!c) return `<div class="c-lhead"><button class="iconbtn" data-act="c:back">‹</button></div>`;
    const t = todayKey(), act = activeOn(t), dn = doneOn(t).length, nudged = L.nudged || new Set();
    const people = new Map(c.members.map(m => [m.user_id, m]));
    return `<div class="c-lhead" style="border-bottom:1px solid var(--bd);padding-bottom:12px"><button class="iconbtn" data-act="c:back">‹</button>
        <div style="flex:1;min-width:0"><b class="c-name c-ell" style="display:block">${esc(c.name)}</b><span class="c-meta">${c.members.length} members · private</span></div>
        <button class="c-btn" data-act="c:invite" data-id="${c.id}">Invite</button>
        <button class="c-dots" data-act="c:leaveCircle" data-id="${c.id}" aria-label="Leave">⋯</button></div>
      <div style="flex:none;padding:12px 0 8px"><div class="kicker" style="padding:0 20px 8px">Today</div><div class="c-hscroll scroll" style="padding:0 20px;gap:8px">
        ${c.members.map(m => { const mine = m.user_id === me(), done = mine ? act.length > 0 && dn >= act.length : m.done, nd = nudged.has(m.user_id);
          return `<div class="c-member${done ? " ok" : ""}">${av(m, 28)}<span>${mine ? "You" : first(m)}</span>${done ? `<i class="c-st ok">✓ Done</i>` : mine ? `<i class="c-st">${dn}/${act.length}</i>` : nd ? `<i class="c-st">Nudged</i>` : `<button class="c-st on" data-act="c:nudge" data-id="${m.user_id}">Nudge</button>`}</div>`; }).join("")}</div></div>
      <div class="scroll" id="c_msgs" style="flex:1;padding:10px 16px;display:flex;flex-direction:column;gap:8px">
        ${L.msgs == null ? `<div class="note">Loading…</div>` : L.msgs.map(m => {
          if (m.kind === "nudge") { const a = people.get(m.author), tg = people.get(m.target); return `<div class="c-sys">${m.author === me() ? "You" : first(a)} nudged ${m.target === me() ? "you" : first(tg)}</div>`; }
          const mine = m.author === me(), a = people.get(m.author);
          return `<div class="c-msg${mine ? " me" : ""}">${!mine ? `<b style="color:${color(a && a.handle)}">${first(a) || "Member"}</b>` : ""}${esc(m.body)}<i>${new Date(m.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}${m.held ? " · held" : ""}</i></div>`; }).join("")}
      </div>
      <div class="row" style="padding:10px 16px max(18px,env(safe-area-inset-bottom));gap:8px"><input class="c-input" id="c_msg" maxlength="1000" placeholder="Message the circle" style="flex:1" autocomplete="off"><button class="iconbtn" data-act="c:send" style="background:var(--grad);color:#12081c;border:0">${SVG.send}</button></div>`;
  }
  function userLayer(L) {
    const u = L.p; if (!u) return `<div class="c-lhead"><button class="iconbtn" data-act="c:back">‹</button></div><div class="note" style="padding:20px">Loading…</div>`;
    const f = L.follow, label = f === "accepted" ? "Following" : f === "pending" ? "Requested" : "Follow";
    return `<div class="c-lhead"><button class="iconbtn" data-act="c:back">‹</button><b class="c-name" style="flex:1">@${esc(u.handle)}</b>${u.user_id !== me() ? `<button class="c-dots" data-act="c:userMenu" data-id="${u.user_id}">⋯</button>` : ""}</div>
      <div class="scroll" style="flex:1;padding-bottom:40px"><div style="padding:6px 20px 16px;display:flex;flex-direction:column;gap:14px">
        <div class="row" style="gap:16px"><span class="c-ring big">${av(u, 82, "border:3px solid var(--bg)")}</span>
          <div class="c-counts">${[["posts", L.counts ? L.counts.posts : "–"], ["followers", L.counts ? L.counts.followers : "–"], ["following", L.counts ? L.counts.following : "–"]].map(([l, v]) => `<div><b>${typeof v === "number" ? fmtN(v) : v}</b><span>${l}</span></div>`).join("")}</div></div>
        <div><b class="c-name" style="font-size:16px">${esc(u.name || "")}</b>${u.bio ? `<div style="font-size:14px;margin-top:4px;white-space:pre-wrap">${esc(u.bio)}</div>` : ""}</div>
        ${u.user_id !== me() ? `<button class="btn ${f ? "ghost" : ""}" data-act="c:follow" data-id="${u.user_id}" style="padding:12px">${label}</button>` : ""}
      </div>
      ${L.posts == null ? `<div class="note" style="padding:20px">Loading…</div>` : L.hidden ? `<div class="card" style="margin:0 20px;text-align:center"><div style="font-size:28px">🔒</div><div class="lead" style="margin:8px 0 4px">This account is private</div><div class="note">Follow to see their posts and stories.</div></div>`
        : L.posts.length ? `<div style="display:flex;flex-direction:column;gap:12px;padding:0 12px">${L.posts.map(p => postCard(p)).join("")}</div>` : `<div class="note" style="text-align:center;padding:20px">No posts yet.</div>`}
      </div>`;
  }
  function storyLayer(L) {
    const g = S.stories[L.g], s = g && g.items[L.i]; if (!s) return "";
    const mine = g.a && g.a.user_id === me();
    return `<div class="c-storyv" style="background:${COVERS[s.bg] || COVERS.violet}">
      ${s.media_url ? (s.media_kind === "video" ? `<video class="c-media fill" src="${esc(s.media_url)}" autoplay playsinline muted loop></video>` : `<img class="c-media fill" src="${esc(s.media_url)}" alt="">`) : ""}
      <div class="c-bars">${g.items.map((_, j) => `<i><b style="${j < L.i ? "width:100%" : j === L.i ? `animation:cbar${L.tick % 2} 5s linear forwards` : "width:0"}"></b></i>`).join("")}</div>
      <div class="c-shead">${av(g.a, 34, "border:2px solid rgba(255,255,255,.7)")}<b>${mine ? "Your story" : esc((g.a && (g.a.name || g.a.handle)) || "")}</b><span>${ago(s.created_at)}</span>
        ${mine ? `<button data-act="c:delStory" data-id="${s.id}" style="margin-left:auto">🗑</button>` : `<button data-act="c:reportStory" data-id="${s.id}" style="margin-left:auto">⚑</button>`}<button data-act="c:back">✕</button></div>
      <button class="c-tap l" data-act="c:sprev" aria-label="Previous"></button><button class="c-tap r" data-act="c:snext" aria-label="Next"></button>
      ${s.body ? `<div class="c-stext">${esc(s.body)}</div>` : ""}
    </div>`;
  }

  // ---------------------------------------------------------------- actions
  function openSheet(name, data) { S.d = data || {}; ui.sheet = name; renderSheet(); }
  function closeSheet() { ui.sheet = null; renderSheet(); }
  function setLayer(L) {
    clearInterval(S.chatTimer); clearTimeout(S.storyTimer);
    S.layer = L; renderLayer();
    if (L && L.type === "chat") S.chatTimer = setInterval(() => loadChat(L.id, true), 5000);
    if (L && L.type === "story") S.storyTimer = setTimeout(() => act("c:snext", {}), 5000);
  }
  const back = () => setLayer(S.layer && S.layer.prev ? S.layer.prev : null);
  async function openCh(id) {
    const L = { type: "ch", id, scope: "all", prev: S.layer && S.layer.type !== "ch" ? S.layer : null }; setLayer(L);
    try {
      if (!S.chById[id] || !S.chById[id].h) { const { data } = await sb().from("challenges").select(`*,h:profiles!challenges_host_fkey(${PSEL}),challenge_members(count)`).eq("id", id).maybeSingle(); if (data) S.chById[id] = data; }
      await loadBoard(L);
    } catch (e) { err(e); }
  }
  async function loadBoard(L) {
    const [lb, w] = await Promise.all([
      sb().rpc("challenge_leaderboard", { cid: L.id, following_only: L.scope === "following" }),
      sb().from("checkins").select(`media_url,media_kind,user_id,p:profiles!checkins_user_id_fkey(${PSEL})`).eq("challenge_id", L.id).eq("day", todayKey()).order("created_at", { ascending: false }).limit(12)
    ]);
    if (lb.error) throw lb.error;
    L.lb = lb.data || []; L.wall = w.data || []; if (S.layer === L) renderLayer();
  }
  async function openUser(id) {
    if (!id) return;
    const L = { type: "user", id, prev: S.layer && S.layer.type !== "user" ? S.layer : null }; setLayer(L);
    try {
      const c = (t, f) => { let q = sb().from(t).select("*", { count: "exact", head: true }); for (const k in f) q = q.eq(k, f[k]); return q; };
      const [p, fo, fr, fg, ps] = await Promise.all([
        sb().from("profiles").select("*").eq("user_id", id).maybeSingle(),
        sb().from("follows").select("status").eq("follower", me()).eq("followee", id).maybeSingle(),
        c("follows", { followee: id, status: "accepted" }), c("follows", { follower: id, status: "accepted" }),
        sb().from("posts").select(POST_SEL).eq("author", id).order("created_at", { ascending: false }).limit(30)
      ]);
      if (!p.data) { toast("This profile isn't available"); back(); return; }
      L.p = p.data; L.follow = fo.data ? fo.data.status : null;
      L.posts = ps.data || []; L.hidden = p.data.is_private && L.follow !== "accepted" && id !== me();
      L.counts = { posts: L.hidden ? "–" : L.posts.length, followers: fr.count || 0, following: fg.count || 0 };
      await hydrate(L.posts);
      if (S.layer === L) renderLayer();
    } catch (e) { err(e); }
  }
  async function loadChat(id, quiet) {
    const L = S.layer; if (!L || L.type !== "chat" || L.id !== id) return;
    const { data, error } = await sb().from("circle_messages").select("*").eq("circle_id", id).order("id", { ascending: false }).limit(150);
    if (error) { if (!quiet) err(error); return; }
    const msgs = (data || []).reverse(), lastId = msgs.length ? msgs[msgs.length - 1].id : 0;
    const changed = !L.msgs || L.msgs.length !== msgs.length || (L.msgs.length && L.msgs[L.msgs.length - 1].id !== lastId);
    L.msgs = msgs; L.nudged = new Set(msgs.filter(m => m.kind === "nudge" && m.author === me() && m.day === todayKey()).map(m => m.target));
    const read = readLS("btbu_c_read", {}); read[id] = lastId; localStorage.setItem("btbu_c_read", JSON.stringify(read));
    const c = S.circles.find(x => x.id === id); if (c) c.unread = 0;
    if (changed) { const box = document.getElementById("c_msgs"); L.stick = !box || box.scrollHeight - box.scrollTop - box.clientHeight < 80; renderLayer(); }
  }
  async function toggleFollow(id) {
    const L = S.layer, state = L && L.type === "user" && L.id === id ? L.follow : (S.following.has(id) ? "accepted" : null);
    try {
      if (state) { await sb().from("follows").delete().eq("follower", me()).eq("followee", id); S.following.delete(id); if (L && L.id === id) { L.follow = null; if (L.counts && state === "accepted") L.counts.followers--; } toast(state === "pending" ? "Request cancelled" : "Unfollowed"); }
      else {
        const { data, error } = await sb().from("follows").insert({ follower: me(), followee: id }).select("status").single(); if (error) throw error;
        if (data.status === "accepted") S.following.add(id);
        if (L && L.id === id) { L.follow = data.status; if (L.counts && data.status === "accepted") L.counts.followers++; if (data.status === "accepted") openUser(id); }
        toast(data.status === "pending" ? "Request sent" : "Following");
      }
      S.counts = null; S.feedAt = 0; redraw();
    } catch (e) { err(e); }
  }
  async function busy(fn) { S.d.busy = true; renderSheet(); renderLayer(); try { await fn(); } catch (e) { err(e); } S.d.busy = false; if (ui.sheet) renderSheet(); renderLayer(); }
  const findPost = id => { for (const it of S.feed) if (it.p.id === id) return it.p; const L = S.layer; if (L && L.posts) { const p = L.posts.find(x => x.id === id); if (p) return p; } if (L && L.post && L.post.id === id) return L.post; return null; };
  const bumpCount = (p, k, d) => { if (p && p[k] && p[k][0]) p[k][0].count = Math.max(0, p[k][0].count + d); };
  async function report(kind, id, reason) {
    const { error } = await sb().from("reports").insert({ reporter: me(), target_kind: kind, target_id: String(id), reason });
    if (error) throw error; toast("Reported. A person will review it within 24 hours");
  }

  async function act(a, d, el, e) {
    if (e && el && el.closest("[data-act]") !== el) return;
    const id = d.id;
    try {
      switch (a) {
        case "c:retry": S.loadErr = null; S.meLoaded = false; render(); break;
        case "c:tab": S.tab = d.v; render(); break;
        case "c:cat": S.cat = d.v; render(); break;
        case "c:goch": ui.screen = "community"; S.tab = "challenges"; render(); break;
        case "c:join": openSheet("c:join", { vis: "public", adult: false }); break;
        case "c:vis": S.d.vis = d.v; renderSheet(); break;
        case "c:adult": S.d.adult = !S.d.adult; renderSheet(); break;
        case "c:saveProfile": {
          const h = BTBU_SYNC.sanitizeUsername(S.d.handle != null ? S.d.handle : db.prefs.handle || ""), nm = (S.d.name != null ? S.d.name : db.prefs.name || "").trim();
          if (h.length < 3) { toast("Handles need at least 3 letters or numbers"); return; }
          await busy(async () => {
            const { data, error } = await sb().from("profiles").upsert({ user_id: me(), handle: h, name: nm, is_private: S.d.vis === "private", adult_confirmed: true }).select().single();
            if (error) throw error.code === "23505" ? new Error("That handle is taken") : error;
            S.me = data; db.prefs.handle = h; if (nm) db.prefs.name = nm; save();
            if (db.prefs.photo && db.prefs.photo.startsWith("data:")) fetch(db.prefs.photo).then(r => r.blob()).then(b => window.BTBU_COMMUNITY.setAvatar(b)).catch(() => {});
            BTBU_SYNC.claimUsername(h).catch(() => {});
            closeSheet(); toast("You're in. Welcome to the community"); refresh(true);
          });
          break; }
        case "c:create": openSheet("c:create", { mode: "post" }); break;
        case "c:createStory": openSheet("c:create", { mode: "story", sticker: true }); break;
        case "c:mode": S.d.mode = d.v; S.d.media = null; renderSheet(); break;
        case "c:bg": S.d.bg = d.v; renderSheet(); break;
        case "c:sticker": S.d.sticker = S.d.sticker === false; renderSheet(); break;
        case "c:card": S.d.card = !S.d.card; renderSheet(); break;
        case "c:rmMedia": S.d.media = null; renderSheet(); break;
        case "c:post": {
          const body = (S.d.body || "").trim();
          if (bad(body)) toast("Heads up: this contains a filtered word and will be held for review");
          await busy(async () => {
            const m = S.d.media ? await upload(S.d.media) : null;
            const { error } = await sb().from("posts").insert({ author: me(), body, media_url: m && m.url, media_kind: m && m.kind, card_n: S.d.card ? streak() : null });
            if (error) throw error;
            closeSheet(); ui.screen = "community"; S.tab = "feed"; S.counts = null; toast("Posted"); refresh(true);
          });
          break; }
        case "c:postStory": {
          const text = (S.d.text || "").trim() || (S.d.media ? "" : "Day " + streak());
          await busy(async () => {
            const m = S.d.media ? await upload(S.d.media) : null;
            const body = S.d.sticker !== false ? (text ? text + " · " : "") + "🔥 " + streak() + "-day streak" : text;
            const { error } = await sb().from("stories").insert({ author: me(), body: body.slice(0, 120), bg: S.d.bg || "violet", media_url: m && m.url, media_kind: m && m.kind });
            if (error) throw error;
            closeSheet(); toast("Added to your story"); await loadStories(); render();
          });
          break; }
        case "c:like": {
          const p = findPost(id), on = S.likes.has(id);
          if (on) { S.likes.delete(id); bumpCount(p, "likes", -1); } else { S.likes.add(id); bumpCount(p, "likes", 1); }
          redraw();
          const r = on ? await sb().from("likes").delete().eq("post_id", id).eq("user_id", me()) : await sb().from("likes").insert({ post_id: id, user_id: me() });
          if (r.error && r.error.code !== "23505") throw r.error;
          break; }
        case "c:dbl": if (e && e.detail === 2 && !S.likes.has(id)) act("c:like", d); break;
        case "c:comments": {
          const p = findPost(id); openSheet("c:comments", { pid: id, postAuthor: p && p.author, comments: null });
          const { data, error } = await sb().from("comments").select(`id,author,body,held,created_at,a:profiles!comments_author_fkey(${PSEL})`).eq("post_id", id).order("created_at").limit(200);
          if (error) throw error; if (S.d.pid === id) { S.d.comments = data || []; renderSheet(); }
          break; }
        case "c:addComment": {
          const v = ((document.getElementById("c_comment") || {}).value || "").trim(); if (!v) return;
          if (bad(v)) toast("Heads up: this contains a filtered word and will be held for review");
          const { data, error } = await sb().from("comments").insert({ post_id: S.d.pid, author: me(), body: v }).select(`id,author,body,held,created_at,a:profiles!comments_author_fkey(${PSEL})`).single();
          if (error) throw error; S.d.comments = (S.d.comments || []).concat(data); S.d.draft = ""; bumpCount(findPost(S.d.pid), "comments", 1); renderSheet(); render(); renderLayer();
          const i = document.getElementById("c_comment"); if (i) i.focus();
          break; }
        case "c:delComment": await sb().from("comments").delete().eq("id", id); S.d.comments = S.d.comments.filter(c => c.id !== id); bumpCount(findPost(S.d.pid), "comments", -1); renderSheet(); render(); break;
        case "c:reportComment": await report("comment", id, "Reported from comments"); break;
        case "c:repost": openSheet("c:repost", { post: findPost(id) }); break;
        case "c:startQuote": S.d.quote = true; renderSheet(); break;
        case "c:plainRepost": {
          const p = S.d.post, on = S.reposts.has(p.id);
          const r = on ? await sb().from("reposts").delete().eq("post_id", p.id).eq("user_id", me()) : await sb().from("reposts").insert({ post_id: p.id, user_id: me() });
          if (r.error && r.error.code !== "23505") throw r.error;
          on ? S.reposts.delete(p.id) : S.reposts.add(p.id); bumpCount(p, "reposts", on ? -1 : 1);
          closeSheet(); redraw(); toast(on ? "Repost removed" : "Reposted to your followers"); break; }
        case "c:postQuote": {
          const v = (S.d.qtext || "").trim(); if (!v) { toast("Add your take first"); return; }
          await busy(async () => {
            const p = S.d.post; const { error } = await sb().from("posts").insert({ author: me(), body: v, quote_of: p.id }); if (error) throw error;
            closeSheet(); S.counts = null; toast("Quote posted"); refresh(true);
          });
          break; }
        case "c:share": {
          const url = location.origin + location.pathname + "#post=" + id;
          if (navigator.share) { try { await navigator.share({ url, title: "BTBU" }); } catch (x) {} } else { await navigator.clipboard.writeText(url); toast("Link copied"); }
          break; }
        case "c:menu": openSheet("c:menu", { post: findPost(id) }); break;
        case "c:reportStart": S.d.report = true; renderSheet(); break;
        case "c:report": await report("post", S.d.post.id, d.v); S.feed = S.feed.filter(it => it.p.id !== S.d.post.id); closeSheet(); redraw(); break;
        case "c:delPost": if (!confirm("Delete this post?")) return; { const { error } = await sb().from("posts").delete().eq("id", id); if (error) throw error; }
          S.feed = S.feed.filter(it => it.p.id !== id); S.myPosts = S.myPosts.filter(p => p.id !== id); S.counts = null; closeSheet(); if (S.layer && S.layer.type === "post") back(); redraw(); toast("Post deleted"); break;
        case "c:block": case "c:blockUser": {
          const uid = a === "c:block" ? S.d.post.author : id;
          if (!confirm("Block this person? You won't see each other's posts, stories or challenges.")) return;
          const { error } = await sb().from("blocks").insert({ blocker: me(), blocked: uid }); if (error && error.code !== "23505") throw error;
          await sb().from("follows").delete().or(`and(follower.eq.${me()},followee.eq.${uid}),and(follower.eq.${uid},followee.eq.${me()})`);
          S.following.delete(uid); S.feed = S.feed.filter(it => it.p.author !== uid); closeSheet(); if (S.layer && S.layer.type === "user") back(); toast("Blocked"); refresh(true); break; }
        case "c:mute": { const uid = S.d.post.author; await sb().from("mutes").insert({ muter: me(), muted: uid }); S.muted.add(uid); S.feed = S.feed.filter(it => it.p.author !== uid); closeSheet(); redraw(); toast("Muted. They won't know"); break; }
        case "c:userMenu": { const L = S.layer; if (confirm(`Block @${L.p.handle}?`)) { act("c:blockUser", { id: L.p.user_id }); } else if (confirm(`Report @${L.p.handle}'s profile?`)) await report("profile", L.p.user_id, "Reported from profile"); break; }
        case "c:follow": await toggleFollow(id); break;
        case "c:user": openUser(id); break;
        case "c:openpost": { const L = { type: "post", prev: S.layer }; setLayer(L);
          const { data } = await sb().from("posts").select(POST_SEL).eq("id", id).maybeSingle(); if (data) { await hydrate([data]); L.post = data; } renderLayer(); break; }
        case "c:back": back(); break;
        // challenges
        case "c:ch": openCh(id); break;
        case "c:joinch": {
          const { error } = await sb().from("challenge_members").insert({ challenge_id: id, user_id: me() }); if (error && error.code !== "23505") throw error;
          S.mine.add(id); bumpCount(S.chById[id], "challenge_members", 1); const c = S.chById[id];
          toast(c && live(c) ? "You're in. Check in today to start your run" : "You're in. " + (c ? chStatus(c) : ""));
          redraw(); if (S.layer && S.layer.type === "ch") loadBoard(S.layer); break; }
        case "c:leaveCh": if (!confirm("Leave this challenge? Your check-ins stay on the wall.")) return;
          await sb().from("challenge_members").delete().eq("challenge_id", id).eq("user_id", me()); S.mine.delete(id); bumpCount(S.chById[id], "challenge_members", -1); redraw(); toast("Left the challenge"); break;
        case "c:delCh": if (!confirm("Delete this challenge for everyone?")) return;
          { const { error } = await sb().from("challenges").delete().eq("id", id); if (error) throw error; } S.challenges = S.challenges.filter(c => c.id !== id); S.mine.delete(id); back(); redraw(); toast("Challenge deleted"); break;
        case "c:reportCh": await report("challenge", id, "Reported from challenge page"); break;
        case "c:shareCh": { const c = S.chById[id], url = location.origin + location.pathname + "#ch=" + id, text = `Join me: ${c ? c.title : "a challenge"} on BTBU`;
          if (navigator.share) { try { await navigator.share({ url, title: text, text }); } catch (x) {} } else { await navigator.clipboard.writeText(url); toast("Invite link copied"); } break; }
        case "c:lbScope": S.layer.scope = d.v; S.layer.lb = null; renderLayer(); await loadBoard(S.layer); break;
        case "c:proof": openSheet("c:proof", { cid: id, toFeed: true }); break;
        case "c:toFeed": S.d.toFeed = S.d.toFeed === false; renderSheet(); break;
        case "c:postProof": {
          const c = S.chById[S.d.cid]; if (!S.d.media || !c) return;
          const cap = (S.d.caption || "").trim();
          await busy(async () => {
            const m = await upload(S.d.media);
            const { error } = await sb().from("checkins").insert({ challenge_id: c.id, user_id: me(), day: todayKey(), media_url: m.url, media_kind: m.kind, caption: cap });
            if (error) throw error.code === "23505" ? new Error("You've already checked in today") : error;
            if (S.d.toFeed !== false) await sb().from("posts").insert({ author: me(), body: cap || `Day ${chDay(c)} of ${c.title} ✓`, media_url: m.url, media_kind: m.kind, challenge_id: c.id });
            S.checkedToday.add(c.id); S.myCheckins[c.id] = (S.myCheckins[c.id] || 0) + 1; S.counts = null;
            closeSheet(); toast(`Day ${chDay(c)} checked in`); if (S.layer && S.layer.type === "ch") loadBoard(S.layer); refresh(true);
          });
          break; }
        case "c:host": closeSheet(); setLayer({ type: "host", step: 0, h: { title: "", habit: "", category: "Fitness", cover: "violet", days: 21, starts_on: startOptions()[0].k, agree: false }, prev: null }); break;
        case "c:hcat": S.layer.h.category = d.v; renderLayer(); break;
        case "c:hcov": S.layer.h.cover = d.v; renderLayer(); break;
        case "c:hdays": S.layer.h.days = +d.v; renderLayer(); break;
        case "c:hstart": S.layer.h.starts_on = d.v; renderLayer(); break;
        case "c:hagree": S.layer.h.agree = !S.layer.h.agree; renderLayer(); break;
        case "c:hback": S.layer.step--; renderLayer(); break;
        case "c:hnext": {
          const L = S.layer; if (L.step < 2) { L.step++; renderLayer(); return; }
          L.busy = true; renderLayer();
          try {
            const h = L.h; const { data, error } = await sb().from("challenges").insert({ host: me(), title: h.title.trim(), habit: h.habit.trim(), category: h.category, cover: h.cover, days: h.days, starts_on: h.starts_on }).select().single();
            if (error) throw error;
            S.mine.add(data.id); S.chById[data.id] = { ...data, h: S.me, challenge_members: [{ count: 1 }] }; S.challenges.unshift(S.chById[data.id]);
            ui.screen = "community"; S.tab = "challenges"; render(); setLayer(null); openCh(data.id); toast(data.held ? "Saved, but held for review because of a filtered word" : "Published. Share the link to fill it up");
          } catch (x) { L.busy = false; renderLayer(); throw x; }
          break; }
        // circles
        case "c:inbox": setLayer({ type: "inbox" }); loadCircles().then(renderLayer).catch(err); break;
        case "c:circleNew": openSheet("c:circleNew", {}); break;
        case "c:createCircle": {
          const v = ((document.getElementById("c_cname") || {}).value || "").trim(); if (v.length < 2) { toast("Give it a name"); return; }
          const { data, error } = await sb().from("circles").insert({ name: v, owner: me() }).select().single(); if (error) throw error;
          closeSheet(); await loadCircles(); setLayer({ type: "chat", id: data.id, prev: { type: "inbox" } }); loadChat(data.id);
          toast("Circle created. Tap Invite to add people"); break; }
        case "c:joinCircle": {
          const v = ((document.getElementById("c_code") || {}).value || "").trim(); if (!v) return;
          const { data, error } = await sb().rpc("join_circle", { code: v }); if (error) throw error;
          closeSheet(); await loadCircles(); setLayer({ type: "chat", id: data, prev: { type: "inbox" } }); loadChat(data); toast("Joined the circle"); break; }
        case "c:chat": setLayer({ type: "chat", id, prev: { type: "inbox" } }); loadChat(id); break;
        case "c:invite": {
          const c = S.circles.find(x => x.id === id); if (!c) return;
          const text = `Join my circle "${c.name}" on BTBU. Open the app → Community → Circles → + and enter code ${c.invite_code}`;
          if (navigator.share) { try { await navigator.share({ title: "BTBU circle", text, url: location.origin + location.pathname }); } catch (x) {} } else { await navigator.clipboard.writeText(text); toast("Invite copied · code " + c.invite_code); }
          break; }
        case "c:leaveCircle": if (!confirm("Leave this circle?")) return;
          await sb().from("circle_members").delete().eq("circle_id", id).eq("user_id", me()); await loadCircles(); setLayer({ type: "inbox" }); toast("Left the circle"); break;
        case "c:send": {
          const i = document.getElementById("c_msg"), v = (i && i.value || "").trim(); if (!v) return;
          if (bad(v)) toast("Heads up: this contains a filtered word and will be held for review");
          i.value = ""; const { error } = await sb().from("circle_messages").insert({ circle_id: S.layer.id, author: me(), body: v }); if (error) throw error;
          S.layer.stick = true; await loadChat(S.layer.id); const n2 = document.getElementById("c_msg"); if (n2) n2.focus(); break; }
        case "c:nudge": {
          const L = S.layer; const { error } = await sb().from("circle_messages").insert({ circle_id: L.id, author: me(), kind: "nudge", target: id });
          if (error) { if (error.code === "23505") { toast("Already nudged today"); return; } throw error; }
          L.nudged = new Set([...(L.nudged || []), id]); await loadChat(L.id); toast("Nudged. They'll see it next time they open BTBU"); break; }
        case "c:approve": await sb().from("follows").update({ status: "accepted" }).eq("follower", id).eq("followee", me()); S.requests = S.requests.filter(r => r.follower !== id); S.counts = null; renderLayer(); toast("Approved"); break;
        case "c:decline": await sb().from("follows").delete().eq("follower", id).eq("followee", me()); S.requests = S.requests.filter(r => r.follower !== id); renderLayer(); break;
        // stories
        case "c:story": setLayer({ type: "story", g: +d.i, i: 0, tick: 0 }); markSeen(); break;
        case "c:snext": case "c:sprev": {
          const L = S.layer; if (!L || L.type !== "story") return; const g = S.stories[L.g];
          if (a === "c:snext") { if (L.i + 1 < g.items.length) L.i++; else if (L.g + 1 < S.stories.length) { L.g++; L.i = 0; } else { setLayer(null); render(); return; } }
          else { if (L.i > 0) L.i--; else if (L.g > 0) { L.g--; L.i = 0; } }
          L.tick++; setLayer(L); markSeen(); break; }
        case "c:delStory": await sb().from("stories").delete().eq("id", id); setLayer(null); await loadStories(); render(); toast("Story deleted"); break;
        case "c:reportStory": await report("story", id, "Reported from stories"); break;
        case "c:privacy": {
          if (!S.me) { act("c:join", {}); return; }
          const v = !S.me.is_private; const { data, error } = await sb().from("profiles").update({ is_private: v }).eq("user_id", me()).select().single(); if (error) throw error;
          S.me = data; render(); renderSheet(); toast(v ? "Private: you approve new followers" : "Public: anyone can follow you"); break; }
      }
    } catch (x) { err(x); }
  }
  function markSeen() {
    const L = S.layer, s = L && S.stories[L.g] && S.stories[L.g].items[L.i]; if (!s) return;
    S.seen.add(s.id); localStorage.setItem("btbu_c_seen", JSON.stringify([...S.seen].slice(-300)));
  }

  // ---------------------------------------------------------------- inputs
  document.addEventListener("input", e => {
    const id = e.target.id, v = e.target.value;
    if (id === "c_handle") { const s = v.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase(); if (s !== v) e.target.value = s; S.d.handle = s; }
    if (id === "c_name") S.d.name = v;
    if (id === "c_body") { S.d.body = v; const b = document.querySelector('[data-act="c:post"]'); if (b) b.disabled = !(v.trim() || S.d.media || S.d.card); }
    if (id === "c_text") S.d.text = v;
    if (id === "c_quote") S.d.qtext = v;
    if (id === "c_caption") S.d.caption = v;
    if (id === "c_comment") S.d.draft = v;
    if (id === "c_h_title") { S.layer.h.title = v; const b = document.querySelector('[data-act="c:hnext"]'); if (b) b.disabled = v.trim().length < 3; }
    if (id === "c_h_habit") S.layer.h.habit = v;
  });
  document.addEventListener("change", async e => {
    if (e.target.id === "c_file" && e.target.files[0]) { try { S.d.media = await checkFile(e.target.files[0]); renderSheet(); } catch (x) { err(x); } }
    if (e.target.id === "c_bio" && S.me) { const v = e.target.value.slice(0, 160); const { data, error } = await sb().from("profiles").update({ bio: v }).eq("user_id", me()).select().single(); if (error) err(error); else { S.me = data; toast("Bio saved"); } }
  });
  document.addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    if (e.target.id === "c_msg") act("c:send", {});
    if (e.target.id === "c_comment") act("c:addComment", {});
  });

  // ---------------------------------------------------------------- day status for circles
  let dayT;
  function publishDay(done) {
    if (!online() || !S.me) return;
    clearTimeout(dayT);
    dayT = setTimeout(() => { sb().from("day_status").upsert({ user_id: me(), day: todayKey(), done }).then(r => { if (r.error) console.warn(r.error); }); }, 2000);
  }

  // Deep links: #ch=<id> and #post=<id>
  function deepLink() {
    const m = location.hash.match(/^#(ch|post)=([0-9a-f-]{36})$/); if (!m || !online()) return;
    history.replaceState(null, "", location.pathname + location.search);
    ui.screen = "community"; render();
    if (m[1] === "ch") openCh(m[2]); else act("c:openpost", { id: m[2] });
  }

  window.BTBU_COMMUNITY = {
    view, sheet, act, renderLayer, publishDay, profileHeader, profileGrid, profileChallenges,
    onEnter() { refresh(false); deepLink(); },
    onAuth() { S.meLoaded = false; S.me = null; S.counts = null; S.loadErr = null; if (online()) { loadMe().then(() => { render(); deepLink(); if (S.me) refresh(true); }).catch(e => { S.meLoaded = true; S.loadErr = (e && e.message) || "Couldn't reach the server"; render(); }); } },
    me: () => S.me, online, closeLayer: () => setLayer(null), hasLayer: () => !!S.layer,
    async setAvatar(blob) {
      if (!online() || !S.me || !blob) return;
      try {
        const m = await upload({ file: new File([blob], "avatar.jpg", { type: "image/jpeg" }), kind: "photo" });
        const { data, error } = await sb().from("profiles").update({ avatar_url: m.url }).eq("user_id", me()).select().single();
        if (error) throw error; S.me = data; redraw();
      } catch (e) { err(e); }
    }
  };
})();
