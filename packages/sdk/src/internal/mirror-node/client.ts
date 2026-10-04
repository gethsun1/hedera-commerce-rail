import { Interface } from "ethers";
import {
  parseCommerceAuditEvent,
  type CommerceAuditEvent,
} from "../hcs/schema";

export type MirrorNetwork = "testnet" | "mainnet";
export type MirrorErrorCode =
  | "NOT_FOUND"
  | "INVALID_REQUEST"
  | "RATE_LIMITED"
  | "UPSTREAM_ERROR"
  | "CONFIGURATION_ERROR";

export class MirrorNodeError extends Error {
  constructor(
    readonly code: MirrorErrorCode,
    message: string,
    readonly status?: number,
    readonly retryAfter?: string,
  ) {
    super(message);
    this.name = "MirrorNodeError";
  }
}

export type MirrorNodeConfig = {
  network: MirrorNetwork;
  baseUrl: string;
  topicId?: string;
};
export type MirrorPage<T> = { items: T[]; next: string | null };
export type MirrorTransaction = {
  network: MirrorNetwork;
  transactionId: string;
  transactionHash: string | null;
  consensusTimestamp: string | null;
  result: string | null;
  type: string | null;
  contractId: string | null;
  entityId: string | null;
  raw: Record<string, unknown>;
};
export type MirrorContract = {
  network: MirrorNetwork;
  contractId: string;
  evmAddress: string;
  deleted: boolean;
  createdTimestamp: string | null;
  bytecode: string | null;
  raw: Record<string, unknown>;
};
export type MirrorContractLog = {
  network: MirrorNetwork;
  contractId: string | null;
  contractAddress: string;
  transactionHash: string | null;
  consensusTimestamp: string | null;
  logIndex: number;
  data: string;
  topics: string[];
  decodedEvent: { name: string; args: Record<string, string | boolean> } | null;
  raw: Record<string, unknown>;
};
export type MirrorContractResult = {
  network: MirrorNetwork;
  transactionId: string | null;
  transactionHash: string | null;
  consensusTimestamp: string | null;
  result: string | null;
  partial: boolean;
  logs: MirrorContractLog[];
  raw: Record<string, unknown>;
};
export type MirrorTopicMessage = {
  network: MirrorNetwork;
  topicId: string;
  sequenceNumber: number;
  consensusTimestamp: string;
  transactionId: string | null;
  payerAccountId: string | null;
  event: CommerceAuditEvent | null;
  decodedPayload: string;
  raw: Record<string, unknown>;
};
export type MirrorToken = {
  network: MirrorNetwork;
  tokenId: string;
  evmAddress: string | null;
  name: string | null;
  symbol: string | null;
  type: string | null;
  decimals: string | null;
  totalSupply: string | null;
  raw: Record<string, unknown>;
};
export type MirrorAccount = {
  network: MirrorNetwork;
  accountId: string;
  evmAddress: string | null;
  balanceTinybars: string | null;
  deleted: boolean;
  raw: Record<string, unknown>;
};

const NETWORK_URLS: Record<MirrorNetwork, string> = {
  testnet: "https://testnet.mirrornode.hedera.com",
  mainnet: "https://mainnet.mirrornode.hedera.com",
};
const ENTITY_ID = /^\d+\.\d+\.\d+$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const TX_ID = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+)?@[0-9]+\.[0-9]{1,9}$/;
const TIMESTAMP = /^\d{1,10}(?:\.\d{1,9})?$/;
const MAX_PAGE_SIZE = 100;
const MAX_PAGES = 100;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
class MirrorResponseTooLargeError extends Error {}
const ESCROW_EVENTS = new Interface([
  "event PaymentCreated(uint256 indexed paymentId,address indexed payer,address indexed payee,address arbiter,uint256 amount,address asset,uint64 createdAt,uint64 deadline)",
  "event PaymentFunded(uint256 indexed paymentId,address indexed payer,uint256 amount,address asset)",
  "event PaymentReleased(uint256 indexed paymentId,address indexed caller,address indexed payee,uint256 amount,address asset)",
  "event PaymentRefunded(uint256 indexed paymentId,address indexed caller,address indexed payer,uint256 amount,address asset)",
  "event TokenPaymentCreated(uint256 indexed paymentId,address indexed token,address indexed payer,address payee,address arbiter,uint256 amount,uint64 createdAt,uint64 deadline)",
  "event TokenPaymentFunded(uint256 indexed paymentId,address indexed token,address indexed payer,uint256 amount)",
  "event TokenPaymentReleased(uint256 indexed paymentId,address indexed token,address indexed payee,address caller,uint256 amount)",
  "event TokenPaymentRefunded(uint256 indexed paymentId,address indexed token,address indexed payer,address caller,uint256 amount)",
  "event EscrowTokenAssociated(address indexed token)",
]);

export function readMirrorNodeConfig(
  env: NodeJS.ProcessEnv = process.env,
): MirrorNodeConfig {
  const network = env.HEDERA_NETWORK;
  if (network !== "testnet" && network !== "mainnet") {
    throw new MirrorNodeError(
      "CONFIGURATION_ERROR",
      "HEDERA_NETWORK must be testnet or mainnet for Mirror Node queries.",
    );
  }
  const baseUrl = env.MIRROR_NODE_BASE_URL?.trim() || NETWORK_URLS[network];
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new MirrorNodeError(
      "CONFIGURATION_ERROR",
      "MIRROR_NODE_BASE_URL must be a valid absolute URL.",
    );
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname !== "/" && parsed.pathname !== "")
  ) {
    throw new MirrorNodeError(
      "CONFIGURATION_ERROR",
      "MIRROR_NODE_BASE_URL must be an HTTPS origin without credentials, path, query, or fragment.",
    );
  }
  const topicId = env.HCS_TOPIC_ID?.trim();
  if (topicId && !ENTITY_ID.test(topicId))
    throw new MirrorNodeError(
      "CONFIGURATION_ERROR",
      "HCS_TOPIC_ID must use numeric shard.realm.number format.",
    );
  return {
    network,
    baseUrl: parsed.toString().replace(/\/$/, ""),
    ...(topicId ? { topicId } : {}),
  };
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MirrorNodeError(
      "UPSTREAM_ERROR",
      `Mirror Node returned malformed ${label}.`,
    );
  }
  return value as Record<string, unknown>;
}
function parseJsonPreservingLargeIntegers(text: string): unknown {
  let output = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length;) {
    const char = text[index];
    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      index += 1;
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
      index += 1;
      continue;
    }
    if (char === "-" || /\d/.test(char)) {
      let end = index + 1;
      while (end < text.length && !/[\s,}\]]/.test(text[end])) end += 1;
      const token = text.slice(index, end);
      if (
        /^-?\d+$/.test(token) &&
        BigInt(token) > BigInt(Number.MAX_SAFE_INTEGER)
      )
        output += JSON.stringify(token);
      else if (
        /^-?\d+$/.test(token) &&
        BigInt(token) < BigInt(Number.MIN_SAFE_INTEGER)
      )
        output += JSON.stringify(token);
      else output += token;
      index = end;
      continue;
    }
    output += char;
    index += 1;
  }
  return JSON.parse(output);
}
function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
function decodeMessage(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  ) {
    throw new MirrorNodeError(
      "UPSTREAM_ERROR",
      "Mirror Node topic message payload is malformed.",
    );
  }
  try {
    return Buffer.from(value, "base64").toString("utf8");
  } catch {
    throw new MirrorNodeError(
      "UPSTREAM_ERROR",
      "Mirror Node topic message payload is malformed.",
    );
  }
}
function normalizeLog(
  network: MirrorNetwork,
  value: unknown,
  parent: {
    contractId?: string | null;
    transactionHash?: string | null;
    timestamp?: string | null;
  } = {},
): MirrorContractLog {
  const raw = object(value, "contract log");
  if (
    typeof raw.address !== "string" ||
    !ADDRESS.test(raw.address) ||
    !Number.isSafeInteger(raw.index) ||
    typeof raw.data !== "string" ||
    !Array.isArray(raw.topics) ||
    !raw.topics.every((t) => typeof t === "string")
  ) {
    throw new MirrorNodeError(
      "UPSTREAM_ERROR",
      "Mirror Node returned a malformed contract log.",
    );
  }
  let decodedEvent: MirrorContractLog["decodedEvent"] = null;
  try {
    const parsed = ESCROW_EVENTS.parseLog({
      topics: raw.topics as string[],
      data: raw.data,
    });
    if (parsed) {
      const args: Record<string, string | boolean> = {};
      for (const [key, item] of Object.entries(parsed.args.toObject())) {
        if (typeof item === "bigint") args[key] = item.toString();
        else if (typeof item === "string" || typeof item === "boolean")
          args[key] = item;
      }
      decodedEvent = { name: parsed.name, args };
    }
  } catch {
    /* Unrecognized logs remain available as their raw EVM coordinates. */
  }
  return {
    network,
    contractId: stringOrNull(raw.contract_id) ?? parent.contractId ?? null,
    contractAddress: raw.address,
    transactionHash:
      typeof raw.transaction_hash === "string" &&
      HASH.test(raw.transaction_hash)
        ? raw.transaction_hash
        : (parent.transactionHash ?? null),
    consensusTimestamp:
      typeof raw.timestamp === "string" && TIMESTAMP.test(raw.timestamp)
        ? raw.timestamp
        : (parent.timestamp ?? null),
    logIndex: raw.index as number,
    data: raw.data,
    topics: raw.topics as string[],
    decodedEvent,
    raw,
  };
}
function normalizeTransaction(
  network: MirrorNetwork,
  value: unknown,
): MirrorTransaction {
  const raw = object(value, "transaction");
  if (typeof raw.transaction_id !== "string")
    throw new MirrorNodeError(
      "UPSTREAM_ERROR",
      "Mirror Node transaction is missing transaction_id.",
    );
  return {
    network,
    transactionId: raw.transaction_id,
    transactionHash:
      typeof raw.transaction_hash === "string" &&
      HASH.test(raw.transaction_hash)
        ? raw.transaction_hash
        : typeof raw.hash === "string" && HASH.test(raw.hash)
          ? raw.hash
          : null,
    consensusTimestamp:
      typeof raw.consensus_timestamp === "string" &&
      TIMESTAMP.test(raw.consensus_timestamp)
        ? raw.consensus_timestamp
        : null,
    result: stringOrNull(raw.result),
    type: stringOrNull(raw.name),
    contractId: stringOrNull(raw.entity_id),
    entityId: stringOrNull(raw.entity_id),
    raw,
  };
}
function normalizeContract(
  network: MirrorNetwork,
  value: unknown,
): MirrorContract {
  const raw = object(value, "contract");
  if (
    typeof raw.contract_id !== "string" ||
    !ENTITY_ID.test(raw.contract_id) ||
    typeof raw.evm_address !== "string" ||
    !ADDRESS.test(`0x${raw.evm_address.replace(/^0x/, "")}`) ||
    typeof raw.deleted !== "boolean"
  ) {
    throw new MirrorNodeError(
      "UPSTREAM_ERROR",
      "Mirror Node returned a malformed contract.",
    );
  }
  return {
    network,
    contractId: raw.contract_id,
    evmAddress: raw.evm_address.startsWith("0x")
      ? raw.evm_address
      : `0x${raw.evm_address}`,
    deleted: raw.deleted === true,
    createdTimestamp: stringOrNull(raw.created_timestamp),
    bytecode: stringOrNull(raw.bytecode),
    raw,
  };
}
function normalizeContractResult(
  network: MirrorNetwork,
  value: unknown,
  partial = false,
): MirrorContractResult {
  const raw = object(value, "contract result");
  if (raw.logs !== undefined && !Array.isArray(raw.logs))
    throw new MirrorNodeError(
      "UPSTREAM_ERROR",
      "Mirror Node returned malformed contract result logs.",
    );
  const hash =
    typeof raw.transaction_hash === "string"
      ? raw.transaction_hash
      : typeof raw.hash === "string"
        ? raw.hash
        : null;
  const timestamp = stringOrNull(raw.timestamp);
  const contractId = stringOrNull(raw.contract_id);
  return {
    network,
    transactionId: stringOrNull(raw.transaction_id),
    transactionHash: hash && HASH.test(hash) ? hash : null,
    consensusTimestamp:
      timestamp && TIMESTAMP.test(timestamp) ? timestamp : null,
    result: stringOrNull(raw.result) ?? stringOrNull(raw.status),
    partial,
    logs: ((raw.logs as unknown[] | undefined) ?? []).map((log) =>
      normalizeLog(network, log, {
        contractId,
        transactionHash: hash,
        timestamp,
      }),
    ),
    raw,
  };
}
function normalizeTopicMessage(
  network: MirrorNetwork,
  topicId: string,
  value: unknown,
): MirrorTopicMessage {
  const raw = object(value, "topic message");
  if (
    raw.topic_id !== topicId ||
    !Number.isSafeInteger(raw.sequence_number) ||
    typeof raw.consensus_timestamp !== "string" ||
    !TIMESTAMP.test(raw.consensus_timestamp)
  ) {
    throw new MirrorNodeError(
      "UPSTREAM_ERROR",
      "Mirror Node returned a malformed topic message coordinate.",
    );
  }
  const decodedPayload = decodeMessage(raw.message);
  let event: CommerceAuditEvent | null = null;
  try {
    event = parseCommerceAuditEvent(decodedPayload);
  } catch {
    /* Preserve non-commerce messages as decoded payloads. */
  }
  const chunk =
    raw.chunk_info && typeof raw.chunk_info === "object"
      ? (raw.chunk_info as Record<string, unknown>)
      : {};
  const initial =
    chunk.initial_transaction_id &&
    typeof chunk.initial_transaction_id === "object"
      ? (chunk.initial_transaction_id as Record<string, unknown>)
      : {};
  const validStart = stringOrNull(initial.transaction_valid_start);
  const payer =
    stringOrNull(initial.account_id) ?? stringOrNull(raw.payer_account_id);
  const derivedTransactionId =
    payer && validStart ? `${payer}@${validStart}` : null;
  return {
    network,
    topicId,
    sequenceNumber: raw.sequence_number as number,
    consensusTimestamp: raw.consensus_timestamp,
    transactionId: stringOrNull(raw.transaction_id) ?? derivedTransactionId,
    payerAccountId: stringOrNull(raw.payer_account_id) ?? payer,
    event,
    decodedPayload,
    raw,
  };
}
function normalizeToken(network: MirrorNetwork, value: unknown): MirrorToken {
  const raw = object(value, "token");
  if (typeof raw.token_id !== "string" || !ENTITY_ID.test(raw.token_id))
    throw new MirrorNodeError(
      "UPSTREAM_ERROR",
      "Mirror Node returned a malformed token.",
    );
  const tokenNumber = raw.token_id.split(".")[2];
  const evmAddress =
    stringOrNull(raw.evm_address) ??
    `0x${BigInt(tokenNumber).toString(16).padStart(40, "0")}`;
  return {
    network,
    tokenId: raw.token_id,
    evmAddress,
    name: stringOrNull(raw.name),
    symbol: stringOrNull(raw.symbol),
    type: stringOrNull(raw.type),
    decimals: stringOrNull(raw.decimals),
    totalSupply: stringOrNull(raw.total_supply),
    raw,
  };
}

export function createMirrorNodeClient(
  config = readMirrorNodeConfig(),
  fetcher: typeof fetch = fetch,
) {
  let base: URL;
  try {
    base = new URL(config.baseUrl);
  } catch {
    throw new MirrorNodeError(
      "CONFIGURATION_ERROR",
      "Mirror Node base URL must be a valid HTTPS origin.",
    );
  }
  if (
    (config.network !== "testnet" && config.network !== "mainnet") ||
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    (base.pathname !== "/" && base.pathname !== "")
  ) {
    throw new MirrorNodeError(
      "CONFIGURATION_ERROR",
      "Mirror Node configuration must use a network and HTTPS origin without credentials, path, query, or fragment.",
    );
  }
  async function requestWithStatus(
    pathOrUrl: string,
  ): Promise<{ data: unknown; status: number }> {
    let url: URL;
    try {
      url = new URL(pathOrUrl, `${base.toString().replace(/\/$/, "")}/`);
    } catch {
      throw new MirrorNodeError(
        "INVALID_REQUEST",
        "Mirror Node request path is invalid.",
      );
    }
    if (
      url.origin !== base.origin ||
      !url.pathname.startsWith(`${base.pathname.replace(/\/$/, "")}/api/v1/`)
    ) {
      throw new MirrorNodeError(
        "INVALID_REQUEST",
        "Mirror Node pagination URL escaped the configured API base.",
      );
    }
    let response: Response;
    try {
      response = await fetcher(url, {
        headers: { accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new MirrorNodeError(
        "UPSTREAM_ERROR",
        "Mirror Node request failed at the network layer.",
      );
    }
    if (!response.ok) {
      const code: MirrorErrorCode =
        response.status === 404
          ? "NOT_FOUND"
          : response.status === 400
            ? "INVALID_REQUEST"
            : response.status === 429
              ? "RATE_LIMITED"
              : "UPSTREAM_ERROR";
      throw new MirrorNodeError(
        code,
        `Mirror Node request failed with HTTP ${response.status}.`,
        response.status,
        response.headers.get("retry-after") ?? undefined,
      );
    }
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES)
      throw new MirrorNodeError(
        "UPSTREAM_ERROR",
        "Mirror Node response exceeded the 5 MiB safety limit.",
        response.status,
      );
    let body: string;
    try {
      if (!response.body) body = await response.text();
      else {
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_RESPONSE_BYTES) {
              await reader.cancel();
              throw new MirrorResponseTooLargeError();
            }
            chunks.push(value);
          }
        } finally {
          reader.releaseLock();
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        body = new TextDecoder().decode(bytes);
      }
    } catch (cause) {
      if (cause instanceof MirrorResponseTooLargeError)
        throw new MirrorNodeError(
          "UPSTREAM_ERROR",
          "Mirror Node response exceeded the 5 MiB safety limit.",
          response.status,
        );
      throw new MirrorNodeError(
        "UPSTREAM_ERROR",
        "Mirror Node response body could not be read.",
        response.status,
      );
    }
    try {
      return {
        data: parseJsonPreservingLargeIntegers(body),
        status: response.status,
      };
    } catch {
      throw new MirrorNodeError(
        "UPSTREAM_ERROR",
        "Mirror Node returned malformed JSON.",
      );
    }
  }
  async function request(pathOrUrl: string): Promise<unknown> {
    return (await requestWithStatus(pathOrUrl)).data;
  }
  async function page<T>(
    path: string,
    normalize: (item: unknown) => T,
  ): Promise<MirrorPage<T>> {
    const response = object(await request(path), "collection response");
    if (
      !Array.isArray(
        response["logs"] ??
          response["transactions"] ??
          response["messages"] ??
          response["tokens"] ??
          response["results"],
      )
    ) {
      throw new MirrorNodeError(
        "UPSTREAM_ERROR",
        "Mirror Node collection response is missing its items array.",
      );
    }
    const key = ["logs", "transactions", "messages", "tokens", "results"].find(
      (k) => Array.isArray(response[k]),
    )!;
    const links =
      response.links && typeof response.links === "object"
        ? (response.links as Record<string, unknown>)
        : {};
    const next =
      typeof links.next === "string" && links.next.length > 0
        ? links.next
        : null;
    return { items: (response[key] as unknown[]).map(normalize), next };
  }
  async function allPages<T>(
    path: string,
    normalize: (item: unknown) => T,
    limit = 100,
  ): Promise<T[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 10_000)
      throw new MirrorNodeError(
        "INVALID_REQUEST",
        "Mirror Node result limit must be between 1 and 10000.",
      );
    const items: T[] = [];
    let next: string | null = path;
    let pages = 0;
    while (next && items.length < limit && pages++ < MAX_PAGES) {
      const result: MirrorPage<T> = await page<T>(next, normalize);
      items.push(...result.items.slice(0, limit - items.length));
      next = result.next;
    }
    if (next && pages > MAX_PAGES)
      throw new MirrorNodeError(
        "UPSTREAM_ERROR",
        "Mirror Node pagination exceeded the safety page limit.",
      );
    return items;
  }
  function entity(value: string, kind: string) {
    if (!ENTITY_ID.test(value))
      throw new MirrorNodeError(
        "INVALID_REQUEST",
        `${kind} ID must use numeric shard.realm.number format.`,
      );
  }
  return {
    config,
    getTransaction: async (idOrHash: string) => {
      if (!TX_ID.test(idOrHash))
        throw new MirrorNodeError(
          "INVALID_REQUEST",
          "Transaction ID must use shard.realm.account@seconds.nanoseconds format.",
        );
      const [account, timestamp] = idOrHash.split("@");
      const [seconds, nanos] = timestamp.split(".");
      const mirrorId = `${account}-${seconds}-${nanos.padEnd(9, "0")}`;
      const result = await request(
        `/api/v1/transactions/${encodeURIComponent(mirrorId)}`,
      );
      const raw = object(result, "transaction response");
      const entries = Array.isArray(raw.transactions)
        ? raw.transactions
        : [raw];
      if (entries.length === 0)
        throw new MirrorNodeError(
          "NOT_FOUND",
          "Mirror Node transaction was not found.",
          404,
        );
      return entries.map((item) => normalizeTransaction(config.network, item));
    },
    getContract: async (idOrAddress: string) => {
      if (!ENTITY_ID.test(idOrAddress) && !ADDRESS.test(idOrAddress))
        throw new MirrorNodeError(
          "INVALID_REQUEST",
          "Contract ID/address is malformed.",
        );
      return normalizeContract(
        config.network,
        await request(`/api/v1/contracts/${encodeURIComponent(idOrAddress)}`),
      );
    },
    getContractResults: async (txHashOrId: string) => {
      if (!TX_ID.test(txHashOrId) && !HASH.test(txHashOrId))
        throw new MirrorNodeError(
          "INVALID_REQUEST",
          "Transaction ID/hash is malformed.",
        );
      const response = await requestWithStatus(
        `/api/v1/contracts/results/${encodeURIComponent(txHashOrId)}`,
      );
      return normalizeContractResult(
        config.network,
        response.data,
        response.status === 206,
      );
    },
    getContractLogs: (contractIdOrAddress: string, limit = 100) => {
      if (
        !ENTITY_ID.test(contractIdOrAddress) &&
        !ADDRESS.test(contractIdOrAddress)
      )
        throw new MirrorNodeError(
          "INVALID_REQUEST",
          "Contract ID/address is malformed.",
        );
      if (!Number.isInteger(limit) || limit < 1 || limit > 10_000)
        throw new MirrorNodeError(
          "INVALID_REQUEST",
          "Mirror Node result limit must be between 1 and 10000.",
        );
      const path = `/api/v1/contracts/${encodeURIComponent(contractIdOrAddress)}/results/logs?limit=${Math.min(limit, MAX_PAGE_SIZE)}&order=asc`;
      return {
        getPage: (next?: string) =>
          page(next ?? path, (item) => normalizeLog(config.network, item)),
        getAll: () =>
          allPages(path, (item) => normalizeLog(config.network, item), limit),
      };
    },
    getTopicMessages: (topicId = config.topicId ?? "", limit = 100) => {
      if (!topicId)
        throw new MirrorNodeError(
          "CONFIGURATION_ERROR",
          "Pass a topic ID or configure HCS_TOPIC_ID before querying topic messages.",
        );
      entity(topicId, "Topic");
      if (!Number.isInteger(limit) || limit < 1 || limit > 10_000)
        throw new MirrorNodeError(
          "INVALID_REQUEST",
          "Mirror Node result limit must be between 1 and 10000.",
        );
      const path = `/api/v1/topics/${topicId}/messages?limit=${Math.min(limit, MAX_PAGE_SIZE)}&order=asc`;
      return {
        getPage: (next?: string) =>
          page(next ?? path, (item) =>
            normalizeTopicMessage(config.network, topicId, item),
          ),
        getAll: () =>
          allPages(
            path,
            (item) => normalizeTopicMessage(config.network, topicId, item),
            limit,
          ),
      };
    },
    getTopicMessage: async (topicId: string, sequence: number) => {
      entity(topicId, "Topic");
      if (!Number.isSafeInteger(sequence) || sequence < 1)
        throw new MirrorNodeError(
          "INVALID_REQUEST",
          "Topic sequence must be a positive integer.",
        );
      return normalizeTopicMessage(
        config.network,
        topicId,
        await request(`/api/v1/topics/${topicId}/messages/${sequence}`),
      );
    },
    getToken: async (tokenId: string) => {
      entity(tokenId, "Token");
      return normalizeToken(
        config.network,
        await request(`/api/v1/tokens/${tokenId}`),
      );
    },
    getAccount: async (accountId: string) => {
      entity(accountId, "Account");
      const raw = object(
        await request(`/api/v1/accounts/${accountId}`),
        "account",
      );
      const balance =
        raw.balance && typeof raw.balance === "object"
          ? (raw.balance as Record<string, unknown>)
          : {};
      if (
        typeof raw.account !== "string" ||
        !ENTITY_ID.test(raw.account) ||
        typeof raw.deleted !== "boolean"
      )
        throw new MirrorNodeError(
          "UPSTREAM_ERROR",
          "Mirror Node returned a malformed account.",
        );
      return {
        network: config.network,
        accountId: raw.account,
        evmAddress: stringOrNull(raw.evm_address),
        balanceTinybars:
          typeof balance.balance === "number" ||
          typeof balance.balance === "string"
            ? String(balance.balance)
            : null,
        deleted: raw.deleted === true,
        raw,
      } satisfies MirrorAccount;
    },
  };
}
