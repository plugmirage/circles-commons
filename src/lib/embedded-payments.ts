"use client";

import { circlesConfig as sdkCirclesConfig } from "@aboutcircles/sdk-core";
import { TransferBuilder } from "@aboutcircles/sdk-transfers";
import type { Address } from "@aboutcircles/sdk-types";
import { encodeCrcV2TransferData } from "@aboutcircles/sdk-utils";
import { hexToBytes, parseUnits } from "viem";

export async function sendEmbeddedCrcPayment(
  from: string,
  to: string,
  amountCRC: number,
  reference: string
) {
  const transferData = encodeCrcV2TransferData([reference], 0x0001);
  const builder = new TransferBuilder(sdkCirclesConfig[100]);
  const transactions = await builder.constructAdvancedTransfer(
    from as Address,
    to as Address,
    parseUnits(String(amountCRC), 18),
    { txData: hexToBytes(transferData) }
  );
  const { sendTransactions } = await import("@aboutcircles/miniapp-sdk");
  return sendTransactions(transactions.map((transaction) => ({
    to: transaction.to,
    data: transaction.data,
    value: transaction.value.toString()
  })));
}
