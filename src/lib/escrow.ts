import { sendTransactions } from "@aboutcircles/miniapp-sdk";
import { Sdk } from "@aboutcircles/sdk";
import { circlesConfig as sdkCirclesConfig } from "@aboutcircles/sdk-core";
import { CirclesConverter, encodeCrcV2TransferData } from "@aboutcircles/sdk-utils";
import { createPublicClient, encodeAbiParameters, encodeFunctionData, formatUnits, http, keccak256, parseAbi, parseAbiParameters, parseUnits, stringToBytes, type Address } from "viem";
import { gnosis } from "viem/chains";

const HUB_ADDRESS = sdkCirclesConfig[100].v2HubAddress as `0x${string}`;
const GNOSIS_RPC_URL = process.env.NEXT_PUBLIC_CIRCLES_CHAIN_RPC_URL || "https://rpc.gnosischain.com";
const ESCROW_DEPLOYMENT_BLOCK = 46525000n;
const ESCROW_V2_DEPLOYMENT_BLOCK = 46610489n;
export const legacyEscrowAddress = process.env.NEXT_PUBLIC_ESCROW_ADDRESS as Address | undefined;
export const escrowV2Address = (process.env.NEXT_PUBLIC_ESCROW_V2_ADDRESS || "0x73660aAAB3454A2583e73B8A0Ae26d9d88A86352") as Address;
export const escrowAddress = escrowV2Address;
const publicClient = createPublicClient({ chain: gnosis, transport: http(GNOSIS_RPC_URL) });

const escrowAbi = [
  {
    type: "function",
    name: "createProject",
    inputs: [
      { name: "projectId", type: "bytes32" },
      { name: "goal", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "metadataURI", type: "string" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "withdraw",
    inputs: [
      { name: "projectId", type: "bytes32" },
      { name: "note", type: "string" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  }
] as const;

const hubAbi = [
  {
    type: "function",
    name: "safeTransferFrom",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "id", type: "uint256" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  }
] as const;
const wrapperAbi = [
  {
    type: "function",
    name: "unwrap",
    inputs: [{ name: "_amount", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable"
  }
] as const;

const escrowReadAbi = parseAbi([
  "event ProjectFunded(bytes32 indexed projectId, address indexed contributor, uint256 indexed tokenId, uint256 amount)",
  "event ProjectWithdrawn(bytes32 indexed projectId, address indexed owner, uint256 amount, string note)"
]);

const registryV2Abi = parseAbi([
  "function createProject(bytes32 projectId, uint256 goal, uint256 deadline, string metadataURI) returns (address vault)",
  "function getProject(bytes32 projectId) view returns ((address owner,address vault,uint256 goal,uint256 deadline,string metadataURI) project)"
]);

const vaultV2Abi = parseAbi([
  "function withdraw(string note)",
  "function withdrawBatch(uint256 maxTokenIds, string note)",
  "function usesBatchWithdrawal() view returns (bool)",
  "function tokenIdsForProject() view returns (uint256[])",
  "function withdrawalCursor() view returns (uint256)"
  ,"function goal() view returns (uint256)"
  ,"function raised() view returns (uint256)"
]);

export type EscrowProjectRef = {
  id: string;
  contractVersion?: "v1" | "v2";
  vaultAddress?: string;
};

function requireEscrowAddress() {
  if (!legacyEscrowAddress) {
    throw new Error("Escrow contract is not configured yet.");
  }
  return legacyEscrowAddress;
}

function isV2Project(project: EscrowProjectRef) {
  return project.contractVersion === "v2";
}

export function escrowRecipientForProject(project: EscrowProjectRef) {
  return isV2Project(project) ? project.vaultAddress as Address | undefined : legacyEscrowAddress;
}

async function verifiedV2Vault(project: EscrowProjectRef) {
  if (!project.vaultAddress) throw new Error("This V2 project has no vault address configured.");
  const registered = await publicClient.readContract({
    address: escrowV2Address,
    abi: registryV2Abi,
    functionName: "getProject",
    args: [makeEscrowProjectId(project.id)]
  });
  if (registered.vault.toLowerCase() !== project.vaultAddress.toLowerCase()) {
    throw new Error("This project's vault does not match the V2 registry.");
  }
  return registered.vault;
}

export function makeEscrowProjectId(id: string) {
  return keccak256(stringToBytes(`circles-commons:project:${id}`));
}

export type EscrowFundingEvent = {
  projectId: `0x${string}`;
  contributor: string;
  tokenId: string;
  amountCRC: number;
  transactionHash: string;
  blockNumber: bigint;
};

export type EscrowWithdrawalEvent = {
  projectId: `0x${string}`;
  owner: string;
  amountCRC: number;
  note: string;
  transactionHash: string;
  blockNumber: bigint;
};

async function rawCirclesToCrc(amount: bigint, blockNumber: bigint) {
  const block = await publicClient.getBlock({ blockNumber });
  const rawCirclesPerCrc = CirclesConverter.attoCrcToAttoCircles(10n ** 18n, block.timestamp);
  return Number(formatUnits((amount * 10n ** 18n) / rawCirclesPerCrc, 18));
}

async function crcToRawCircles(amountCRC: number) {
  const block = await publicClient.getBlock({ blockTag: "latest" });
  return CirclesConverter.attoCrcToAttoCircles(parseUnits(String(amountCRC), 18), block.timestamp);
}

export async function fetchEscrowFundingEvents(projects: EscrowProjectRef[]): Promise<EscrowFundingEvent[]> {
  if (projects.length === 0) return [];
  const v1Projects = projects.filter((project) => !isV2Project(project));
  const v2Projects = projects.filter((project) => isV2Project(project) && project.vaultAddress);
  const v1Ids = new Set(v1Projects.map((project) => makeEscrowProjectId(project.id)));
  const [v1Logs, ...v2Batches] = await Promise.all([
    legacyEscrowAddress && v1Ids.size > 0 ? publicClient.getLogs({ address: legacyEscrowAddress, event: escrowReadAbi[0], fromBlock: ESCROW_DEPLOYMENT_BLOCK, toBlock: "latest" }) : Promise.resolve([]),
    ...v2Projects.map((project) => publicClient.getLogs({ address: project.vaultAddress as Address, event: escrowReadAbi[0], fromBlock: ESCROW_V2_DEPLOYMENT_BLOCK, toBlock: "latest" }))
  ]);
  const v2Ids = new Set(v2Projects.map((project) => makeEscrowProjectId(project.id)));
  const legacyEvents = v1Logs.filter((log) => log.args.projectId && v1Ids.has(log.args.projectId)).map((log) => ({
      projectId: log.args.projectId!,
      contributor: log.args.contributor!,
      tokenId: String(log.args.tokenId ?? ""),
      amountCRC: Number(formatUnits(log.args.amount ?? 0n, 18)),
      transactionHash: log.transactionHash,
      blockNumber: log.blockNumber
    }));
  const v2Events = await Promise.all(v2Batches.flat()
    .filter((log) => log.args.projectId && v2Ids.has(log.args.projectId))
    .map(async (log) => ({
      projectId: log.args.projectId!,
      contributor: log.args.contributor!,
      tokenId: String(log.args.tokenId ?? ""),
      amountCRC: await rawCirclesToCrc(log.args.amount ?? 0n, log.blockNumber),
      transactionHash: log.transactionHash,
      blockNumber: log.blockNumber
    })));
  return [...legacyEvents, ...v2Events];
}

export async function fetchEscrowWithdrawalEvents(projects: EscrowProjectRef[]): Promise<EscrowWithdrawalEvent[]> {
  if (projects.length === 0) return [];
  const v1Projects = projects.filter((project) => !isV2Project(project));
  const v2Projects = projects.filter((project) => isV2Project(project) && project.vaultAddress);
  const v1Ids = new Set(v1Projects.map((project) => makeEscrowProjectId(project.id)));
  const v2Ids = new Set(v2Projects.map((project) => makeEscrowProjectId(project.id)));
  const [v1Logs, ...v2Batches] = await Promise.all([
    legacyEscrowAddress && v1Ids.size > 0 ? publicClient.getLogs({ address: legacyEscrowAddress, event: escrowReadAbi[1], fromBlock: ESCROW_DEPLOYMENT_BLOCK, toBlock: "latest" }) : Promise.resolve([]),
    ...v2Projects.map((project) => publicClient.getLogs({ address: project.vaultAddress as Address, event: escrowReadAbi[1], fromBlock: ESCROW_V2_DEPLOYMENT_BLOCK, toBlock: "latest" }))
  ]);
  const legacyEvents = v1Logs.filter((log) => log.args.projectId && v1Ids.has(log.args.projectId)).map((log) => ({
      projectId: log.args.projectId!,
      owner: log.args.owner!,
      amountCRC: Number(formatUnits(log.args.amount ?? 0n, 18)),
      note: log.args.note ?? "",
      transactionHash: log.transactionHash,
      blockNumber: log.blockNumber
    }));
  const v2Events = await Promise.all(v2Batches.flat()
    .filter((log) => log.args.projectId && v2Ids.has(log.args.projectId))
    .map(async (log) => ({
      projectId: log.args.projectId!,
      owner: log.args.owner!,
      amountCRC: await rawCirclesToCrc(log.args.amount ?? 0n, log.blockNumber),
      note: log.args.note ?? "",
      transactionHash: log.transactionHash,
      blockNumber: log.blockNumber
    })));
  return [...legacyEvents, ...v2Events];
}

export async function createEscrowProject(project: {
  id: string;
  goal: number;
  deadline: number;
  metadataURI: string;
}) {
  const to = escrowV2Address;
  const projectId = makeEscrowProjectId(project.id);
  const rawGoal = await crcToRawCircles(project.goal);
  const data = encodeFunctionData({
    abi: registryV2Abi,
    functionName: "createProject",
    args: [
      projectId,
      rawGoal,
      BigInt(project.deadline),
      project.metadataURI
    ]
  });
  await sendTransactions([{ to, data, value: "0" }]);
  for (let attempt = 0; attempt < 15; attempt += 1) {
    try {
      const created = await publicClient.readContract({ address: to, abi: registryV2Abi, functionName: "getProject", args: [projectId] });
      if (created.vault && created.vault !== "0x0000000000000000000000000000000000000000") return created.vault;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("The V2 project transaction was submitted, but its vault address could not be read yet. Reload before retrying creation.");
}

export async function fundEscrowProject(args: {
  from: string;
  project: EscrowProjectRef;
  amountCRC: number;
  reference: string;
}) {
  const to = isV2Project(args.project) ? await verifiedV2Vault(args.project) : escrowRecipientForProject(args.project);
  if (!to) throw new Error("This project has no escrow recipient configured.");
  const projectId = makeEscrowProjectId(args.project.id);
  const requestedCrc = parseUnits(String(args.amountCRC), 18);
  let amount = requestedCrc;
  if (isV2Project(args.project)) {
    const [rawAmount, goal, raised] = await Promise.all([
      crcToRawCircles(args.amountCRC),
      publicClient.readContract({ address: to, abi: vaultV2Abi, functionName: "goal" }),
      publicClient.readContract({ address: to, abi: vaultV2Abi, functionName: "raised" })
    ]);
    amount = rawAmount > goal - raised ? goal - raised : rawAmount;
  }
  const sdk = new Sdk(sdkCirclesConfig[100]);
  const balances = await sdk.data.getBalances(args.from as `0x${string}`);
  const directBalance = balances.find((balance) =>
    balance.isErc1155 && BigInt(isV2Project(args.project) ? balance.attoCircles : balance.attoCrc) >= amount
  );
  const wrappedBalance = balances.find((balance) =>
    balance.isWrapped &&
    !balance.isInflationary &&
    BigInt(isV2Project(args.project) ? balance.attoCircles : balance.attoCrc) >= amount
  );
  const selectedBalance = directBalance ?? wrappedBalance;
  if (!selectedBalance) {
    throw new Error(`This wallet does not have a single spendable CRC token with ${args.amountCRC} CRC available for escrow. Try a smaller amount.`);
  }
  const transferMemo = encodeCrcV2TransferData([args.reference], 0x0001);
  const unwrapData = wrappedBalance && selectedBalance === wrappedBalance ? encodeFunctionData({
    abi: wrapperAbi,
    functionName: "unwrap",
    args: [amount]
  }) : null;
  const data = encodeFunctionData({
    abi: hubAbi,
    functionName: "safeTransferFrom",
    args: [
      args.from as `0x${string}`,
      to,
      BigInt(selectedBalance.tokenOwner),
      amount,
      isV2Project(args.project)
        ? transferMemo
        : encodeAbiParameters(parseAbiParameters("bytes32 projectId, bytes memo"), [projectId, transferMemo])
    ]
  });
  return sendTransactions([
    ...(unwrapData ? [{ to: selectedBalance.tokenAddress, data: unwrapData, value: "0" }] : []),
    { to: HUB_ADDRESS, data, value: "0" }
  ]);
}

export async function withdrawEscrowProject(project: EscrowProjectRef, note: string) {
  if (isV2Project(project)) {
    const to = await verifiedV2Vault(project);
    const usesBatch = await publicClient.readContract({ address: to, abi: vaultV2Abi, functionName: "usesBatchWithdrawal" });
    if (!usesBatch) {
      const data = encodeFunctionData({ abi: vaultV2Abi, functionName: "withdraw", args: [note] });
      await sendTransactions([{ to, data, value: "0" }]);
      return;
    }
    const [tokenIds, cursor] = await Promise.all([
      publicClient.readContract({ address: to, abi: vaultV2Abi, functionName: "tokenIdsForProject" }),
      publicClient.readContract({ address: to, abi: vaultV2Abi, functionName: "withdrawalCursor" })
    ]);
    const remaining = tokenIds.length - Number(cursor);
    if (remaining <= 0) throw new Error("This project has no remaining token balances to withdraw.");
    const calls = Math.ceil(remaining / 50);
    const data = encodeFunctionData({ abi: vaultV2Abi, functionName: "withdrawBatch", args: [50n, note] });
    await sendTransactions(Array.from({ length: calls }, () => ({ to, data, value: "0" })));
    return;
  }
  const to = requireEscrowAddress();
  const data = encodeFunctionData({
    abi: escrowAbi,
    functionName: "withdraw",
    args: [makeEscrowProjectId(project.id), note]
  });
  return sendTransactions([{ to, data, value: "0" }]);
}
