import { sendTransactions } from "@aboutcircles/miniapp-sdk";
import { circlesConfig as sdkCirclesConfig } from "@aboutcircles/sdk-core";
import { encodeCrcV2TransferData } from "@aboutcircles/sdk-utils";
import { createPublicClient, encodeAbiParameters, encodeFunctionData, formatUnits, http, keccak256, parseAbi, parseAbiParameters, parseUnits, stringToBytes } from "viem";
import { gnosis } from "viem/chains";

const HUB_ADDRESS = sdkCirclesConfig[100].v2HubAddress as `0x${string}`;
const GNOSIS_RPC_URL = process.env.NEXT_PUBLIC_CIRCLES_CHAIN_RPC_URL || "https://rpc.gnosischain.com";
const ESCROW_DEPLOYMENT_BLOCK = 46525000n;
export const escrowAddress = process.env.NEXT_PUBLIC_ESCROW_ADDRESS as `0x${string}` | undefined;
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

const escrowReadAbi = parseAbi([
  "event ProjectFunded(bytes32 indexed projectId, address indexed contributor, uint256 indexed tokenId, uint256 amount)"
]);

function requireEscrowAddress() {
  if (!escrowAddress) {
    throw new Error("Escrow contract is not configured yet.");
  }
  return escrowAddress;
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

export async function fetchEscrowFundingEvents(projectIds: string[]): Promise<EscrowFundingEvent[]> {
  const to = escrowAddress;
  if (!to || projectIds.length === 0) return [];

  const projectIdSet = new Set(projectIds.map(makeEscrowProjectId));
  const logs = await publicClient.getLogs({
    address: to,
    event: escrowReadAbi[0],
    fromBlock: ESCROW_DEPLOYMENT_BLOCK,
    toBlock: "latest"
  });

  return logs
    .filter((log) => log.args.projectId && projectIdSet.has(log.args.projectId))
    .map((log) => ({
      projectId: log.args.projectId!,
      contributor: log.args.contributor!,
      tokenId: String(log.args.tokenId ?? ""),
      amountCRC: Number(formatUnits(log.args.amount ?? 0n, 18)),
      transactionHash: log.transactionHash,
      blockNumber: log.blockNumber
    }));
}

export async function createEscrowProject(project: {
  id: string;
  goal: number;
  deadline: number;
  metadataURI: string;
}) {
  const to = requireEscrowAddress();
  const data = encodeFunctionData({
    abi: escrowAbi,
    functionName: "createProject",
    args: [
      makeEscrowProjectId(project.id),
      parseUnits(String(project.goal), 18),
      BigInt(project.deadline),
      project.metadataURI
    ]
  });
  return sendTransactions([{ to, data, value: "0" }]);
}

export async function fundEscrowProject(args: {
  from: string;
  projectId: string;
  amountCRC: number;
  reference: string;
}) {
  const to = requireEscrowAddress();
  const projectId = makeEscrowProjectId(args.projectId);
  const transferMemo = encodeCrcV2TransferData([args.reference], 0x0001);
  const data = encodeFunctionData({
    abi: hubAbi,
    functionName: "safeTransferFrom",
    args: [
      args.from as `0x${string}`,
      to,
      BigInt(args.from),
      parseUnits(String(args.amountCRC), 18),
      encodeAbiParameters(parseAbiParameters("bytes32 projectId, bytes memo"), [projectId, transferMemo])
    ]
  });
  return sendTransactions([{ to: HUB_ADDRESS, data, value: "0" }]);
}

export async function withdrawEscrowProject(projectId: string, note: string) {
  const to = requireEscrowAddress();
  const data = encodeFunctionData({
    abi: escrowAbi,
    functionName: "withdraw",
    args: [makeEscrowProjectId(projectId), note]
  });
  return sendTransactions([{ to, data, value: "0" }]);
}
