# Circles Commons

Circles Commons is a hybrid Circles mini-app for funding local projects through a Circles Organization treasury. Contributors send CRC to a shared treasury, project milestones update from on-chain payments, and the admin can pay funds out to the people doing the work.

## Why it uses Circles

The app uses Circles primitives directly:

- A Circles Organization acts as the project treasury.
- Contributions are real CRC transfers into that treasury.
- Contributor approval creates an on-chain trust relation from the Organization to a human Circles account.
- In the Circles host, the wallet address is injected by `@aboutcircles/miniapp-sdk`.
- Embedded contributions use `TransferBuilder` and open the host-controlled Gnosis App approval flow.
- Embedded project payments bundle Organization trust and CRC transfer when trust is missing.
- Standalone contributions open a Gnosis App CRC checkout with a unique reference and QR fallback.
- The UI reads `CrcV2_TransferData` events from the Circles RPC.
- Project progress, activity, and headline metrics are recalculated from on-chain events.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Environment

Copy `.env.example` to `.env.local` and configure the Organization treasury address:

```text
NEXT_PUBLIC_DEFAULT_RECIPIENT_ADDRESS=0x...
NEXT_PUBLIC_DEFAULT_ADMIN_ADDRESS=0x...
```

The Supabase variables are optional locally. Without them, project definitions remain bundled with the app and contributor requests use browser `localStorage`.

For a public multi-user deployment, create a Supabase project, run `supabase/schema.sql`, and add:

```text
NEXT_PUBLIC_SUPABASE_URL=https://...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
```

`NEXT_PUBLIC_DEFAULT_RECIPIENT_ADDRESS` is the Organization treasury. `NEXT_PUBLIC_DEFAULT_ADMIN_ADDRESS` is the wallet allowed to manage it in the UI; if omitted, the treasury address is treated as the admin. In the current MVP, treasury payouts require the admin wallet to be the treasury transaction sender.

Contributions and financial totals never come from Supabase. They are derived from the Circles RPC.

## Verify

```bash
npm run lint
npm run build
```

## Current Scope

The hybrid MVP supports Organization treasury selection, Organization creation, admin-created funded projects, contributor requests, on-chain approvals, CRC checkout, QR codes, payment monitoring, historical payment recovery, RPC-backed activity, RPC-backed metrics, and admin treasury payouts.

Inside the Circles host, a contributor's address is injected automatically, and CRC payments use the host approval flow. On the standalone website, contributors can open the project in the Circles Playground or use Gnosis App fallback links.

Organization creation, contributor approvals, and treasury payouts currently remain standalone administration flows using Rabby or MetaMask on Gnosis Chain.
