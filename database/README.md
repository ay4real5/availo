# Database

Canonical schema lives in [`schema.sql`](./schema.sql). It is **idempotent** — safe to
run repeatedly. The backend uses it via the Supabase **service-role** key and falls back
to an in-memory dev store (`backend/dev-store.json`) when `SUPABASE_URL` is unset.

## Tables

| Table | Purpose |
|-------|---------|
| `users` | Accounts, target test date, auto-book flag, licence, tokenised card metadata |
| `user_preferences` | Per-user alert centre, notification channels, search window |
| `sessions` | Request sessions with bot/risk scoring |
| `scraper_jobs` | Each scraper run (status, proxy/IP/UA, slots found) |
| `available_slots` | Discovered slots per user (pending/approved/quarantined/booked) |
| `bookings` | Confirmed bookings attributed to a user |
| `bot_trap_visits` | Honeypot hits |
| `notification_queue` | Outbound notification records |
| `audit_log` | Immutable event trail (welcome/slot-alert/booking events) |

> Card data: only an opaque `payment_token` plus masked metadata
> (`card_brand`, `card_last4`, `card_exp`) are ever stored. Raw PAN/CVC are validated
> then discarded — see `backend/src/lib/payments.js`.

## Apply to Supabase (production)

1. Create a project at https://supabase.com and open **SQL Editor**.
2. Paste the contents of `schema.sql` and **Run**.
3. In **Project Settings → API**, copy the **Project URL** and the **service_role** key.
4. Set them in `backend/.env`:

   ```env
   SUPABASE_URL=https://<your-project>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
   ```

5. Restart the backend. On boot it logs `[supabase] using real Supabase client ...`
   (instead of `using dev store`).

## Apply via psql (self-hosted Postgres)

```bash
psql "$DATABASE_URL" -f database/schema.sql
```

## Switching back to the dev store

Leave `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` blank. The backend logs
`[supabase] using dev store <path>` and persists to `backend/dev-store.json`.

## Notes

- The service-role key **bypasses Row Level Security**, so RLS is left disabled by
  default (commented policies at the bottom of `schema.sql`). Enable it only if you
  expose tables to the anon/auth client directly.
- `updated_at` columns are maintained automatically by the `set_updated_at()` trigger.
- All timestamps are `TIMESTAMPTZ` (UTC) to match the ISO strings the app writes.
