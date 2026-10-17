# Google OAuth setup for BTBU sign-in

BTBU v24 makes "Sign in with Google" the only way into the app. To make that
button actually work, you need to (a) create a Google OAuth client and (b)
hand its credentials to Supabase. One-time setup, ~10 minutes.

The end state is a flow like this:

1. User clicks **Sign in with Google** in BTBU.
2. Browser bounces to Google's consent screen.
3. Google bounces to your Supabase project's auth callback URL.
4. Supabase bounces back to BTBU with a session.
5. sync.js sees the session, derives the encryption key, syncs, done.

## Step 1 — Create a Google OAuth client

1. Open <https://console.cloud.google.com> and sign in with the Google
   account that should own this app's OAuth client.
2. **Create a new project** (top-bar project picker → **NEW PROJECT**).
   Call it something like `btbu-auth`. Wait for it to provision.
3. Open **APIs & Services → OAuth consent screen**.
   - **User Type**: *External* (so anyone with a Google account can sign in)
   - Fill the required fields: app name (`BTBU`), user support email (your
     email), developer contact email.
   - Skip optional fields — you don't need scopes beyond the defaults.
   - Save and continue. You can leave the app in *Testing* mode while
     you're prototyping; switch to *In Production* when you're ready to
     let arbitrary users sign in.
4. Open **APIs & Services → Credentials → + CREATE CREDENTIALS →
   OAuth client ID**.
   - **Application type**: *Web application*
   - **Name**: `BTBU web client`
   - **Authorized JavaScript origins**: add your BTBU URL — usually
     `http://localhost:8000` while testing, plus your production URL
     (e.g., `https://yourname.github.io`) when you deploy.
   - **Authorized redirect URIs**: add your Supabase callback URL. You
     can find the exact value in the next step — paste in
     `https://YOUR-PROJECT.supabase.co/auth/v1/callback`, replacing
     `YOUR-PROJECT` with your actual Supabase ref.
   - **Create**, then copy the **Client ID** and **Client Secret** that
     pop up. You'll paste them into Supabase next.

## Step 2 — Enable Google in Supabase

1. Open your Supabase project → **Authentication** → **Providers**.
2. Click **Google** in the list.
3. Toggle **Enable Sign in with Google** on.
4. Paste:
   - **Client ID (for OAuth)** — from Google Cloud, step 1.4.
   - **Client Secret (for OAuth)** — also from step 1.4.
5. The page shows the **Callback URL (for OAuth)** — confirm it matches
   what you added under "Authorized redirect URIs" in Google Cloud. If
   it doesn't, go back and fix the Google Cloud entry.
6. **Save**.

## Step 3 — Allow your app's URL to receive the redirect

Still in Supabase:

1. **Authentication → URL Configuration**.
2. **Site URL**: your app's origin, e.g. `http://localhost:8000` for local
   testing.
3. **Redirect URLs**: add the same value, plus any other origin you'll
   serve BTBU from (e.g., `https://yourname.github.io`). A wildcard suffix
   like `http://localhost:8000/**` is fine.
4. **Save**.

## Step 4 — Try it

1. Reload BTBU at your origin.
2. The auth gate should show with the **Sign in with Google** button.
3. Click it. You'll be redirected to Google's consent screen, then back
   to BTBU. The gate should slide out of the way and the home screen
   should appear.

## Common errors

**"Error 400: redirect_uri_mismatch"** — the URL Supabase is asking
Google to bounce back to doesn't match what you allowed in Google Cloud.
The exact URL is shown in the error page. Add it to *Authorized redirect
URIs* in Google Cloud → Credentials → your client.

**"Sign in with Google is disabled"** — the provider toggle in
Supabase isn't on, or Save wasn't clicked.

**Lands back on BTBU but the auth gate doesn't go away** — the Site URL
or Redirect URLs in Supabase don't include your app's origin. Add
exactly the URL you're loading BTBU from.

**Stuck on Google's "App is being verified" screen** — your app is in
*Testing* mode and your Google account isn't on the test-users list.
Either add yourself in **OAuth consent screen → Test users**, or push
the consent screen to *In Production*.
