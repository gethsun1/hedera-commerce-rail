import { Contract, type Signer } from "ethers";
import hbarArtifact from "../../hardhat/artifacts/contracts/PaymentEscrow.sol/PaymentEscrow.json";
import htsArtifact from "../../hardhat/artifacts/contracts/TokenPaymentEscrow.sol/TokenPaymentEscrow.json";
import tokenArtifact from "../../hardhat/artifacts/contracts/HederaToken.sol/HederaToken.json";
import { ConfigurationError, SettlementError, ValidationError } from "./errors";
import {
  assertPaymentTerms,
  assertSettlementNetwork,
  evmAddress,
  executeSettlement,
  hbarToWeibars,
  positiveInteger,
  validateHtsIdentity,
} from "./internal/settlement";
export { createAuditAuthorizationMessage } from "./internal/audit-authorization";

export type BrowserAsset =
  | { type: "HBAR" }
  | { type: "HTS_FUNGIBLE"; tokenId: string; tokenAddress: string };
export type BrowserPayment = {
  paymentId: string;
  payer: string;
  payee: string;
  arbiter: string;
  amount: string;
  asset: BrowserAsset;
  deadline: string;
  state: number;
};
export type BrowserTransaction = {
  transactionId: string;
  transactionHash: string;
  status: "confirmed";
  operation: string;
  paymentId?: string;
  contractAddress: string;
  blockNumber: number;
  amount?: string;
  asset: BrowserAsset;
};
const HTS_TOKEN_ASSOCIATION_ABI = [
  "function associate() returns (int64 responseCode)",
];
const ZERO = "0x0000000000000000000000000000000000000000";
const addr = (v: string) => {
  return evmAddress(v, "Address", ValidationError);
};
const integer = (v: string | bigint | number) => {
  return positiveInteger(v, "Amount", ValidationError);
};

/** Browser-only settlement API. The signer is supplied by the connected user's wallet. */
export function createBrowserCommerceClient(input: {
  network: "testnet" | "mainnet";
  signer: Signer;
  contracts: { hbar: string; hts: string };
}) {
  if (!input.signer.provider)
    throw new ConfigurationError(
      "Wallet signer must have a connected provider.",
    );
  const contracts = {
    hbar: addr(input.contracts.hbar),
    hts: addr(input.contracts.hts),
  };
  const run = async (
    kind: "hbar" | "hts",
    operation: string,
    method: string,
    args: unknown[],
    asset: BrowserAsset,
    paymentId?: string,
    amount?: bigint,
    value?: bigint,
    eventName?: string,
  ): Promise<BrowserTransaction> => {
    const result = await executeSettlement({
      network: input.network,
      signer: input.signer,
      contractAddress: contracts[kind],
      abi: kind === "hbar" ? hbarArtifact.abi : htsArtifact.abi,
      method,
      args,
      operation,
      ...(value === undefined ? {} : { value }),
      ...(eventName ? { createEvent: eventName } : {}),
    });
    return {
      transactionId: result.transactionHash,
      transactionHash: result.transactionHash,
      status: "confirmed",
      operation,
      ...((result.paymentId ?? paymentId)
        ? { paymentId: result.paymentId ?? paymentId }
        : {}),
      contractAddress: contracts[kind],
      blockNumber: result.receipt.blockNumber,
      ...(amount === undefined ? {} : { amount: amount.toString() }),
      asset,
    };
  };
  const read = async (
    kind: "hbar" | "hts",
    id: string,
    token?: Extract<BrowserAsset, { type: "HTS_FUNGIBLE" }>,
  ): Promise<BrowserPayment> => {
    await assertSettlementNetwork(input.signer, input.network);
    const c = new Contract(
      contracts[kind],
      kind === "hbar" ? hbarArtifact.abi : htsArtifact.abi,
      input.signer.provider,
    );
    try {
      const p = await c.getFunction("getPayment")(integer(id));
      const tokenAddr = kind === "hts" ? String(p.token) : undefined;
      return {
        paymentId: id,
        payer: String(p.payer),
        payee: String(p.payee),
        arbiter: String(p.arbiter),
        amount: String(p.amount),
        asset:
          kind === "hbar"
            ? { type: "HBAR" }
            : {
                type: "HTS_FUNGIBLE",
                tokenId: token!.tokenId,
                tokenAddress: tokenAddr!,
              },
        deadline: String(p.deadline),
        state: Number(p.state),
      };
    } catch (cause) {
      throw new SettlementError(
        "Unable to read payment state from the escrow contract.",
        undefined,
        { cause },
      );
    }
  };
  const sameAsset = (expected: BrowserAsset, actual: BrowserAsset) => {
    assertPaymentTerms(expected, actual);
  };
  const api = (kind: "hbar" | "hts") => ({
    read: (
      id: string,
      token?: Extract<BrowserAsset, { type: "HTS_FUNGIBLE" }>,
    ) => read(kind, id, token),
    create: async (v: {
      payee: string;
      arbiter?: string;
      amount: string | bigint;
      deadline: string | bigint;
      token?: Extract<BrowserAsset, { type: "HTS_FUNGIBLE" }>;
    }) => {
      const amount = integer(v.amount),
        deadline = integer(v.deadline),
        payee = addr(v.payee),
        arbiter = v.arbiter ? addr(v.arbiter) : ZERO;
      if (kind === "hbar")
        return run(
          kind,
          "create",
          "createPayment",
          [payee, arbiter, amount, deadline],
          { type: "HBAR" },
          undefined,
          amount,
          undefined,
          "PaymentCreated",
        );
      if (!v.token)
        throw new ValidationError("HTS token details are required.");
      validateHtsIdentity(v.token.tokenId, v.token.tokenAddress);
      return run(
        kind,
        "create",
        "createPayment",
        [addr(v.token.tokenAddress), payee, arbiter, amount, deadline],
        v.token,
        undefined,
        amount,
        undefined,
        "TokenPaymentCreated",
      );
    },
    fund: async (id: string, asset: BrowserAsset, amount: string | bigint) => {
      const p = await read(
        kind,
        id,
        asset.type === "HTS_FUNGIBLE" ? asset : undefined,
      );
      sameAsset(p.asset, asset);
      assertPaymentTerms(asset, p.asset, integer(amount), BigInt(p.amount));
      return run(
        kind,
        "fund",
        "fundPayment",
        [integer(id)],
        asset,
        id,
        integer(amount),
        kind === "hbar" ? hbarToWeibars(integer(amount)) : undefined,
      );
    },
    release: async (id: string, asset: BrowserAsset) => {
      const p = await read(
        kind,
        id,
        asset.type === "HTS_FUNGIBLE" ? asset : undefined,
      );
      sameAsset(p.asset, asset);
      return run(
        kind,
        "release",
        "releasePayment",
        [integer(id)],
        asset,
        id,
        BigInt(p.amount),
      );
    },
    refund: async (id: string, asset: BrowserAsset) => {
      const p = await read(
        kind,
        id,
        asset.type === "HTS_FUNGIBLE" ? asset : undefined,
      );
      sameAsset(p.asset, asset);
      return run(
        kind,
        "refund",
        "refundPayment",
        [integer(id)],
        asset,
        id,
        BigInt(p.amount),
      );
    },
    ...(kind === "hts"
      ? {
          associateToken: (
            asset: Extract<BrowserAsset, { type: "HTS_FUNGIBLE" }>,
          ) =>
            run(
              "hts",
              "associate",
              "associateToken",
              [addr(asset.tokenAddress)],
              asset,
            ),
          associateAccount: async (
            asset: Extract<BrowserAsset, { type: "HTS_FUNGIBLE" }>,
          ) => {
            const result = await executeSettlement({
              network: input.network,
              signer: input.signer,
              contractAddress: addr(asset.tokenAddress),
              abi: HTS_TOKEN_ASSOCIATION_ABI,
              method: "associate",
              args: [],
              operation: "associate",
            });
            return {
              transactionId: result.transactionHash,
              transactionHash: result.transactionHash,
              status: "confirmed" as const,
              operation: "associate",
              contractAddress: asset.tokenAddress,
              blockNumber: result.receipt.blockNumber,
              asset,
            };
          },
          approve: async (
            id: string,
            asset: Extract<BrowserAsset, { type: "HTS_FUNGIBLE" }>,
            amount: string | bigint,
          ) => {
            const value = integer(amount);
            const result = await executeSettlement({
              network: input.network,
              signer: input.signer,
              contractAddress: addr(asset.tokenAddress),
              abi: tokenArtifact.abi,
              method: "approve",
              args: [contracts.hts, value],
              operation: "approve",
            });
            return {
              transactionId: result.transactionHash,
              transactionHash: result.transactionHash,
              status: "confirmed" as const,
              operation: "approve",
              paymentId: id,
              contractAddress: asset.tokenAddress,
              blockNumber: result.receipt.blockNumber,
              amount: value.toString(),
              asset,
            };
          },
        }
      : {}),
  });
  return {
    network: input.network,
    account: async () => addr(await input.signer.getAddress()),
    escrow: { hbar: api("hbar"), hts: api("hts") },
    toJSON: () => ({
      network: input.network,
      capabilities: { settlement: true },
    }),
  };
}
