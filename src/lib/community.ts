"use client";

import { Sdk } from "@aboutcircles/sdk";
import { circlesConfig as sdkCirclesConfig } from "@aboutcircles/sdk-core";
import { TransferBuilder } from "@aboutcircles/sdk-transfers";
import type { Address, ContractRunner, TransactionRequest } from "@aboutcircles/sdk-types";
import { encodeCrcV2TransferData } from "@aboutcircles/sdk-utils";
import { createPublicClient, createWalletClient, custom, http } from "viem";
import { gnosis } from "viem/chains";
import { hexToBytes, parseUnits } from "viem";

type InjectedProvider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};

declare global {
  interface Window {
    ethereum?: InjectedProvider;
  }
}

const GNOSIS_RPC_URL = "https://rpc.gnosischain.com";

async function getProvider() {
  if (!window.ethereum) {
    throw new Error("Install or unlock Rabby or MetaMask to continue.");
  }
  return window.ethereum;
}

async function selectGnosisChain(provider: InjectedProvider) {
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x64" }] });
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: "0x64",
        chainName: "Gnosis Chain",
        nativeCurrency: { name: "xDAI", symbol: "xDAI", decimals: 18 },
        rpcUrls: [GNOSIS_RPC_URL],
        blockExplorerUrls: ["https://gnosisscan.io"]
      }]
    });
  }
}

async function createBrowserWalletRunner(): Promise<ContractRunner> {
  const provider = await getProvider();
  await selectGnosisChain(provider);

  const publicClient = createPublicClient({ chain: gnosis, transport: http(GNOSIS_RPC_URL) });
  const walletClient = createWalletClient({ chain: gnosis, transport: custom(provider) });
  const [address] = await walletClient.requestAddresses();
  if (!address) throw new Error("No wallet account was selected.");

  return {
    address,
    publicClient,
    async init() {},
    async estimateGas(tx) {
      return publicClient.estimateGas({ account: address, ...tx });
    },
    async call(tx) {
      const result = await publicClient.call({ account: address, ...tx });
      return result.data ?? "0x";
    },
    async sendTransaction(txs: TransactionRequest[]) {
      let receipt;
      for (const tx of txs) {
        const hash = await walletClient.sendTransaction({ account: address, ...tx });
        receipt = await publicClient.waitForTransactionReceipt({ hash });
      }
      return receipt;
    }
  };
}

export async function connectCommunityWallet(): Promise<Address> {
  const runner = await createBrowserWalletRunner();
  return runner.address!;
}

export async function registerCommunity(name: string, description: string) {
  const runner = await createBrowserWalletRunner();
  const sdk = new Sdk(sdkCirclesConfig[100], runner);
  const organization = await sdk.register.asOrganization({ name, description });
  return { address: organization.address, signer: runner.address! };
}

export async function trustCommunityMember(organizationAddress: Address, memberAddress: Address) {
  const runner = await createBrowserWalletRunner();
  if (runner.address?.toLowerCase() !== organizationAddress.toLowerCase()) {
    throw new Error("Connect the wallet that created this Organization.");
  }
  const sdk = new Sdk(sdkCirclesConfig[100], runner);
  const organization = await sdk.getAvatar(organizationAddress);
  if (await organization.trust.isTrusting(memberAddress)) {
    return { alreadyApproved: true, transactionHash: null };
  }
  const receipt = await organization.trust.add(memberAddress);
  return { alreadyApproved: false, transactionHash: receipt.transactionHash };
}

export async function isCommunityMemberApproved(organizationAddress: Address, memberAddress: Address) {
  const sdk = new Sdk(sdkCirclesConfig[100]);
  const organization = await sdk.getAvatar(organizationAddress);
  return organization.trust.isTrusting(memberAddress);
}

export async function payOutCommunityFunds(
  organizationAddress: Address,
  recipientAddress: Address,
  amountCRC: number,
  memo: string
) {
  const runner = await createBrowserWalletRunner();
  if (runner.address?.toLowerCase() !== organizationAddress.toLowerCase()) {
    throw new Error("Connect the wallet that controls this Organization.");
  }
  const builder = new TransferBuilder(sdkCirclesConfig[100]);
  const transferData = encodeCrcV2TransferData([memo || "commons:payout"], 0x0001);
  const transactions = await builder.constructAdvancedTransfer(
    organizationAddress,
    recipientAddress,
    parseUnits(String(amountCRC), 18),
    { txData: hexToBytes(transferData) }
  );
  if (!runner.sendTransaction) {
    throw new Error("This wallet runner cannot submit Organization payouts.");
  }
  const receipt = await runner.sendTransaction(transactions);
  return { transactionHash: receipt?.transactionHash ?? null };
}
