import { AccountId, Client, PrivateKey } from "@hiero-ledger/sdk";

export const HEDERA_NETWORKS = {
  local: {
    name: "local",
    sdkNetwork: "local-node",
  },
  testnet: {
    name: "testnet",
    chainId: 296,
    rpcUrl: "https://testnet.hashio.io/api",
    mirrorNodeUrl: "https://testnet.mirrornode.hedera.com",
    sdkNetwork: "testnet",
  },
  mainnet: {
    name: "mainnet",
    chainId: 295,
    rpcUrl: "https://mainnet.hashio.io/api",
    mirrorNodeUrl: "https://mainnet.mirrornode.hedera.com",
    sdkNetwork: "mainnet",
  },
} as const;

export type HederaNetworkName = keyof typeof HEDERA_NETWORKS;
export type HederaEnvironment = {
  network: HederaNetworkName;
  accountId?: AccountId;
  privateKey?: PrivateKey;
};

export function parseHederaNetwork(
  value: string | undefined,
): HederaNetworkName {
  if (!value)
    throw new Error("HEDERA_NETWORK is required (local, testnet, or mainnet).");
  if (Object.prototype.hasOwnProperty.call(HEDERA_NETWORKS, value))
    return value as HederaNetworkName;
  throw new Error(
    `Unsupported HEDERA_NETWORK '${value}'. Use local, testnet, or mainnet.`,
  );
}

export function readHederaEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): HederaEnvironment {
  const network = parseHederaNetwork(env.HEDERA_NETWORK);
  if (network === "local") return { network };

  if (!env.HEDERA_ACCOUNT_ID) {
    throw new Error(
      `HEDERA_ACCOUNT_ID is required when HEDERA_NETWORK=${network}.`,
    );
  }
  if (!env.HEDERA_PRIVATE_KEY) {
    throw new Error(
      `HEDERA_PRIVATE_KEY is required when HEDERA_NETWORK=${network}.`,
    );
  }

  let accountId: AccountId;
  try {
    accountId = AccountId.fromString(env.HEDERA_ACCOUNT_ID);
  } catch {
    throw new Error(
      "HEDERA_ACCOUNT_ID must be a valid Hedera account ID such as 0.0.12345.",
    );
  }

  let privateKey: PrivateKey;
  try {
    const encodedKey = env.HEDERA_PRIVATE_KEY.replace(/^0x/i, "");
    // EVM account keys are raw secp256k1 hex; select their type explicitly so
    // the SDK does not misinterpret the bytes as an ED25519 key.
    privateKey = /^[0-9a-fA-F]{64}$/.test(encodedKey)
      ? PrivateKey.fromStringECDSA(encodedKey)
      : /^(302e|3030)/i.test(encodedKey)
        ? PrivateKey.fromStringDer(encodedKey)
        : PrivateKey.fromStringED25519(encodedKey);
  } catch {
    throw new Error(
      "HEDERA_PRIVATE_KEY is malformed. Supply a valid Hedera private key; its value is never displayed.",
    );
  }

  return { network, accountId, privateKey };
}

export function createHederaClient(
  environment = readHederaEnvironment(),
): Client {
  const client =
    environment.network === "local"
      ? Client.forLocalNode()
      : environment.network === "testnet"
        ? Client.forTestnet()
        : Client.forMainnet();
  if (environment.accountId && environment.privateKey) {
    client.setOperator(environment.accountId, environment.privateKey);
  }
  return client;
}
