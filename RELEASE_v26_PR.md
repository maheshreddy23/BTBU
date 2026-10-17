## v26 — five-tab redesign

### What changes for users
- **Home** is a dashboard: streak (tap to share), 14-day momentum, freezes, month so far, and the one habit needing attention.
- **Today** is the only place to check habits off.
- **Days / Stats / You** replace Calendar / Reports / Profile, and nothing is shown twice.
- Pick **Gen-Z** or **Millennial**, light or dark, on first launch.
- **Streak freezes** (2/month), **shareable streak card**, **Export my data**.

### Sync safety
- Uses the v25 storage keys unchanged, so no data migration is needed.
- `sync.js` only adds three settings to `SETTING_KEYS`: `look`, `reminder`, `freezes`.

### Not switched on yet
- Reminders need the Supabase function deployed. Steps are in the README under "Turning on reminders".

### Test before merging
- [ ] Sign in on a device that already has v25 data: habits, streak and handle all intact
- [ ] Onboarding shows look → reminder (habits step skipped)
- [ ] Check off a habit; it appears on a second signed-in device within about a minute
- [ ] Switch look and mode in Settings; the change syncs
- [ ] Use a freeze on a missed day; the streak holds and Days shows ❄
- [ ] Share card opens the share sheet on a phone and downloads on desktop
