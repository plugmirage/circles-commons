# Circles Commons

Circles Commons is a Circles mini-app for funding useful local projects with CRC.

Creators open the app in the Circles Playground/Gnosis App, create a funded project, and set a CRC goal. Contributors fund the project with CRC. Funds are held in an on-chain escrow contract, and the project creator can withdraw only after the goal is reached or the 14-day funding window ends.

Live app: https://circles-commons.vercel.app

## Garage Week 3 Winner

Circles Commons placed first in Circles Garage Week 3 with a judge score of
100/100 and received the $250 first-place CRC prize. The winning production
snapshot is preserved by the Git tag `garage-week-3-winner`.

The strongest judging signal was the app's deeper integration of Circles core
features rather than treating CRC as a generic payment token. See
[`docs/WEEK-3-WINNING-SNAPSHOT.md`](docs/WEEK-3-WINNING-SNAPSHOT.md) for the
frozen feature set and the principles to preserve in future iterations.

## Pitch

Circles should become useful in daily life, not just exist as a token balance. Circles Commons turns CRC into a simple local crowdfunding tool: neighbors can fund repairs, shared tools, events, mutual-aid actions, or any concrete project that needs small contributions.

The app is designed around a non-crypto user flow:

- open the project
- contribute CRC in Gnosis App
- watch the progress update from on-chain events
- stop contributions when the target is reached
- let the creator withdraw and publish a short update

## How It Uses Circles

- Users connect through the Circles mini-app host / Gnosis App wallet.
- Project creation is signed by the creator wallet.
- Contributions are real CRC ERC1155 transfers through the Circles Hub.
- The escrow contract receives and tracks CRC per funded project.
- Project progress and activity are derived from escrow events on Gnosis Chain.
- Creator names are resolved from Circles profiles when available.
- Standalone visitors are directed to the Circles Playground for wallet actions.
- Invite links open the app inside the Circles Playground with a lightweight `ref` parameter.

## Current Flow

1. Open Circles Commons in the Circles Playground.
2. Connect with Gnosis App.
3. Create a funded project with title, description, location, goal, and milestones.
4. Contributors fund the project with CRC.
5. Once the goal is reached, contribution buttons disappear.
6. The creator opens `Manage my project` and withdraws escrowed CRC.
7. A creator update is shown on the completed project card.
8. Users can copy an invite link that opens Circles Commons inside the Playground.

## Referrals And Activity

Circles Commons includes a lightweight referral path for the Garage criteria:

- `Invite to Circles Commons` copies a Playground-wrapped URL.
- Project cards can copy project-specific invite links.
- Invite URLs include `ref` and optionally `project`.
- When a wallet opens the embedded mini-app with a `ref`, the app records a best-effort referral visit in Supabase.

Wallet actions should be tested in the Circles Playground so the Circles host can count mini-app activity.

## Tech Stack

- Next.js
- Tailwind CSS
- `@aboutcircles/miniapp-sdk`
- Circles SDK packages
- Gnosis Chain
- Solidity escrow contract
- Supabase for public project metadata

## Contracts

Escrow contract:

```text
0x16117dd001A9f57347768365fFc0c90084eaa7E5
```

Circles Hub v2 on Gnosis Chain:

```text
0xc12C1E50ABB450d6205Ea2C3Fa861b3B834d13e8
```

## Run Locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Environment

Copy `.env.example` to `.env.local` and configure:

```text
NEXT_PUBLIC_CIRCLES_RPC_URL=https://rpc.aboutcircles.com/
NEXT_PUBLIC_ESCROW_ADDRESS=0x...
NEXT_PUBLIC_SUPABASE_URL=https://...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
```

For shared project persistence, create a Supabase project and run:

```text
supabase/schema.sql
```

## Verify

```bash
npm run lint
npm run build
```

## Submission Summary

Circles Commons is a working mini-app that makes CRC useful for local funding. It uses Circles primitives directly: Gnosis App wallet identity, CRC transfers through the Circles Hub, ERC1155 escrow custody, on-chain event tracking, and creator withdrawals once funding conditions are met.
