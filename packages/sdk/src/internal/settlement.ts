import {
  Contract,
  type InterfaceAbi,
  type Signer,
  type TransactionReceipt,
  type TransactionResponse,
} from "ethers";
import { SettlementError, ValidationError } from "../errors";

export type SettlementNetwork = "testnet" | "mainnet";

type ErrorConstructor = new (
  message: string,
  options?: { cause?: unknown },
) => Error;

export function positiveInteger(
  value: string | bigint | number,
  label = "Value",
  ErrorType: ErrorConstructor = Error,
) {
  if (typeof value === "number" && !Number.isSafeInteger(value))
    throw new ErrorType(
      `${label} must be a safe integer; use a string or bigint for exact values.`,
    );
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch (cause) {
    throw new ErrorType(`${label} must be an integer.`, { cause });
  }
  if (parsed <= 0n) throw new ErrorType(`${label} must be greater than zero.`);
  return parsed;
}

export const hbarToWeibars = (tinybars: bigint) => tinybars * 10_000_000_000n;

export function assertPaymentTerms(
  expected: { type: string; tokenAddress?: string },
  actual: { type: string; tokenAddress?: string },
  expectedAmount?: bigint,
  actualAmount?: bigint,
) {
  if (
    expected.type !== actual.type ||
    (expected.type === "HTS_FUNGIBLE" &&
      expected.tokenAddress?.toLowerCase() !==
        actual.tokenAddress?.toLowerCase())
  )
    throw new ValidationError(
      "Asset does not match the asset stored in this payment.",
    );
  if (
    expectedAmount !== undefined &&
    actualAmount !== undefined &&
    expectedAmount !== actualAmount
  )
    throw new ValidationError(
      "Amount does not match the amount stored in this payment.",
    );
}

export function evmAddress(
  value: string,
  label: string,
  ErrorType: ErrorConstructor = ValidationError,
) {
  if (
    !/^0x[0-9a-f]{40}$/i.test(value) ||
    value.toLowerCase() === "0x0000000000000000000000000000000000000000"
  )
    throw new ErrorType(`${label} must be a valid nonzero EVM address.`);
  return value;
}

export function validateHtsIdentity(tokenId: string, tokenAddress: string) {
  if (!/^\d+\.\d+\.\d+$/.test(tokenId))
    throw new ValidationError(
      "HTS token ID must use numeric shard.realm.number format.",
    );
  evmAddress(tokenAddress, "HTS token address");
  const number = BigInt(tokenId.split(".")[2]);
  if (
    tokenAddress.toLowerCase() !== `0x${number.toString(16).padStart(40, "0")}`
  )
    throw new ValidationError(
      "HTS token address does not correspond to token ID.",
    );
  return { type: "HTS_FUNGIBLE" as const, tokenId, tokenAddress };
}

export async function assertSettlementNetwork(
  signer: Signer,
  network: SettlementNetwork,
) {
  const chain = await signer.provider?.getNetwork();
  if (!chain || chain.chainId !== (network === "testnet" ? 296n : 295n))
    throw new SettlementError(
      `Switch wallet to Hedera ${network === "testnet" ? "Testnet" : "Mainnet"}.`,
    );
}

export async function executeSettlement(input: {
  network: SettlementNetwork;
  signer: Signer;
  contractAddress: string;
  abi: InterfaceAbi;
  method: string;
  args: readonly unknown[];
  operation: string;
  value?: bigint;
  createEvent?: string;
}) {
  await assertSettlementNetwork(input.signer, input.network);
  const contract = new Contract(input.contractAddress, input.abi, input.signer);
  let transaction: TransactionResponse | undefined;
  try {
    transaction = (await contract.getFunction(input.method)(
      ...input.args,
      ...(input.value === undefined ? [] : [{ value: input.value }]),
    )) as TransactionResponse;
    const receipt = await transaction.wait();
    if (!receipt || receipt.status !== 1)
      throw new SettlementError(
        `Transaction ${input.operation} was not confirmed successfully.`,
        transaction.hash,
        { status: "failed" },
      );
    let paymentId: string | undefined;
    if (input.createEvent)
      paymentId = paymentIdFromReceipt(receipt, contract, input.createEvent);
    return {
      transactionHash: transaction.hash,
      receipt,
      ...(paymentId ? { paymentId } : {}),
    };
  } catch (cause) {
    if (cause instanceof SettlementError) throw cause;
    const rejected =
      (cause as { code?: string | number })?.code === "ACTION_REJECTED" ||
      (cause as { code?: string | number })?.code === 4001;
    throw new SettlementError(
      rejected
        ? "Wallet request was rejected by the user."
        : transaction
          ? `Transaction was submitted (${transaction.hash}) but confirmation was not observed; inspect it before retrying.`
          : `Transaction ${input.operation} failed before submission.`,
      transaction?.hash,
      { cause, status: transaction ? "submitted" : "failed" },
    );
  }
}

function paymentIdFromReceipt(
  receipt: TransactionReceipt,
  contract: Contract,
  eventName: string,
) {
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === eventName) return parsed.args.paymentId.toString();
    } catch {
      /* Unrelated event ABI. */
    }
  }
  throw new SettlementError(
    `Confirmed create transaction did not contain ${eventName}.`,
    receipt.hash,
  );
}
