# BTBU — Be The Best You · v26

> **निग्रह · Nigrah** — the quiet strength of self-control. BTBU is a small daily practice of it.

A habit tracker that runs in your browser and installs as an app. Sign in with Google, and your habits sync end-to-end-encrypted across your devices. No build step: plain HTML, CSS and JS.

> **Current release:** v26 — five-tab redesign (Home · Today · Days · Stats · You), Gen-Z and Millennial themes in light and dark, first-launch setup, streak freezes, shareable streak card, data export, and the server side for daily reminders.

## What's new in v26
- **Five tabs, no repeated info.** Home is the dashboard (streak, momentum, freezes, month so far, the one habit that needs attention). Today is the only place you check things off. Days is the calendar. Stats holds trends and per-habit history. You holds your profile and account.
- **Two looks, each light or dark.** Gen-Z (loud, colourful, big numbers) and Millennial (v21 Quiet Mode with per-habit colour). Picked on first launch and changeable in Settings. Both sync.
- **First launch** (after Google sign-in): name + look → first habits (skipped if you already have some) → reminder time.
- **Per-habit colour and emoji**, matched from the habit's name.
- **Streak freezes:** 2 a month. If you miss a day, Home offers a one-tap save. Freezes sync.
- **Share card:** a 1080×1920 image of your streak and last 35 days. Uses the phone's share sheet, or downloads a PNG where sharing isn't supported.
- **Export my data** is back (JSON), for people who want their own copy.
- **Reminders:** the server function is included but switched off until deployed (see below).
- **Retired:** the Lock Past Days dev toggle, the 4-up stat grid, and the week strip. Their information now lives on Home, Today and Days.

## Sync compatibility
v26 reads and writes the same storage keys as v25, so existing data and existing cloud records carry over untouched. Three new settings sync alongside the v25 ones: `look`, `reminder` and `freezes`. `sync.js` gains those three entries in `SETTING_KEYS`; nothing else in it changed. No database migration is needed for sync.

## Files
| File | What it is |
|---|---|
| `index.html` | Page shell (sign-in gate, screens, sheets) |
| `styles.css` | Both looks × light/dark |
| `app.js` | App logic |
| `sync.js` | Supabase auth + AES-GCM end-to-end-encrypted sync (v25, plus 3 setting keys) |
| `config.js.template` | Copy to `config.js` and fill in your Supabase URL + anon key (gitignored) |
| `sw.js`, `manifest.json`, `icon-*.png` | Offline support, install-as-app, push notifications |
| `docs/` | Sync design (ADR-0001), Google OAuth setup, database schemas |
| `supabase/` | Reminder server function + its table |

## Run it locally
`npx serve .` (or `python3 -m http.server`) in this folder, then open the printed address. Without a `config.js` the app skips sign-in and runs local-only.

## Turning on reminders
Until you finish these steps, the app saves each person's reminder time but sends nothing.

1. **Create the table:** Supabase → SQL Editor → run `supabase/migrations/v26_push_subscriptions.sql`.
2. **Generate push keys:** `npx web-push generate-vapid-keys`.
3. **Deploy the function** with the Supabase CLI:
   ```
   supabase login
   supabase link --project-ref <your-project-ref>
   supabase secrets set VAPID_PUBLIC_KEY=<public> VAPID_PRIVATE_KEY=<private> VAPID_SUBJECT=mailto:<your-email> CRON_SECRET=<any-long-random-string>
   supabase functions deploy reminders --no-verify-jwt
   ```
4. **Run it every 15 minutes:** Supabase → Integrations → Cron → new job → HTTP POST
   `https://<project-ref>.supabase.co/functions/v1/reminders?run=1` with header `x-cron-secret: <CRON_SECRET>`.
5. **Switch it on:** at the top of `app.js`, set
   `const PUSH_CONFIG = { enabled: true, vapidPublicKey: "<public>", subscribeUrl: "https://<project-ref>.supabase.co/functions/v1/reminders" };`
6. Bump `CACHE` in `sw.js` so installed copies update.

On iPhone, notifications only work once BTBU is added to the Home Screen (iOS 16.4+).

## Roadmap
Community posts, milestone rewards, hosted habit challenges, Apple / Meta / Snapchat sign-in, wearable integrations, E2EE recovery passphrase.
