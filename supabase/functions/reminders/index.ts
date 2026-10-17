// BTBU v26 — daily reminder edge function.
//   POST /reminders            { subscription, time: "HH:MM", tz }   → save/update a subscription
//   POST /reminders?run=1      (called every 15 min by a cron job)    → send due reminders
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:you@example.com), CRON_SECRET
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT")!, Deno.env.get("VAPID_PUBLIC_KEY")!, Deno.env.get("VAPID_PRIVATE_KEY")!);

const MESSAGES = [
  "Your habits are waiting — a minute now keeps the streak alive.",
  "Nigrah, one small act at a time. Check in for today.",
  "Today isn't closed yet. Show up for yourself.",
];

// Local "HH:MM" and "YYYY-MM-DD" for a time zone.
function localNow(tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return { hm: `${p.hour === "24" ? "00" : p.hour}:${p.minute}`, day: `${p.year}-${p.month}-${p.day}` };
}
const mins = (hm: string) => { const [h, m] = hm.split(":").map(Number); return h * 60 + m; };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const url = new URL(req.url);

  if (url.searchParams.get("run")) {
    if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) return json({ error: "forbidden" }, 403);
    const { data, error } = await db.from("push_subscriptions").select("*");
    if (error) return json({ error: error.message }, 500);
    let sent = 0, dropped = 0;
    for (const row of data ?? []) {
      const now = localNow(row.tz || "Asia/Kolkata");
      const diff = mins(now.hm) - mins(row.remind_at);
      if (diff < 0 || diff >= 15 || row.last_sent_on === now.day) continue;   // 15-min cron window, once a day
      try {
        await webpush.sendNotification(row.subscription, JSON.stringify({
          title: "BTBU", body: MESSAGES[Math.floor(Math.random() * MESSAGES.length)],
        }));
        await db.from("push_subscriptions").update({ last_sent_on: now.day }).eq("endpoint", row.endpoint);
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) { await db.from("push_subscriptions").delete().eq("endpoint", row.endpoint); dropped++; }
      }
    }
    return json({ sent, dropped });
  }

  const body = await req.json().catch(() => null);
  const sub = body?.subscription;
  if (!sub?.endpoint) return json({ error: "missing subscription" }, 400);
  const time = /^\d{2}:\d{2}$/.test(body.time) ? body.time : "20:00";
  const { error } = await db.from("push_subscriptions").upsert({
    endpoint: sub.endpoint, subscription: sub, remind_at: time, tz: body.tz || "Asia/Kolkata", updated_at: new Date().toISOString(),
  });
  return error ? json({ error: error.message }, 500) : json({ ok: true });
});
