import { Client } from "@hiero-ledger/sdk";
import {
  Contract,
  JsonRpcProvider,
  Wallet,
  type Provider,
  type Signer,
} from "ethers";
import {
  readHederaEnvironment,
  createHederaClient,
} from "./internal/hedera/config";
import {
  createHcsPublisher,
  type HcsPublishResult,
} from "./internal/hcs/publisher";
import type {
  CommerceAuditEvent,
  CommerceAuditEventInput,
  EscrowPaymentSnapshot,
  EscrowSourceLog,
} from "./internal/hcs/schema";
import {
  createCommerceAuditEvent,
  normalizeEscrowLog,
  parseCommerceAuditEvent,
} from "./internal/hcs/schema";
import {
  createMirrorNodeClient,
  readMirrorNodeConfig,
  type MirrorNodeConfig,
} from "./internal/mirror-node/client";
import {
  correlateCommerceEvent,
  locateHcsEvent,
  locateSettlementEvent,
} from "./internal/mirror-node/verification";
import {
  AuditError,
  ConfigurationError,
  SettlementError,
  ValidationError,
} from "./errors";
import {
  assertPaymentTerms,
  evmAddress,
  executeSettlement,
  hbarToWeibars,
  positiveInteger,
  validateHtsIdentity,
} from "./internal/settlement";
import hbarArtifact from "../../hardhat/artifacts/contracts/PaymentEscrow.sol/PaymentEscrow.json";
import htsArtifact from "../../hardhat/artifacts/contracts/TokenPaymentEscrow.sol/TokenPaymentEscrow.json";
import htsTokenArtifact from "../../hardhat/artifacts/contracts/HederaToken.sol/HederaToken.json";

export type CommerceNetwork = "testnet" | "mainnet";
export type HbarAsset = { type: "HBAR" };
export type HtsFungibleAsset = {
  type: "HTS_FUNGIBLE";
  tokenId: string;
  tokenAddress: string;
};
export type CommerceAsset = HbarAsset | HtsFungibleAsset;
export type CommerceOperation =
  "create" | "fund" | "release" | "refund" | "associate" | "approve";
export type TransactionStatus = "confirmed" | "failed";
export type SettlementResult = {
  transactionId: string;
  transactionHash: string;
  network: CommerceNetwork;
  contractAddress: string;
  operation: CommerceOperation;
  status: TransactionStatus;
  paymentId?: string;
  asset: CommerceAsset;
  amount?: string;
  blockNumber: number;
};
export type SettlementConfig = {
  rpcUrl?: string;
  /** Use exactly one signer mode: application-owned private key or user-owned Ethers signer. */
  privateKey?: string;
  signer?: Signer;
  contracts: { hbar: string; hts: string };
};
export type HcsConfig = {
  topicId: string;
  accountId: string;
  privateKey: string;
  allowMainnet?: boolean;
};
export type CommerceClientConfig = {
  network: CommerceNetwork;
  settlement?: SettlementConfig;
  hcs?: HcsConfig;
  mirrorNode?: Partial<MirrorNodeConfig>;
};
export type CreatePaymentInput = {
  payee: string;
  arbiter?: string;
  amount: bigint | string;
  deadline: bigint | number;
};
export type HbarCreatePaymentInput = CreatePaymentInput;
export type HtsCreatePaymentInput = CreatePaymentInput & {
  token: HtsFungibleAsset;
};
export type HbarEscrowApi = {
  create(
    input: HbarCreatePaymentInput,
  ): Promise<SettlementResult & { paymentId: string }>;
  fund(
    paymentId: string,
    input: { asset: HbarAsset; amount: bigint | string },
  ): Promise<SettlementResult>;
  release(paymentId: string, asset: HbarAsset): Promise<SettlementResult>;
  refund(paymentId: string, asset: HbarAsset): Promise<SettlementResult>;
};
export type HtsEscrowApi = {
  create(
    input: HtsCreatePaymentInput,
  ): Promise<SettlementResult & { paymentId: string }>;
  fund(
    paymentId: string,
    input: { asset: HtsFungibleAsset; amount: bigint | string },
  ): Promise<SettlementResult>;
  release(
    paymentId: string,
    asset: HtsFungibleAsset,
  ): Promise<SettlementResult>;
  refund(paymentId: string, asset: HtsFungibleAsset): Promise<SettlementResult>;
  associateToken(asset: HtsFungibleAsset): Promise<SettlementResult>;
  approve(
    paymentId: string,
    asset: HtsFungibleAsset,
    amount: bigint | string,
  ): Promise<SettlementResult>;
};
export type CommerceEventInput = Omit<CommerceAuditEventInput, "network"> & {
  network?: CommerceAuditEventInput["network"];
};

export type CommerceClientTestAdapters = {
  settlementExecutor?: (input: {
    kind: "hbar" | "hts";
    contractAddress: string;
    operation: CommerceOperation;
    method: string;
    args: unknown[];
    asset: CommerceAsset;
    paymentId?: string;
    amount?: bigint;
    value?: bigint;
    createEvent?: string;
  }) => Promise<SettlementResult>;
  paymentReader?: (input: {
    kind: "hbar" | "hts";
    contractAddress: string;
    paymentId: bigint;
  }) => Promise<{ asset: CommerceAsset; amount: bigint }>;
  auditPublisher?: {
    publish: (event: CommerceAuditEvent) => Promise<HcsPublishResult>;
  };
  mirrorClient?: ReturnType<typeof createMirrorNodeClient>;
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const TOKEN_ID = /^\d+\.\d+\.\d+$/;

// ABI and default deployed address come from Hardhat's maintained deployment artifact.
const ABI = { hbar: hbarArtifact.abi, hts: htsArtifact.abi } as const;

function validPositiveInteger(
  value: bigint | string | number,
  label: string,
): bigint {
  return positiveInteger(value, label, ValidationError);
}
function address(value: string, label: string): string {
  return evmAddress(value, label, ValidationError);
}
function validateAsset(asset: CommerceAsset): CommerceAsset {
  if (!asset || typeof asset !== "object")
    throw new ValidationError("A supported asset is required.");
  if (asset.type === "HBAR") return asset;
  if (asset.type !== "HTS_FUNGIBLE")
    throw new ValidationError("Unsupported asset type.");
  return validateHtsIdentity(asset.tokenId, asset.tokenAddress);
}

export function buildCommerceClient(
  config: CommerceClientConfig,
  adapters: CommerceClientTestAdapters = {},
) {
  if (config.network !== "testnet" && config.network !== "mainnet")
    throw new ConfigurationError("network must be testnet or mainnet.");
  let provider: Provider | undefined;
  let wallet: Signer | undefined;
  let settlementContracts: { hbar: string; hts: string } | undefined;
  if (config.settlement) {
    if (!config.settlement.contracts)
      throw new ConfigurationError(
        "Both settlement escrow contract addresses are required.",
      );
    if (!!config.settlement.privateKey === !!config.settlement.signer)
      throw new ConfigurationError(
        "Configure exactly one settlement signer mode: privateKey or signer.",
      );
    try {
      if (config.settlement.signer) {
        wallet = config.settlement.signer;
        if (!wallet.provider)
          throw new Error("External signer requires a connected provider.");
        provider = wallet.provider;
      } else {
        if (!config.settlement.rpcUrl?.trim())
          throw new ConfigurationError(
            "settlement.rpcUrl is required for server signer mode.",
          );
        const rpcUrl = new URL(config.settlement.rpcUrl);
        if (
          !["https:", "http:"].includes(rpcUrl.protocol) ||
          rpcUrl.username ||
          rpcUrl.password
        )
          throw new Error();
        provider = new JsonRpcProvider(config.settlement.rpcUrl);
        wallet = new Wallet(config.settlement.privateKey!, provider);
      }
    } catch {
      throw new ConfigurationError("Settlement signer is invalid.");
    }
    settlementContracts = {
      hbar: address(
        config.settlement.contracts.hbar,
        "settlement.contracts.hbar",
      ),
      hts: address(config.settlement.contracts.hts, "settlement.contracts.hts"),
    };
  }

  let hederaClient: Client | undefined;
  let publisher: ReturnType<typeof createHcsPublisher> | undefined;
  if (config.hcs && !adapters.auditPublisher) {
    if (config.network === "mainnet" && config.hcs.allowMainnet !== true)
      throw new ConfigurationError(
        "Mainnet HCS requires hcs.allowMainnet=true.",
      );
    if (!TOKEN_ID.test(config.hcs.topicId))
      throw new ValidationError(
        "HCS topicId must use numeric shard.realm.number format.",
      );
    try {
      const env = {
        HEDERA_NETWORK: config.network,
        HEDERA_ACCOUNT_ID: config.hcs.accountId,
        HEDERA_PRIVATE_KEY: config.hcs.privateKey,
        HCS_TOPIC_ID: config.hcs.topicId,
        HCS_ALLOW_MAINNET: config.hcs.allowMainnet ? "true" : undefined,
      } as NodeJS.ProcessEnv;
      const parsed = readHederaEnvironment(env);
      hederaClient = createHederaClient(parsed);
      publisher = createHcsPublisher(hederaClient, {
        network: config.network,
        topicId: config.hcs.topicId,
      });
    } catch {
      hederaClient?.close();
      throw new ConfigurationError(
        "Invalid HCS operator or topic configuration.",
      );
    }
  }
  if (adapters.auditPublisher)
    publisher = adapters.auditPublisher as typeof publisher;

  let mirrorClient: ReturnType<typeof createMirrorNodeClient> | undefined =
    adapters.mirrorClient;
  if (config.mirrorNode && !adapters.mirrorClient) {
    try {
      const baseUrl = config.mirrorNode.baseUrl;
      const mirrorConfig = readMirrorNodeConfig({
        HEDERA_NETWORK: config.network,
        ...(baseUrl ? { MIRROR_NODE_BASE_URL: baseUrl } : {}),
        ...(config.mirrorNode.topicId
          ? { HCS_TOPIC_ID: config.mirrorNode.topicId }
          : {}),
      } as NodeJS.ProcessEnv);
      mirrorClient = createMirrorNodeClient(mirrorConfig);
    } catch (cause) {
      throw new ConfigurationError("Invalid Mirror Node configuration.", {
        cause,
      });
    }
  }

  const requireSettlement = () => {
    if (!wallet || !provider || !settlementContracts)
      throw new ConfigurationError(
        "Settlement signer and RPC configuration are required.",
      );
    return { wallet, provider, contracts: settlementContracts };
  };
  async function transact(input: {
    kind: "hbar" | "hts";
    operation: CommerceOperation;
    method: string;
    args: unknown[];
    asset: CommerceAsset;
    paymentId?: string;
    amount?: bigint;
    value?: bigint;
    createEvent?: string;
  }) {
    const { wallet, contracts } = requireSettlement();
    const contractAddress = contracts[input.kind];
    if (adapters.settlementExecutor) {
      try {
        return await adapters.settlementExecutor({ ...input, contractAddress });
      } catch (cause) {
        if (cause instanceof SettlementError) throw cause;
        throw new SettlementError(
          `Settlement ${input.operation} failed before confirmation.`,
          undefined,
          { cause, status: "failed" },
        );
      }
    }
    const result = await executeSettlement({
      network: config.network,
      signer: wallet,
      contractAddress,
      abi: ABI[input.kind],
      method: input.method,
      args: input.args,
      operation: input.operation,
      ...(input.value === undefined ? {} : { value: input.value }),
      ...(input.createEvent ? { createEvent: input.createEvent } : {}),
    });
    const paymentId = result.paymentId ?? input.paymentId;
    return {
      transactionId: result.transactionHash,
      transactionHash: result.transactionHash,
      network: config.network,
      contractAddress,
      operation: input.operation,
      status: "confirmed" as const,
      ...(paymentId ? { paymentId } : {}),
      asset: input.asset,
      ...(input.amount !== undefined
        ? { amount: input.amount.toString() }
        : {}),
      blockNumber: result.receipt.blockNumber,
    } satisfies SettlementResult;
  }
  async function verifyPaymentTerms(
    kind: "hbar" | "hts",
    paymentId: bigint,
    asset: CommerceAsset,
    amount?: bigint,
  ) {
    const { wallet, contracts } = requireSettlement();
    if (adapters.paymentReader) {
      const terms = await adapters.paymentReader({
        kind,
        contractAddress: contracts[kind],
        paymentId,
      });
      assertPaymentTerms(asset, terms.asset, amount, terms.amount);
      return terms;
    }
    const contract = new Contract(contracts[kind], ABI[kind], wallet);
    try {
      const payment = await contract.getFunction("getPayment")(paymentId);
      const onChainAsset =
        kind === "hbar"
          ? { type: "HBAR" as const }
          : {
              type: "HTS_FUNGIBLE" as const,
              tokenId: (asset as HtsFungibleAsset).tokenId,
              tokenAddress: String(payment.token),
            };
      const onChainAmount = BigInt(payment.amount);
      assertPaymentTerms(asset, onChainAsset, amount, onChainAmount);
      return { asset: onChainAsset, amount: onChainAmount };
    } catch (cause) {
      if (cause instanceof ValidationError) throw cause;
      throw new SettlementError(
        "Unable to read the existing payment terms from its escrow contract.",
        undefined,
        { cause, status: "failed" },
      );
    }
  }
  function api(kind: "hbar" | "hts") {
    const asset = (value?: HtsFungibleAsset): CommerceAsset =>
      kind === "hbar"
        ? { type: "HBAR" }
        : validateAsset(value as HtsFungibleAsset);
    return {
      async create(
        input: CreatePaymentInput & { token?: HtsFungibleAsset },
      ): Promise<SettlementResult & { paymentId: string }> {
        if (kind === "hbar" && input.token)
          throw new ValidationError(
            "HBAR payments cannot include HTS token details.",
          );
        if (kind === "hts" && !input.token)
          throw new ValidationError(
            "HTS payments require tokenId and tokenAddress.",
          );
        const payee = address(input.payee, "payee");
        const arbiter = input.arbiter
          ? address(input.arbiter, "arbiter")
          : ZERO_ADDRESS;
        const amount = validPositiveInteger(input.amount, "amount");
        const deadline = validPositiveInteger(input.deadline, "deadline");
        const chosenAsset = asset(input.token);
        const args =
          kind === "hbar"
            ? [payee, arbiter, amount, deadline]
            : [
                (chosenAsset as HtsFungibleAsset).tokenAddress,
                payee,
                arbiter,
                amount,
                deadline,
              ];
        const result = await transact({
          kind,
          operation: "create",
          method: "createPayment",
          args,
          asset: chosenAsset,
          amount,
          createEvent:
            kind === "hbar" ? "PaymentCreated" : "TokenPaymentCreated",
        });
        if (!result.paymentId)
          throw new SettlementError(
            "Confirmed create transaction did not provide a payment ID.",
            result.transactionHash,
          );
        return result as SettlementResult & { paymentId: string };
      },
      fund(
        paymentId: string,
        input: { asset: CommerceAsset; amount: bigint | string },
      ) {
        const id = validPositiveInteger(paymentId, "paymentId");
        const amount = validPositiveInteger(input.amount, "amount");
        const chosenAsset = validateAsset(input.asset);
        if ((kind === "hbar") !== (chosenAsset.type === "HBAR"))
          throw new ValidationError(
            "Asset type does not match the escrow rail.",
          );
        // Ethers encodes value in weibars; Solidity's HBAR amount is tinybars (10^10 weibars each).
        const value = kind === "hbar" ? hbarToWeibars(amount) : undefined;
        return verifyPaymentTerms(kind, id, chosenAsset, amount).then((terms) =>
          transact({
            kind,
            operation: "fund",
            method: "fundPayment",
            args: [id],
            asset: terms.asset,
            paymentId: id.toString(),
            amount,
            ...(value !== undefined ? { value } : {}),
          }),
        );
      },
      release(paymentId: string, chosenAsset: CommerceAsset) {
        const id = validPositiveInteger(paymentId, "paymentId");
        const normalized = validateAsset(chosenAsset);
        if ((kind === "hbar") !== (normalized.type === "HBAR"))
          throw new ValidationError(
            "Asset type does not match the escrow rail.",
          );
        return verifyPaymentTerms(kind, id, normalized).then((terms) =>
          transact({
            kind,
            operation: "release",
            method: "releasePayment",
            args: [id],
            asset: terms.asset,
            amount: terms.amount,
            paymentId: id.toString(),
          }),
        );
      },
      refund(paymentId: string, chosenAsset: CommerceAsset) {
        const id = validPositiveInteger(paymentId, "paymentId");
        const normalized = validateAsset(chosenAsset);
        if ((kind === "hbar") !== (normalized.type === "HBAR"))
          throw new ValidationError(
            "Asset type does not match the escrow rail.",
          );
        return verifyPaymentTerms(kind, id, normalized).then((terms) =>
          transact({
            kind,
            operation: "refund",
            method: "refundPayment",
            args: [id],
            asset: terms.asset,
            amount: terms.amount,
            paymentId: id.toString(),
          }),
        );
      },
      ...(kind === "hts"
        ? {
            associateToken(chosenAsset: HtsFungibleAsset) {
              const normalized = validateAsset(chosenAsset) as HtsFungibleAsset;
              return transact({
                kind: "hts",
                operation: "associate",
                method: "associateToken",
                args: [normalized.tokenAddress],
                asset: normalized,
              });
            },
            approve(
              paymentId: string,
              chosenAsset: HtsFungibleAsset,
              amount: bigint | string,
            ) {
              const id = validPositiveInteger(paymentId, "paymentId");
              const normalized = validateAsset(chosenAsset) as HtsFungibleAsset;
              const parsedAmount = validPositiveInteger(amount, "amount");
              const { wallet } = requireSettlement();
              return (async () => {
                const result = await executeSettlement({
                  network: config.network,
                  signer: wallet,
                  contractAddress: normalized.tokenAddress,
                  abi: htsTokenArtifact.abi,
                  method: "approve",
                  args: [settlementContracts!.hts, parsedAmount],
                  operation: "approve",
                });
                return {
                  transactionId: result.transactionHash,
                  transactionHash: result.transactionHash,
                  network: config.network,
                  contractAddress: normalized.tokenAddress,
                  operation: "approve" as const,
                  status: "confirmed" as const,
                  paymentId: id.toString(),
                  asset: normalized,
                  amount: parsedAmount.toString(),
                  blockNumber: result.receipt.blockNumber,
                } satisfies SettlementResult;
              })();
            },
          }
        : {}),
    };
  }

  const client = {
    network: config.network,
    escrow: {
      hbar: api("hbar") as unknown as HbarEscrowApi,
      hts: api("hts") as unknown as HtsEscrowApi,
    },
    audit: {
      normalize: (log: EscrowSourceLog, payment: EscrowPaymentSnapshot) =>
        (() => {
          if (log.network !== `hedera-${config.network}`)
            throw new ValidationError(
              "Escrow event network does not match the configured Commerce network.",
            );
          return normalizeEscrowLog(log, payment);
        })(),
      createEvent: (event: CommerceEventInput) => {
        const network = event.network ?? `hedera-${config.network}`;
        if (network !== `hedera-${config.network}`)
          throw new ValidationError(
            "Commerce event network does not match the configured Commerce network.",
          );
        return createCommerceAuditEvent({
          ...event,
          network,
        });
      },
      async publish(event: CommerceAuditEvent): Promise<HcsPublishResult> {
        if (!publisher)
          throw new ConfigurationError(
            "HCS topic and operator configuration are required for audit publishing.",
          );
        if (event.network !== `hedera-${config.network}`)
          throw new ValidationError(
            "Commerce event network does not match the configured HCS network.",
          );
        try {
          return await publisher.publish(
            parseCommerceAuditEvent(JSON.stringify(event)),
          );
        } catch (cause) {
          throw new AuditError(
            "HCS audit publication failed; settlement state is unchanged.",
            event.eventId,
            { cause },
          );
        }
      },
    },
    mirror: mirrorClient
      ? {
          getTransaction: (
            ...args: Parameters<typeof mirrorClient.getTransaction>
          ) => mirrorClient!.getTransaction(...args),
          getContract: (...args: Parameters<typeof mirrorClient.getContract>) =>
            mirrorClient!.getContract(...args),
          getContractResults: (
            ...args: Parameters<typeof mirrorClient.getContractResults>
          ) => mirrorClient!.getContractResults(...args),
          getContractLogs: (
            ...args: Parameters<typeof mirrorClient.getContractLogs>
          ) => mirrorClient!.getContractLogs(...args),
          getTopicMessage: (
            ...args: Parameters<typeof mirrorClient.getTopicMessage>
          ) => mirrorClient!.getTopicMessage(...args),
          getTopicMessages: (
            ...args: Parameters<typeof mirrorClient.getTopicMessages>
          ) => mirrorClient!.getTopicMessages(...args),
          getToken: (...args: Parameters<typeof mirrorClient.getToken>) =>
            mirrorClient!.getToken(...args),
          getAccount: (...args: Parameters<typeof mirrorClient.getAccount>) =>
            mirrorClient!.getAccount(...args),
          locateSettlementEvent: (event: CommerceAuditEvent) =>
            locateSettlementEvent(mirrorClient!, event),
          locateHcsEvent: (input: Parameters<typeof locateHcsEvent>[1]) =>
            locateHcsEvent(mirrorClient!, input),
          verifyCommerceEvent: (
            event: CommerceAuditEvent,
            hcs: { topicId: string; sequenceNumber?: number; limit?: number },
          ) => correlateCommerceEvent(mirrorClient!, event, hcs),
        }
      : undefined,
    close() {
      hederaClient?.close();
      const destroy = (provider as JsonRpcProvider | undefined)?.destroy;
      if (destroy) void destroy.call(provider);
    },
    toJSON() {
      return {
        network: config.network,
        capabilities: {
          settlement: !!config.settlement,
          audit: !!publisher,
          mirror: !!mirrorClient,
        },
      };
    },
  };
  return client;
}

/** Read escrow state through the server SDK without configuring any signer. */
export function createCommerceReader(config: {
  network: CommerceNetwork;
  rpcUrl?: string;
  contracts: { hbar: string; hts: string };
}) {
  const rpcUrl =
    config.rpcUrl ??
    (config.network === "testnet"
      ? "https://testnet.hashio.io/api"
      : "https://mainnet.hashio.io/api");
  const provider = new JsonRpcProvider(rpcUrl);
  const contracts = {
    hbar: address(config.contracts.hbar, "contracts.hbar"),
    hts: address(config.contracts.hts, "contracts.hts"),
  };
  return {
    async readPayment(kind: "hbar" | "hts", paymentId: string) {
      const chain = await provider.getNetwork();
      if (chain.chainId !== (config.network === "testnet" ? 296n : 295n))
        throw new ConfigurationError(
          "Reader RPC is connected to the wrong Hedera network.",
        );
      const id = validPositiveInteger(paymentId, "paymentId");
      const contract = new Contract(contracts[kind], ABI[kind], provider);
      try {
        const payment = await contract.getFunction("getPayment")(id);
        return {
          paymentId: id.toString(),
          payer: String(payment.payer),
          payee: String(payment.payee),
          arbiter: String(payment.arbiter),
          amount: String(payment.amount),
          tokenAddress: kind === "hts" ? String(payment.token) : null,
          deadline: String(payment.deadline),
          state: Number(payment.state),
        };
      } catch (cause) {
        throw new SettlementError(
          "Unable to read payment state from escrow.",
          undefined,
          { cause, status: "failed" },
        );
      }
    },
    close() {
      void provider.destroy();
    },
  };
}

export type {
  CommerceAuditEvent,
  CommerceAuditEventInput,
  EscrowPaymentSnapshot,
  EscrowSourceLog,
};
