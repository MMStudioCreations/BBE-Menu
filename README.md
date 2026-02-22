# BBE Menu

Cloudflare Pages static site for the Bobby Black Exclusive menu.

## Environment variables (Cloudflare Pages)

Set these in **Pages → Settings → Environment variables** for preview/production:

- `RESEND_API_KEY` (Secret)
- `MAIL_TO` (e.g. `budtender@bobbyblacknyc.com`)
- `MAIL_FROM` (e.g. `budtender@bobbyblacknyc.com` or `Bobby Black <budtender@bobbyblacknyc.com>`)

## Email features

- **Suggestions form** lives on the main page (`index.html`) in the **Suggestions** section near the footer.
  - Frontend sends `POST /api/suggestions`.
  - Pages Function `functions/api/suggestions.ts` validates and emails the submission via Resend.

- **Cart/Checkout order email** lives on `cart.html`.
  - Checkout form collects customer name/phone/email and special instructions.
  - On place order, frontend sends `POST /api/order` with customer details + itemized cart + totals.
  - Pages Function `functions/api/order.ts` validates, generates an `ORD-YYYYMMDD-XXXX` id, and emails the order via Resend.

## Local development

Run with Wrangler Pages dev (example):

```bash
npx wrangler pages dev .
```

## D1 migrations

Apply migrations with Wrangler:

```bash
wrangler d1 migrations apply <db_name> --local
wrangler d1 migrations apply <db_name> --remote
```

If migrations tooling is not configured yet, execute the SQL file directly instead:

```bash
wrangler d1 execute <db_name> --local --file=./migrations/0001_rewards.sql
wrangler d1 execute <db_name> --remote --file=./migrations/0001_rewards.sql
```

## Endpoint test examples (curl)

### Suggestions endpoint

```bash
curl -i -X POST http://localhost:8788/api/suggestions \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Jane Doe",
    "email": "jane@example.com",
    "phone": "+1 555 123 4567",
    "message": "Love the menu, please add a sugar-free option."
  }'
```

### Order endpoint

```bash
curl -i -X POST http://localhost:8788/api/order \
  -H 'Content-Type: application/json' \
  -d '{
    "customer": {
      "name": "Jane Doe",
      "email": "jane@example.com",
      "phone": "+1 555 123 4567"
    },
    "order": {
      "items": [
        {
          "id": "frosted-peaches",
          "name": "Frosted Peaches",
          "qty": 2,
          "price": 45,
          "variant": "3.5g",
          "notes": null
        }
      ],
      "subtotal": 90,
      "tax": null,
      "fees": null,
      "total": 90,
      "method": "unknown",
      "address": null,
      "specialInstructions": "Please text on arrival"
    }
  }'
```

## Admin dashboard + super admin management

### Run latest migrations

This release adds migration `migrations/0010_admin_dashboard_super_admin.sql` to guarantee `admin_users`/`sessions` schema compatibility for admin sessions and dashboard features.

```bash
wrangler d1 migrations apply <db_name> --local
wrangler d1 migrations apply <db_name> --remote
```

### Bootstrap first super admin

Set these environment variables in Cloudflare Pages:

- `ADMIN_BOOTSTRAP_SECRET`
- `OWNER_EMAIL` (optional fallback)
- `OWNER_NAME` (optional fallback)
- `OWNER_PASSWORD` (optional fallback)

Then call:

```bash
curl -X POST /api/admin/bootstrap \
  -H 'content-type: application/json' \
  -d '{"secret":"<ADMIN_BOOTSTRAP_SECRET>","email":"owner@example.com","name":"Owner","password":"strong-password"}'
```

You can also continue using `/api/admin/auth/bootstrap-create` for compatibility.

### Manage admin users (super admin only)

- `GET /api/admin/users` list admins.
- `POST /api/admin/users` create admin (`email`, `name`, `password`).
- `POST /api/admin/users/:id/toggle-active` deactivate/reactivate.
- `POST /api/admin/users/:id/toggle-super` promote/demote super admin.
- `DELETE /api/admin/users/:id` hard delete (blocked for self and last super admin).

### Dashboard metrics definitions

`GET /api/admin/dashboard` returns metrics where revenue and lifetime spend logic are based on order status:

- `revenue_completed_cents`: **completed orders only**.
- `pending_cents`: pending/placed orders.
- `cancelled_cents`: cancelled orders.
- `aov_completed_cents`: completed revenue ÷ completed order count.
- `top_customers`: ranked by **completed-only** lifetime spend plus points balance.

This ensures cancelled orders are excluded from completed revenue/lifetime spend reporting.


## Admin Workspace v2 migration
Run migrations normally (no extra manual steps). The new `migrations/0011_admin_workspace_v2.sql` adds role-aware admin users, saved views, daily metrics, and supporting indexes.
