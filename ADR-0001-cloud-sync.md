# ADR-0001: Cloud sync for BTBU

**Status:** Proposed
**Date:** 2026-04-27
**Deciders:** Mahesh (project owner)

## Context

BTBU is a single-file PWA hosted on GitHub Pages. Every byte of user data
lives in `localStorage` under the `btbu_v2_*` keys (see README → "Data
model"). That model is the app's defining strength — no accounts, no
servers, no privacy story to write — and it is also the headline feature
gap on the roadmap. Current pain points:

1. **Single-device only.** A user who installs BTBU on their phone cannot
   see their streak from their laptop. Manual JSON export/import works
   but is a bad fit for a daily habit tracker.
2. **No backup.** Clearing site data, browser uninstall, or a lost device
   wipes the entire history. The v18 normalized model is small (kilobytes
   even after years of use) — losing it is an emotional, not technical,
   problem.
3. **Hosting constraint.** GitHub Pages is static-only. Any sync solution
   must talk to a third-party SaaS or a small standalone server we
   operate elsewhere. There is no "just add a `/api` route".

The data shape we need to sync is small and well-defined:

| Key | Cardinality | Sync semantics |
|---|---|---|
| `btbu_v2_habits` | ~10s of rows | Append-mostly; soft-delete via `archived_at` |
| `btbu_v2_completions` | ~365 keys/yr × small arrays | Sparse map — appends and per-day edits |
| `btbu_display_name`, `btbu_theme`, `btbu_lock_past`, `btbu_best_streak` | scalar | Last-write-wins is fine |

Total long-term volume per user is well under 1 MB even after a decade.

## Decision

Adopt an **opt-in, end-to-end-encrypted, Supabase-backed sync** with
last-writer-wins per record (per-habit, per-day-key) using a logical
clock (Lamport timestamp) for ordering. Auth is via **email magic link**
(passwordless). Sync is incremental and triggered on app boot, on tab
focus, and ~every 60 s while the tab is foregrounded.

This keeps the "no accounts" feel as a default (sync is opt-in), gives a
real recovery story, and avoids running our own infra.

## Options Considered

### Option A: Supabase (Postgres + Row-Level Security + magic-link auth)

| Dimension | Assessment |
|-----------|------------|
| Complexity | Med — RLS policies, two tables, one Edge Function for the magic link |
| Cost | Free tier covers thousands of users at this data size |
| Scalability | Comfortable up to 100k+ users without leaving free/cheap tier |
| Team familiarity | Mahesh has not used Supabase yet, but its JS SDK is small |
| Vendor lock-in | Low — it is Postgres underneath, exportable any time |

**Pros**

- Real auth (magic-link or OAuth) without writing a backend.
- Postgres + RLS gives strong per-user isolation as a single declarative
  policy.
- Realtime channel built in, so we can drop in live multi-device sync
  later without another vendor.
- Self-hostable if Supabase ever raises prices or shuts down.

**Cons**

- New dependency on a SaaS the user has to sign up for (free, but still).
- Edge Functions are needed if we want to keep the magic-link "from"
  address branded.
- Encryption at rest is provider-managed; for client-side E2EE we still
  do that ourselves (see "End-to-end encryption" below).

### Option B: Firebase (Firestore + Firebase Auth)

| Dimension | Assessment |
|-----------|------------|
| Complexity | Low — drop-in SDK, well-documented |
| Cost | Free tier is generous; reads scale linearly with sync frequency |
| Scalability | Effectively unlimited |
| Team familiarity | Common, lots of tutorials |
| Vendor lock-in | High — Firestore is proprietary and not Postgres-compatible |

**Pros**

- The fastest path to a working v1.
- Realtime out of the box.
- Auth providers (Google, Apple) are one config flag.

**Cons**

- Lock-in: Firestore data shape and security rules are not portable.
- Per-document read pricing makes "poll every 60 s" surprisingly
  expensive at scale.
- Google account dependency feels heavy for an app whose pitch is "no
  accounts".
- The SDK is large (tens of KB), which matters for a PWA whose whole app
  is currently ~85 KB.

### Option C: remoteStorage / "bring your own backend"

| Dimension | Assessment |
|-----------|------------|
| Complexity | Med-high — protocol works but ecosystem is thin |
| Cost | Free if user provides their own server |
| Scalability | Per-user; no central infra |
| Team familiarity | Niche |
| Vendor lock-in | None |

**Pros**

- Maximally aligned with BTBU's "your data, your device" ethos — the
  user picks the storage provider (5apps, self-hosted, etc.).
- Zero ongoing cost for us.

**Cons**

- Asks every user to think about server choice — high friction.
- Library is unmaintained-ish; we'd be carrying it ourselves.
- Magic-link / OAuth flows still need building separately.
- The market for users who want this is genuinely small.

### Option D: Custom backend (Cloudflare Workers + D1)

| Dimension | Assessment |
|-----------|------------|
| Complexity | High — we write auth, storage, sync API, deployment |
| Cost | Low (Workers free tier) |
| Scalability | Excellent |
| Team familiarity | Requires writing and maintaining a real service |
| Vendor lock-in | Low (Workers + SQLite) |

**Pros**

- Full control over sync semantics and data shape.
- Cheapest at scale.
- No third-party dashboard for user data.

**Cons**

- Most expensive in *time*. We become responsible for auth, schema
  migrations, abuse prevention, monitoring, and uptime — the exact
  things BTBU has been deliberately free of.
- Disproportionate to a habit tracker.

### Option E: iCloud / Google Drive App Folder (per-platform)

| Dimension | Assessment |
|-----------|------------|
| Complexity | High — different SDK per platform, web is the worst-supported |
| Cost | Free (uses user's existing cloud) |
| Scalability | Per-user |
| Team familiarity | Each SDK is a separate learning curve |
| Vendor lock-in | High per-platform |

**Pros**

- Uses storage the user already has and trusts.
- No new account.

**Cons**

- Web access to iCloud Drive is severely limited; this kills the PWA
  story on iOS.
- Each platform needs its own integration; we maintain three.
- Doesn't solve "I use Chrome on Windows and Safari on iOS".

## Trade-off analysis

The fundamental trade-off is **how much infra we want to own**:

- Owning none (Option C/E) preserves the ethos but pushes friction onto
  the user — for a habit tracker that should "just work", this is a
  losing trade.
- Owning everything (Option D) preserves control but is wildly out of
  scope for a hobby PWA.
- Owning a thin layer on a managed backend (A or B) is the right band.

Between **A (Supabase)** and **B (Firebase)**, the deciding factors are:

1. **Lock-in.** Supabase = Postgres = exportable. Firebase = Firestore =
   not. For an app that has, on purpose, always made its data
   portable (JSON export since v19), Postgres is the philosophical
   match.
2. **Bundle size.** Supabase JS is ~30 KB gzipped; Firebase is ~80–200
   KB depending on how aggressively you tree-shake. BTBU's whole shipped
   bundle today is ~85 KB. Firebase doubles or triples it.
3. **"No accounts" marketing.** Magic-link with no Google requirement
   sits closer to the existing tone than "Sign in with Google".

Recommend **Option A**.

### End-to-end encryption

Independent of the backend choice, we should encrypt user data
client-side before it touches any server. The flow:

1. On first sync, derive a 256-bit AES-GCM key from the user's
   email + a high-iteration PBKDF2 (or, better, Argon2id via WASM).
2. Store the derived key in IndexedDB (not localStorage — it survives
   service worker restarts and is unreachable from cross-origin script).
3. Each row in the sync table holds an `encrypted_payload` blob and a
   plaintext `updated_at` (Lamport) clock. Server sees only ciphertext +
   a per-user UUID.
4. Restoring on a new device requires the magic-link login *and*
   re-deriving the key from the email. (We could optionally let the
   user store a recovery phrase.)

This makes BTBU's privacy story stronger than "we trust the SaaS",
which is worth carrying through.

### Sync semantics

The data shape (sparse completion map keyed by date, append-mostly habit
defs) maps cleanly to **per-record last-writer-wins** with a Lamport
clock:

- Each row has `id`, `updated_at` (Lamport), `encrypted_payload`,
  `tombstone` (bool).
- On sync, both sides exchange `(id, updated_at)` pairs and pull rows
  where the remote `updated_at` is greater.
- Conflicts on the same record are resolved by clock; on equal clocks,
  by `id` lexicographically (deterministic tie-break).

This is *not* a CRDT — two devices that edit the same habit text on the
same logical tick will lose one of the edits. For a single-user app
synced between a phone and a laptop, that is a non-issue 99.9% of the
time. We can revisit if we ever add multi-user shared habits.

## Consequences

**What becomes easier**

- Multi-device use, which is the whole point.
- Recovery from device loss.
- A clean data backup story without manually exporting JSON.
- Future: shared habits with a partner, social streaks, etc.

**What becomes harder**

- Onboarding gains an optional step ("turn on sync"). We must keep this
  truly optional — the local-only flow stays the default.
- We now have a third-party dependency (Supabase) and an account on
  *somewhere* that holds (encrypted) user data.
- Schema migrations across the wire — once a v23 device and a v22
  device are both reading from sync, format compatibility is no longer
  optional.

**What we'll need to revisit**

- E2EE key recovery: forgetting the email/passphrase = unrecoverable
  data. The local copy still exists, so the worst case is "you can't
  restore on a fresh device". Acceptable for v1; revisit if users ask.
- Free tier limits if BTBU ever takes off.
- A switch to CRDTs (Yjs / Automerge) if we add collaborative habits.

## Action items

1. [ ] Stand up a Supabase project in personal account; capture URL +
       anon key into `config.js` (gitignored override of a checked-in
       template).
2. [ ] Create `users`, `sync_state`, and `sync_records` tables with RLS
       policies that key everything to `auth.uid()`.
3. [ ] Wire `@supabase/supabase-js` (CDN, no bundler) — this is the
       only new runtime dependency.
4. [ ] Add a "Sync" card to the Profile screen: off by default, with
       a "Connect" button that triggers magic-link auth.
5. [ ] Implement client-side AES-GCM encryption for payloads; key
       derivation via PBKDF2 (Web Crypto, no WASM for v1).
6. [ ] Implement Lamport clock + push/pull sync loop. Trigger on boot,
       focus, and 60 s timer.
7. [ ] Add a "Disconnect sync" action that wipes the IDB-stored key
       and remote rows (the local copy survives).
8. [ ] Update README's "Roadmap" and "Data model" sections; add a
       short privacy note on what the server sees (only ciphertext +
       UUIDs).
9. [ ] Smoke test: laptop ↔ phone round-trip, including a conflict.

## Out of scope for this ADR

- Realtime push updates (v2; the 60 s poll is fine for habit-tracker
  cadence).
- Sharing habits between users.
- Server-side analytics or telemetry — we are not adding any.
- A native app — sync runs in the same PWA.
