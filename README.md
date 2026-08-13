# Commitments

A workload-aware deadline tracker. Built with React, Vite, and Supabase.

## Development

```bash
npm install
npm run dev
```

Create a `.env.local` file (see `.env.example`) with your Supabase URL, anon key, and (for push) VAPID public key.

## Stack

- **Frontend:** React 18 + Vite
- **Backend / Auth / DB:** Supabase (PostgreSQL + RLS)
- **Deployment:** Vercel (recommended)
- **Push:** Declarative Web Push (Safari / docked Mac apps) + service-worker fallback

## Project structure

```
src/
  lib/
    supabase.js      # Supabase client singleton
    db.js            # All database queries + ICS export
    push.js          # Web Push subscribe / test helpers
  hooks/
    useAppData.js    # Central state hook (loads, mutates, undo/redo)
  components/
    Shell.jsx        # Top-level layout, tabs, toolbar, notification menu
  styles/
    shell.css
  App.jsx            # Auth gate → Shell
  main.jsx
  index.css          # CSS custom properties / global reset
public/
  sw.js              # Thin push fallback service worker
  manifest.webmanifest
  icons/             # PWA icons
supabase/
  functions/
    send-push/       # Authenticated test / manual push
    push-reminders/  # Hourly digest cron
    _shared/webPush.ts
```

## Push notifications (Declarative Web Push)

Docked Mac web apps (and Safari 18.4+) can show notifications from a standard JSON payload without running service-worker JavaScript. This app:

1. Subscribes via `window.pushManager` when available (classic SW `pushManager` otherwise)
2. Stores device endpoints in `push_subscriptions`
3. Sends [declarative payloads](https://webkit.org/blog/16535/meet-declarative-web-push/) (`web_push: 8030`)
4. Runs a daily digest of overdue / due-today / due-soon tasks at your chosen local hour

### 1. Generate VAPID keys

```bash
npx web-push generate-vapid-keys
```

- Put the **public** key in `.env.local` and Vercel as `VITE_VAPID_PUBLIC_KEY`
- Put **public + private** keys in Supabase Edge Function secrets (never ship the private key to the client)

A local copy of generated keys may live in `.vapid-keys.local` (gitignored).

### 2. Supabase secrets

```bash
supabase secrets set \
  VAPID_PUBLIC_KEY="..." \
  VAPID_PRIVATE_KEY="..." \
  VAPID_SUBJECT="mailto:you@example.com" \
  APP_URL="https://your-production-origin" \
  CRON_SECRET="a-long-random-string"
```

`CRON_SECRET` protects the `push-reminders` function when invoked by a scheduler.

### 3. Apply migration & deploy functions

```bash
supabase db push
# or run supabase/migrations/20260811000000_push_notifications.sql in the SQL editor

supabase functions deploy send-push
supabase functions deploy push-reminders
```

### 4. Schedule the digest job

In the Supabase Dashboard → **Edge Functions** → **Schedules** (or via `pg_cron` + `net.http_post`), run **hourly**:

```
POST https://<project-ref>.supabase.co/functions/v1/push-reminders
Authorization: Bearer <SERVICE_ROLE_KEY>
# or
x-cron-secret: <CRON_SECRET>
```

The job only sends when the user’s local hour matches `notify_digest_hour` (default 9) and they have not already received a digest that local calendar day.

### 5. Enable in the app

1. Deploy over **HTTPS** (required for Web Push; docked app on your production URL)
2. Open the user menu → **Enable notifications** → allow the system prompt
3. **Send test notification** to verify Mac delivery
4. Optionally set daily digest, lead time (0–3 days), and digest hour

### Manual digest test

```bash
curl -X POST "https://<project-ref>.supabase.co/functions/v1/push-reminders" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

## Notes

- Push requires a real browser permission and an HTTPS origin (production Vercel URL, not plain `localhost`, for Apple’s push service in many setups).
- Re-add the site to the Dock after shipping the web app manifest if you want the updated icon/name.
- Dead subscriptions (404/410 from the push service) are deleted automatically.
