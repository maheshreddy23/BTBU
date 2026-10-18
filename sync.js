// Copyright (c) 2026 Mahesh Reddy. All rights reserved. Proprietary — see LICENSE.
// ============================================================================
// BTBU sync — Supabase-backed, end-to-end-encrypted, opt-in.
// ============================================================================
//
// See docs/ADR-0001-cloud-sync.md for the design. In short:
//
//   * Auth is email magic-link via Supabase. The link redirects back to the
//     PWA, which finalizes the session on boot.
//   * Per-record Last-Writer-Wins using a Lamport clock.
//     - We model habit defs, daily completion lists, and a few settings as
//       independent records. Each has a string id and a clock value.
//     - On every local mutation we tick the clock and push the dirty rows.
//     - On every pull we apply remote rows whose clock > the local clock
//       we last saw for that record.
//   * AES-GCM-256 encryption of every payload before it leaves the client.
//     The key is derived from the user's email via PBKDF2 (Web Crypto). The
//     server only ever sees ciphertext + a record id + a clock + a tombstone
//     flag.
//
// This module installs a global `BTBU_SYNC` object with a small API:
//
//     BTBU_SYNC.init()                    // called on boot
//     BTBU_SYNC.connect(email)            // sends a magic link
//     BTBU_SYNC.disconnect()              // signs out + wipes the local key
//     BTBU_SYNC.syncNow()                 // pull + push
//     BTBU_SYNC.status()                  // { state, email, lastSyncAt }
//     BTBU_SYNC.onChange(cb)              // subscribe to status changes
//
// The module is defensive: if config.js is missing or its placeholders are
// still in place, every method becomes a no-op and `status().state` is
// `"unconfigured"`. The local-only flow always works.
// ============================================================================

(function(){

  // --------------------------------------------------------------------------
  // CONFIG GUARD
  // --------------------------------------------------------------------------

  const CFG = (window.BTBU_CONFIG && window.BTBU_CONFIG.supabase) || null;
  const CONFIGURED =
    !!CFG &&
    typeof CFG.url === "string" &&
    !CFG.url.includes("YOUR-PROJECT") &&
    typeof CFG.anonKey === "string" &&
    !CFG.anonKey.includes("YOUR-PUBLIC-ANON-KEY");

  // Even when not configured we still install the API so the rest of app.js
  // can call into it without `if`s scattered everywhere.
  const STATES = {
    UNCONFIGURED: "unconfigured",
    OFF:          "off",
    AWAITING:     "awaiting_link",
    CONNECTING:   "connecting",
    READY:        "ready",
    ERROR:        "error",
  };

  let _state      = CONFIGURED ? STATES.OFF : STATES.UNCONFIGURED;
  let _email      = null;
  let _fullName   = null;     // from auth provider's user_metadata.full_name
  let _avatarUrl  = null;     // from auth provider's user_metadata.avatar_url
  let _lastSyncAt = null;
  let _lastError  = null;
  let _client     = null;     // Supabase client
  let _userId     = null;
  let _aesKey     = null;     // CryptoKey (non-extractable when possible)
  let _pollTimer  = null;
  const _listeners = [];

  // --------------------------------------------------------------------------
  // LOCAL STATE — what we know about each synced record.
  // _seen[recordId] = { clock, hash }
  //   clock — the Lamport timestamp the remote (or our last push) was at
  //   hash  — sha-256 of the local serialized payload at last push, used to
  //           cheaply detect "this row is dirty and needs pushing"
  // --------------------------------------------------------------------------

  const SEEN_KEY  = "btbu_sync_seen";
  const CLOCK_KEY = "btbu_sync_clock";   // global Lamport clock
  const FLAG_KEY  = "btbu_sync_enabled"; // "true" once user has opted in

  function loadSeen(){
    try { return JSON.parse(localStorage.getItem(SEEN_KEY) || "{}"); }
    catch { return {}; }
  }
  function saveSeen(o){
    localStorage.setItem(SEEN_KEY, JSON.stringify(o));
  }
  function tickClock(){
    const n = (parseInt(localStorage.getItem(CLOCK_KEY) || "0", 10) || 0) + 1;
    localStorage.setItem(CLOCK_KEY, String(n));
    return n;
  }
  function observeRemoteClock(remote){
    // Lamport: local := max(local, remote) on receive.
    const cur = parseInt(localStorage.getItem(CLOCK_KEY) || "0", 10) || 0;
    if (remote > cur) localStorage.setItem(CLOCK_KEY, String(remote));
  }

  // --------------------------------------------------------------------------
  // RECORDS — convert v2 storage <→> a flat record map for sync.
  // --------------------------------------------------------------------------
  //
  // Record id forms:
  //    habit:<defId>             payload = the habit def object
  //    comp:<YYYY-MM-DD>         payload = sorted [habitId, ...]
  //    setting:display_name      payload = string
  //    setting:theme             payload = "light"|"dark"|"auto"
  //    setting:best_streak       payload = number
  //    setting:look|reminder|freezes   (v26) payload = string
  //
  // Tombstones are emitted for record ids we used to sync but no longer have
  // locally — e.g., a completion key whose array became empty and was deleted.

  const SETTING_KEYS = ["display_name", "theme", "best_streak", "username", "avatar_user", "look", "reminder", "freezes"];
  const SETTING_LS = {
    display_name: "btbu_display_name",
    theme:        "btbu_theme",
    best_streak:  "btbu_best_streak",
    username:     "btbu_username",
    avatar_user:  "btbu_avatar_user",  // data URL of user-uploaded avatar; overrides Google's
    look:         "btbu_look",         // v26: "genz" | "millennial"
    reminder:     "btbu_reminder",     // v26: "HH:MM"
    freezes:      "btbu_freezes",      // v26: JSON { "YYYY-MM-DD": "YYYY-MM" }
  };

  function snapshotLocal(){
    // Returns { recordId: payloadObject }, omitting empty/missing entries.
    const out = {};
    const defs  = JSON.parse(localStorage.getItem("btbu_v2_habits")      || "[]");
    const comps = JSON.parse(localStorage.getItem("btbu_v2_completions") || "{}");
    for (const d of defs) out[`habit:${d.id}`] = d;
    for (const k of Object.keys(comps)) {
      const arr = (comps[k] || []).slice().sort();
      if (arr.length > 0) out[`comp:${k}`] = arr;
    }
    for (const s of SETTING_KEYS) {
      const v = localStorage.getItem(SETTING_LS[s]);
      if (v !== null && v !== "") out[`setting:${s}`] = v;
    }
    return out;
  }

  function applyRemote(recordId, payload, isTombstone){
    // Mutate localStorage to reflect a remote record win.
    if (recordId.startsWith("habit:")) {
      const id = recordId.slice("habit:".length);
      const defs = JSON.parse(localStorage.getItem("btbu_v2_habits") || "[]");
      const idx = defs.findIndex(d => d.id === id);
      if (isTombstone) {
        if (idx !== -1) { defs.splice(idx, 1); }
      } else if (payload && typeof payload === "object") {
        if (idx === -1) defs.push(payload); else defs[idx] = payload;
      }
      localStorage.setItem("btbu_v2_habits", JSON.stringify(defs));
      return;
    }
    if (recordId.startsWith("comp:")) {
      const k = recordId.slice("comp:".length);
      const comps = JSON.parse(localStorage.getItem("btbu_v2_completions") || "{}");
      if (isTombstone || !Array.isArray(payload) || payload.length === 0) {
        delete comps[k];
      } else {
        comps[k] = payload.slice();
      }
      localStorage.setItem("btbu_v2_completions", JSON.stringify(comps));
      return;
    }
    if (recordId.startsWith("setting:")) {
      const s = recordId.slice("setting:".length);
      const lsKey = SETTING_LS[s];
      if (!lsKey) return;
      if (isTombstone || payload == null) localStorage.removeItem(lsKey);
      else localStorage.setItem(lsKey, String(payload));
      return;
    }
  }

  // --------------------------------------------------------------------------
  // CRYPTO — PBKDF2 key derivation + AES-GCM encrypt/decrypt.
  // --------------------------------------------------------------------------

  const CRYPTO_VERSION = 1;
  const PBKDF2_ITER    = 200_000;
  const KEY_DB_NAME    = "btbu_sync";
  const KEY_STORE      = "keys";
  const KEY_RECORD     = "user_key_v1";

  function utf8(s){ return new TextEncoder().encode(s); }
  function b64enc(buf){
    let s = "";
    const a = new Uint8Array(buf);
    for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
    return btoa(s);
  }
  function b64dec(str){
    const bin = atob(str);
    const a = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a.buffer;
  }
  async function sha256Hex(s){
    const buf = await crypto.subtle.digest("SHA-256", utf8(s));
    return Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, "0")).join("");
  }

  async function deriveAesKey(email){
    // Salt is deterministic per-email + a constant app pepper. Predictable
    // is OK here — the threat model is "Supabase admin sees plaintext", not
    // "attacker brute-forces from a public salt". The 200k PBKDF2 iterations
    // are what raise the cost of an offline attack on the email.
    const norm = String(email).trim().toLowerCase();
    const salt = await crypto.subtle.digest("SHA-256",
      utf8("btbu/v1/" + norm));
    const baseKey = await crypto.subtle.importKey(
      "raw", utf8(norm), { name: "PBKDF2" }, false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: PBKDF2_ITER, hash: "SHA-256" },
      baseKey,
      { name: "AES-GCM", length: 256 },
      // Non-extractable so even a script-injection attacker can't ship the
      // key off the device. We persist it in IndexedDB as a CryptoKey, which
      // structured-clones without ever exposing raw bytes.
      false,
      ["encrypt", "decrypt"],
    );
  }

  function idb(){
    return new Promise((res, rej) => {
      const r = indexedDB.open(KEY_DB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(KEY_STORE);
      r.onsuccess = () => res(r.result);
      r.onerror   = () => rej(r.error);
    });
  }
  async function idbPutKey(key){
    const db = await idb();
    return new Promise((res, rej) => {
      const tx = db.transaction(KEY_STORE, "readwrite");
      tx.objectStore(KEY_STORE).put(key, KEY_RECORD);
      tx.oncomplete = () => res();
      tx.onerror    = () => rej(tx.error);
    });
  }
  async function idbGetKey(){
    const db = await idb();
    return new Promise((res, rej) => {
      const tx = db.transaction(KEY_STORE, "readonly");
      const r = tx.objectStore(KEY_STORE).get(KEY_RECORD);
      r.onsuccess = () => res(r.result || null);
      r.onerror   = () => rej(r.error);
    });
  }
  async function idbDeleteKey(){
    const db = await idb();
    return new Promise((res, rej) => {
      const tx = db.transaction(KEY_STORE, "readwrite");
      tx.objectStore(KEY_STORE).delete(KEY_RECORD);
      tx.oncomplete = () => res();
      tx.onerror    = () => rej(tx.error);
    });
  }

  async function encryptPayload(obj){
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv }, _aesKey, utf8(JSON.stringify(obj)));
    return { v: CRYPTO_VERSION, iv: b64enc(iv), ct: b64enc(ct) };
  }
  async function decryptPayload(blob){
    if (!blob || blob.v !== CRYPTO_VERSION) throw new Error("bad payload");
    const iv = new Uint8Array(b64dec(blob.iv));
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv }, _aesKey, b64dec(blob.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }

  // --------------------------------------------------------------------------
  // SUPABASE LAZY LOADER — pulled from CDN; only when user opts in.
  // --------------------------------------------------------------------------

  let _sbModulePromise = null;
  function loadSupabase(){
    if (!CONFIGURED) return Promise.reject(new Error("not configured"));
    if (_sbModulePromise) return _sbModulePromise;
    _sbModulePromise = import(
      "https://esm.sh/@supabase/supabase-js@2"
    ).then(m => {
      _client = m.createClient(CFG.url, CFG.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true },
      });
      return _client;
    });
    return _sbModulePromise;
  }

  // --------------------------------------------------------------------------
  // STATE EVENTS
  // --------------------------------------------------------------------------

  function setState(next, err){
    _state = next;
    _lastError = err || null;
    for (const cb of _listeners) {
      try { cb(api.status()); } catch {}
    }
  }

  // --------------------------------------------------------------------------
  // SYNC LOOP — pull, then push.
  // --------------------------------------------------------------------------

  async function pullRemote(){
    const seen = loadSeen();
    const cur  = parseInt(localStorage.getItem(CLOCK_KEY) || "0", 10) || 0;
    const { data, error } = await _client
      .from("sync_records")
      .select("record_id, updated_at, tombstone, payload")
      .gt("updated_at", cur);
    if (error) throw error;
    if (!data) return 0;

    let applied = 0;
    for (const row of data) {
      const local = seen[row.record_id];
      if (local && row.updated_at <= local.clock) continue;
      let plain = null;
      if (!row.tombstone) {
        try { plain = await decryptPayload(row.payload); }
        catch (e) {
          // Skip rows we can't decrypt — usually means a different account
          // pushed them, or the email salt changed. Don't block the loop.
          continue;
        }
      }
      applyRemote(row.record_id, plain, !!row.tombstone);
      const hash = await sha256Hex(JSON.stringify(plain));
      seen[row.record_id] = { clock: row.updated_at, hash };
      observeRemoteClock(row.updated_at);
      applied++;
    }
    saveSeen(seen);
    return applied;
  }

  async function pushLocal(){
    const seen     = loadSeen();
    const snapshot = snapshotLocal();

    // Build the set of dirty record ids: any local id whose hash differs
    // from seen[id].hash, plus any seen id that no longer exists locally
    // (those become tombstones).
    const dirty = [];
    for (const id of Object.keys(snapshot)) {
      const hash = await sha256Hex(JSON.stringify(snapshot[id]));
      if (!seen[id] || seen[id].hash !== hash) {
        dirty.push({ id, payload: snapshot[id], tombstone: false, hash });
      }
    }
    for (const id of Object.keys(seen)) {
      if (!(id in snapshot)) {
        dirty.push({ id, payload: null, tombstone: true, hash: null });
      }
    }
    if (dirty.length === 0) return 0;

    const rows = [];
    for (const d of dirty) {
      const clock = tickClock();
      let payloadEnc = null;
      if (!d.tombstone) payloadEnc = await encryptPayload(d.payload);
      rows.push({
        user_id:    _userId,
        record_id:  d.id,
        updated_at: clock,
        tombstone:  d.tombstone,
        payload:    payloadEnc,
      });
      seen[d.id] = d.tombstone
        ? { clock, hash: null, tombstone: true }
        : { clock, hash: d.hash };
    }

    const { error } = await _client
      .from("sync_records")
      .upsert(rows, { onConflict: "user_id,record_id" });
    if (error) throw error;
    saveSeen(seen);
    return rows.length;
  }

  let _inFlight = false;
  async function syncNow(){
    if (_state !== STATES.READY) return;
    if (_inFlight) return;   // collapse concurrent timer + focus calls
    _inFlight = true;
    window.dispatchEvent(new CustomEvent("btbu-sync-start"));
    try {
      const got = await pullRemote();
      const sent = await pushLocal();
      _lastSyncAt = Date.now();
      setState(STATES.READY);
      if (got > 0 && typeof window.btbuRefresh === "function") {
        try { window.btbuRefresh(); } catch {}
      }
      return { got, sent };
    } catch (e) {
      console.warn("[sync] failed", e);
      setState(STATES.ERROR, e.message || String(e));
    } finally {
      _inFlight = false;
      window.dispatchEvent(new CustomEvent("btbu-sync-end"));
    }
  }

  function startPolling(){
    stopPolling();
    _pollTimer = setInterval(() => { syncNow(); }, 60_000);
    window.addEventListener("focus", _onFocus);
  }
  function stopPolling(){
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
    window.removeEventListener("focus", _onFocus);
  }
  function _onFocus(){ syncNow(); }

  // --------------------------------------------------------------------------
  // SESSION LIFECYCLE
  // --------------------------------------------------------------------------

  async function bootstrapFromSession(){
    // Called on init() if Supabase already has a session — either persisted
    // from a previous visit or just created by a fresh OAuth redirect (the
    // supabase-js SDK picks up the URL-hash tokens itself on first call).
    setState(STATES.CONNECTING);
    try {
      await loadSupabase();
      const { data: { session } } = await _client.auth.getSession();
      if (!session) { setState(STATES.OFF); return; }
      _userId    = session.user.id;
      _email     = session.user.email || null;
      const meta = session.user.user_metadata || {};
      // Google provides full_name; some providers use name. Fall back to the
      // email's local part so we always have *something* to display.
      _fullName  = meta.full_name || meta.name ||
                   (_email ? _email.split("@")[0] : null);
      _avatarUrl = meta.avatar_url || meta.picture || null;
      _aesKey    = await idbGetKey();
      if (!_aesKey) {
        if (!_email) { setState(STATES.OFF); return; }
        _aesKey = await deriveAesKey(_email);
        await idbPutKey(_aesKey);
      }
      // First-sign-in courtesy: if the user has no display name yet locally,
      // adopt the one from Google so the rest of the app uses it for free.
      if (_fullName) {
        const existing = localStorage.getItem("btbu_display_name");
        if (!existing) localStorage.setItem("btbu_display_name", _fullName);
      }
      // Username — we treat the public.usernames table as the source of truth.
      // 1. If this user already owns one server-side, mirror it locally.
      // 2. Otherwise auto-generate firstname_NNNN and try to claim it,
      //    retrying with new suffixes on PK collision (up to a handful of
      //    attempts). The user can always change it later from the Profile.
      try {
        const { data: mine } = await _client
          .from("usernames").select("username").eq("user_id", _userId).maybeSingle();
        if (mine && mine.username) {
          localStorage.setItem("btbu_username", mine.username);
        } else {
          const seed = sanitizeUsername(
            _fullName || (_email ? _email.split("@")[0] : "you")
          ).slice(0, 12) || "you";
          for (let i = 0; i < 6; i++) {
            const candidate = `${seed}_${Math.floor(1000 + Math.random() * 9000)}`;
            try {
              await claimUsername(candidate);
              break;  // success
            } catch (e) {
              if (!/already taken/i.test(e.message || "")) throw e;
              // else: collision, try a fresh suffix
            }
          }
        }
      } catch (e) {
        // Username table may not exist yet on a deploy that hasn't run the
        // v25 migration. Don't block sign-in for it; fall back to a local-
        // only handle so the UI has something to show.
        console.warn("[sync] username bootstrap skipped:", e.message || e);
        if (!localStorage.getItem("btbu_username")) {
          const seed = sanitizeUsername(
            _fullName || (_email ? _email.split("@")[0] : "you")
          ).slice(0, 12) || "you";
          localStorage.setItem("btbu_username",
            `${seed}_${Math.floor(1000 + Math.random() * 9000)}`);
        }
      }
      // Strip the OAuth tokens from the URL after we've consumed them, so a
      // page refresh doesn't keep `#access_token=...` in the location bar.
      if (window.location.hash.includes("access_token=")) {
        history.replaceState(null, "", window.location.pathname + window.location.search);
      }
      setState(STATES.READY);
      startPolling();
      syncNow();
    } catch (e) {
      console.warn("[sync] bootstrap failed", e);
      setState(STATES.ERROR, e.message || String(e));
    }
  }

  async function init(){
    if (!CONFIGURED) return;
    // We always try to bootstrap. Supabase JS persists sessions in localStorage
    // and consumes the URL hash on first getSession(); both paths flow through
    // bootstrapFromSession. Falls cleanly to STATES.OFF if no session exists.
    bootstrapFromSession();
  }

  // Sign in with Google via Supabase OAuth. Returns immediately because the
  // call navigates the page away to Google's consent screen; the browser
  // comes back to this same page (with tokens in the hash) when consent is
  // granted, at which point init() / bootstrapFromSession picks up the rest.
  async function signInWithGoogle(){
    if (!CONFIGURED) throw new Error("Sync is not configured for this deploy.");
    setState(STATES.CONNECTING);
    try {
      await loadSupabase();
      const { error } = await _client.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin + window.location.pathname,
        },
      });
      if (error) throw error;
      // Page is navigating away — no further state work is meaningful here.
    } catch (e) {
      setState(STATES.ERROR, e.message || String(e));
      throw e;
    }
  }

  // Magic-link flow kept as a back-up entry point. UI no longer surfaces it
  // by default, but external callers can still use it.
  async function connect(email){
    if (!CONFIGURED) throw new Error("Sync is not configured for this deploy.");
    if (!email || !/.+@.+\..+/.test(email)) throw new Error("Enter a valid email.");
    setState(STATES.CONNECTING);
    try {
      await loadSupabase();
      const { error } = await _client.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin + window.location.pathname },
      });
      if (error) throw error;
      localStorage.setItem(FLAG_KEY, "true");
      _email = email;
      _aesKey = await deriveAesKey(email);
      await idbPutKey(_aesKey);
      setState(STATES.AWAITING);
    } catch (e) {
      setState(STATES.ERROR, e.message || String(e));
      throw e;
    }
  }

  // --------------------------------------------------------------------------
  // USERNAMES — globally-unique handles backed by the public.usernames table.
  // --------------------------------------------------------------------------
  // The schema is in docs/supabase-schema-v25.sql. RLS is set up so any
  // authenticated user can SELECT (to check availability) but only the
  // owning user can INSERT/UPDATE their row. The username column is the
  // primary key, so global uniqueness comes for free.

  function sanitizeUsername(name){
    return String(name || "")
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "")
      .slice(0, 20);
  }

  async function isUsernameAvailable(name){
    if (_state !== STATES.READY) return { ok: false, reason: "not_ready" };
    const norm = sanitizeUsername(name);
    if (norm.length < 3) return { ok: false, reason: "too_short", norm };

    // Self-check first: if the name is already mine, treat as available.
    const { data: mine, error: mineErr } = await _client
      .from("usernames")
      .select("username")
      .eq("user_id", _userId)
      .maybeSingle();
    if (mineErr) throw mineErr;
    if (mine && mine.username === norm) {
      return { ok: true, reason: "mine", norm };
    }

    // Otherwise check whether anyone owns it.
    const { data, error } = await _client
      .from("usernames")
      .select("username")
      .eq("username", norm)
      .maybeSingle();
    if (error) throw error;
    return { ok: !data, reason: data ? "taken" : "free", norm };
  }

  async function claimUsername(name){
    if (_state !== STATES.READY) throw new Error("Not signed in");
    const norm = sanitizeUsername(name);
    if (norm.length < 3) throw new Error("Pick at least 3 letters or numbers");

    // user_id is UNIQUE, so an upsert keyed on it either inserts a new row
    // or updates this user's existing row in place. If `norm` is already
    // claimed by another user the username PRIMARY KEY rejects the write
    // with code 23505 (unique_violation), which we surface as "taken".
    const { error } = await _client
      .from("usernames")
      .upsert({ username: norm, user_id: _userId }, { onConflict: "user_id" });
    if (error) {
      if (error.code === "23505") throw new Error("That username is already taken");
      throw error;
    }
    localStorage.setItem("btbu_username", norm);
    return norm;
  }

  async function signOut(){
    stopPolling();
    try { if (_client) await _client.auth.signOut(); } catch {}
    try { await idbDeleteKey(); } catch {}
    localStorage.removeItem(FLAG_KEY);
    localStorage.removeItem(SEEN_KEY);
    localStorage.removeItem(CLOCK_KEY);
    _aesKey = null; _userId = null; _email = null;
    _fullName = null; _avatarUrl = null; _lastSyncAt = null;
    setState(CONFIGURED ? STATES.OFF : STATES.UNCONFIGURED);
  }
  // Backward-compat alias.
  const disconnect = signOut;

  // --------------------------------------------------------------------------
  // PUBLIC API
  // --------------------------------------------------------------------------

  const api = {
    STATES,
    init,
    signInWithGoogle,
    connect,           // legacy magic-link
    disconnect,        // alias for signOut
    signOut,
    syncNow,
    isUsernameAvailable,
    claimUsername,
    sanitizeUsername,
    status(){
      return {
        state:      _state,
        email:      _email,
        fullName:   _fullName,
        avatarUrl:  _avatarUrl,
        lastSyncAt: _lastSyncAt,
        error:      _lastError,
      };
    },
    isReady(){ return _state === STATES.READY; },
    // v27: community.js reuses the signed-in client. Habit sync is unaffected.
    client(){ return _state === STATES.READY ? _client : null; },
    userId(){ return _userId; },
    isStale(maxAgeMs){
      // True when we should refresh — used by pull-to-refresh.
      if (_state !== STATES.READY) return false;
      const ago = Date.now() - (_lastSyncAt || 0);
      return ago > (maxAgeMs || 30_000);
    },
    onChange(cb){
      _listeners.push(cb);
      return () => {
        const i = _listeners.indexOf(cb);
        if (i !== -1) _listeners.splice(i, 1);
      };
    },
  };

  window.BTBU_SYNC = api;
})();
