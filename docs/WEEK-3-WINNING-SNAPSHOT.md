# Circles Garage Week 3 Winning Snapshot

## Result

- Date announced: June 8, 2026
- Placement: 1st
- Judge score: 100/100
- Prize: $250 paid in CRC
- Git commit: `be1fceb`
- Git tag: `garage-week-3-winner`
- Production URL: https://circles-commons.vercel.app

## Judge Signal

A judge specifically highlighted the deeper integration of Circles core
features. This is the main product principle to preserve: CRC must be part of
the application's mechanics, identity and activity model, not an interchangeable
payment option added to a conventional crowdfunding interface.

## Winning Circles Integrations

- Gnosis App wallet identity provided by the embedded mini-app host.
- Project creation signed by the connected Circles wallet.
- Real CRC ERC-1155 contributions transferred through the Circles Hub.
- Support for wrapped CRC by unwrapping it before escrow funding.
- On-chain escrow custody with goal- or deadline-based creator withdrawals.
- Project progress and activity reconstructed from Gnosis Chain events.
- Circles profile names used for creators and activity participants.
- Standalone visitors redirected into the Circles Playground for wallet actions.
- Playground invite links with lightweight referral attribution.

## Winning Product Flow

1. Open Circles Commons inside the Circles Playground.
2. Connect automatically with a Gnosis App wallet.
3. Create a funded project with a CRC target and milestones.
4. Fund projects with CRC through the embedded transaction flow.
5. Follow verifiable progress and activity from escrow events.
6. Close contributions when the target or deadline is reached.
7. Let the creator withdraw and publish a visible project update.

## Baseline For Future Cycles

Future releases should preserve this tagged version as the known-good baseline.
Changes should strengthen Circles-native utility, ship behind complete tests,
and avoid replacing a stable production flow immediately before a judging
snapshot.

Planned work after this snapshot includes integrating the tested per-project
escrow V2 and developing project-level referral rewards.
