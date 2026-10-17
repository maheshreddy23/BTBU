// BTBU runtime config — copy this file to `config.js` and fill in the
// values for your Supabase project. `config.js` is gitignored.
//
// If config.js is missing or its values are still placeholders, the
// app falls back to local-only mode and the Sync card on the Profile
// screen shows a "not configured" hint.
//
// Where to find these values:
//   1. Create a project at https://supabase.com (free tier is fine).
//   2. Run docs/supabase-schema.sql in the SQL editor.
//   3. Project Settings → API → copy the URL and the `anon` `public`
//      key into the placeholders below. The anon key is intended to be
//      embedded in client code — Row Level Security is what protects
//      user data, not key secrecy.
window.BTBU_CONFIG = {
  supabase: {
    url:     "https://slfzalqzzjlstyadcdst.supabase.co",
    anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNsZnphbHF6empsc3R5YWRjZHN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2NTU1NDMsImV4cCI6MjA5MzIzMTU0M30.q7VoE3C5zonvLriTU0n3l_ceOAy1qup0Ki4EkXt4MCo",
  },
};
