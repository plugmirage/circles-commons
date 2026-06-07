# FundedProjectEscrowV2 Security Notes

## Status

This contract is a local, undeployed V2 candidate. It is not connected to the
production frontend or the current V1 deployment.

Automated tests cover project validation, funding closure, exact goal limits,
deadlines, owner-only withdrawals, duplicate withdrawals, post-demurrage
balances, multiple CRC token IDs, receiver authorization, batch rejection,
batched withdrawals, dust deposits, metadata limits, and note limits.

## Architecture

`FundedProjectEscrowV2` is a registry. Each project receives a dedicated
`FundedProjectVaultV2` contract. Isolating balances prevents demurrage in one
project from corrupting accounting for another project.

The vault records gross CRC contributed for goal progress, but withdraws the
current balance returned by the Circles Hub. This is required because CRC
balances decrease through demurrage.

## Invariants

- Only the Circles Hub can invoke the ERC-1155 receive hook.
- Funding closes at the goal, at the deadline, or after withdrawal.
- A contribution cannot exceed the remaining goal.
- Contributions below 1 CRC are rejected.
- Contributors can fund repeatedly and can use different CRC token IDs.
- Contributions are at least 5 CRC, except the exact final contribution.
- Projects with goals below 500 CRC withdraw in one transaction.
- Projects with goals of 500 CRC or more withdraw in batches of up to 50 token IDs.
- Only the immutable project owner can withdraw.
- Withdrawal is available after the goal or the deadline, never twice.
- Withdrawal uses live Hub balances and follows checks-effects-interactions.

## Frontend Integration Requirements

- Read the project vault address from `ProjectCreated` or `getProject`.
- Send project CRC to the project vault, not to the registry.
- Reuse the same token ID for later contributions by the same wallet.
- Reduce the final contribution to the exact remaining goal when necessary.
- Treat the registry event and the vault funding/withdrawal events as separate
  event sources.
- Do not switch the production address until mainnet-fork integration tests and
  an independent Solidity review have been completed.

The automated fork test uses the deployed Circles Hub on a local Gnosis fork.
It verifies a real CRC ERC-1155 transfer into a V2 vault and withdrawal to a
real Gnosis App/Safe address. It never broadcasts a Gnosis mainnet transaction.

## Residual Risk

No smart contract can be guaranteed to contain no vulnerabilities. This review
and test suite reduce known risks but are not a substitute for an independent
professional audit before custody of material funds.
