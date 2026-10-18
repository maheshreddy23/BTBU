# BTBU — Be The Best You · v27

> **निग्रह · Nigrah**: the quiet strength of self-control. BTBU is a small daily practice of it, now with people to practise alongside.

A habit tracker and community that runs in the browser and installs as an app. Sign in with Google. Your habits sync with end-to-end encryption. Posts, challenges and circles run on Supabase with Row Level Security. There's no build step: it's plain HTML, CSS and JS.

## What's new in v27
- **Four tabs:** Home · Today · Community · You.
  - Today now has a Checklist / Calendar switch (the old Days tab).
  - You is a profile with Posts, Stats (the old Stats tab) and Challenges.
- **Community → Feed.** Posts with text, a photo, a video (up to 60 s and 25 MB) or a streak card.
  - Like, comment, repost, or quote with your own take.
  - Shows people you follow, plus suggested posts.
  - Stories last 24 hours.
- **Community → Challenges.** Anyone can host one, and joining is free and open.
  - Members check in daily with a photo or video.
  - Leaderboard shows everyone, or just people you follow.
  - Each challenge has a wall of today's check-ins, plus share links (`#ch=<id>`).
- **Circles.** Private groups of up to 12 people, joined by invite code.
  - Members can chat and see who closed their habits today.
  - Only circle members can nudge you, once a day each.
- **Profiles:** public or private (you approve followers), with handle, name, bio, photo, and post / follower / following counts.
- **Safety**
  - Report with reasons, block, mute, and "held for review" for anything containing a filtered word.
  - Community is 18+ for now: under-18s need verified parental consent under India's DPDP Act, which isn't built yet.

## Privacy model
- Habit names, completions and stats never leave the encrypted path (`sync_records`).
- The community only sees what you choose to post.
- It also gets one yes/no per day ("closed every habit today"), visible only to people who share a circle with you.
- Private profiles: posts and stories are visible to accepted followers only. Blocks hide both people from each other.

## Files
| File | What it is |
|---|---|
| `index.html` | Page shell |
| `styles.css` | Both looks × light/dark, plus community styles |
| `app.js` | Habits, tabs, onboarding, share card |
| `community.js` | Feed, stories, challenges, circles, profiles, moderation |
| `sync.js` | Google sign-in + end-to-end-encrypted habit sync (exposes the signed-in client to community.js) |
| `config.js` | Your Supabase URL + anon key (public by design) |
| `supabase/migrations/v27_community.sql` | All community tables, RLS, RPCs and the `media` storage bucket |
| `sw.js`, `manifest.json`, `icon-*.png` | Offline support, install-as-app, push |
| `docs/` | Sync design, Google OAuth setup, earlier schemas |

Deploy steps are in **DEPLOY.md**.

## Run it locally
`npx serve .` in this folder, then open the printed address and add that address to Supabase → Authentication → URL Configuration → Redirect URLs.

## Moderation (for you, the operator)
- **Reports:** Supabase → Table Editor → `reports`. Set `status` to `actioned` or `dismissed`.
- **Held content:** filter `posts`, `comments`, `circle_messages`, `checkins`, `stories` or `challenges` on `held = true`.
  - To approve, set `held` to false.
  - To remove, delete the row.
- **Filtered words:** add rows to `banned_words`. The app also checks a short list client-side to warn the person before they post.

## Roadmap
Push notifications for nudges and comments, under-18 accounts with verified parental consent, milestone rewards, Apple / Meta / Snapchat sign-in, wearables, E2EE recovery passphrase.
