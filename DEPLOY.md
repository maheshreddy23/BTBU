# Deploying BTBU v27

About 15 minutes. You need the Supabase project that v26 already uses, and the GitHub repo `maheshreddy23/BTBU`.

## 1. Database (Supabase → SQL Editor)
Run these in order. Each one is safe to run again.
1. `docs/supabase-schema.sql`: habit sync. Skip it if v26 already works.
2. `docs/supabase-schema-v25.sql`: handles. Skip it if v26 already works.
3. **`supabase/migrations/v27_community.sql`**: new. It creates the community tables, the security rules and the `media` storage bucket.

Check: in Table Editor you should see `profiles`, `posts`, `challenges`, `circles` and so on, and in Storage a public bucket called `media`.

## 2. Auth redirect (Supabase → Authentication → URL Configuration)
- **Site URL:** `https://maheshreddy23.github.io/BTBU/`
- **Redirect URLs:** add `https://maheshreddy23.github.io/BTBU/` (it's probably there from v26).

## 3. Upload to GitHub
In `maheshreddy23/BTBU` on `main`, go to **Add file → Upload files** and drag in *everything inside this folder*, including `community.js`, `config.js` and the `supabase/` and `docs/` folders. Then commit.

`config.js` holds the anon key. That key is meant to be public (security comes from the database rules), and GitHub Pages can't run the app without the file. Never upload the `service_role` key.

## 4. GitHub Pages
Settings → Pages → Deploy from a branch → `main` / `(root)` → Save. The site goes live at `https://maheshreddy23.github.io/BTBU/` in about a minute.

## 5. First-run check
1. Open the site in a private window and sign in with Google.
2. Today: tick a habit, then switch to Calendar.
3. Community: tap **Get started**, pick a handle and choose Public, confirm 18+, then tap **Continue**.
4. Post with a photo, and check it appears in the feed and on You → Posts.
5. Challenges: host one starting tomorrow, then open it and copy the share link.
6. Circles (chat icon): start a circle, tap **Invite**, then join it from a second Google account using the code. Nudge each other.
7. From the second account: follow the first, like, comment, repost, quote, report a post, then block.

## Existing users
v26 data carries over untouched; the habit keys are the same. Installed copies update when the service worker sees the new `btbu-v27` cache. If someone still sees v26, closing and reopening the app (or a hard refresh) fixes it.

## Rolling back
Re-upload the v26 files (or revert the commit). The community tables can stay; v26 ignores them.
