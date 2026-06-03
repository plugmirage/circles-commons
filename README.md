# Circles Commons

Circles Commons is a hybrid Circles mini-app for local communities. Members can spend CRC on useful services and fund shared projects milestone by milestone.

## Why it uses Circles

The app uses Circles primitives directly:

- A Circles Organization can act as the community treasury.
- Existing Circles Groups can be activated in the Commons directory and used as real community contexts for services and projects.
- Membership approval creates an on-chain trust relation from the Organization to a human Circles account.
- In the Circles host, the wallet address is injected by `@aboutcircles/miniapp-sdk`.
- Members can publish services inside a community and receive CRC directly at their own Circles address.
- Embedded contributions use `TransferBuilder` and open the host-controlled Gnosis App approval flow.
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

Copy `.env.example` to `.env.local` and configure the community Organization address:

```text
NEXT_PUBLIC_DEFAULT_RECIPIENT_ADDRESS=0x...
NEXT_PUBLIC_DEFAULT_ADMIN_ADDRESS=0x...
```

The Supabase variables are optional locally. Without them, project definitions remain bundled with the app and membership requests use browser `localStorage`.

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

The hybrid MVP supports community selection, activation of existing Circles Groups, Organization creation, member-published services, admin-created Organization projects, membership requests, on-chain approvals, CRC checkout, QR codes, payment monitoring, historical payment recovery, RPC-backed activity, and RPC-backed metrics.

Inside the Circles host, a member's address is injected automatically. `Join` uses that address without manual input, and CRC payments use the host approval flow. On the standalone website, members can still use Gnosis App deep links or QR codes.

Organization creation and member approvals currently remain standalone administration flows using Rabby or MetaMask on Gnosis Chain. They are intentionally hidden inside the Circles host until the Organization control model is finalized.

Activated Groups are currently registry entries: they make Commons useful around real Circles Groups without pretending to verify Group ownership yet. Owner-gated Group administration is the next upgrade.
