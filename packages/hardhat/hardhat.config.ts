import * as dotenv from "dotenv";
import * as path from "path";

// Workspace scripts run from this package directory; load the repository-level
// environment first, then fill any missing values from a package-local file.
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config({ path: path.resolve(__dirname, ".env") });

import { HardhatUserConfig, task } from "hardhat/config";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import "solidity-coverage";
// Only load the Hedera forking plugin when starting the local node (npm run hardhat:chain / npm run hardhat:fork).
// Deploying to an already-running node doesn't need it and would fail with EADDRINUSE.
if (process.env.HEDERA_FORKING === "true") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- conditional plugin load
  require("@hashgraph/system-contracts-forking/plugin");
}
import "hardhat-deploy";
import "hardhat-deploy-ethers";

import generateTsAbis from "./scripts/generateTsAbis";
import { HEDERA_NETWORKS } from "./lib/hedera/config";

// Optional override for the Hedera EVM fork; named Hedera networks use their network table URLs.
const hederaRpcUrl = process.env.HEDERA_RPC_URL || HEDERA_NETWORKS.testnet.rpcUrl;

// Only provide a signer when explicitly configured. In particular, never use Hardhat's
// public development key to sign transactions sent to Hedera.
const deployerPrivateKey = process.env.__RUNTIME_DEPLOYER_PRIVATE_KEY ?? process.env.HEDERA_PRIVATE_KEY;
const requestedNetwork = process.argv.includes("--network")
  ? process.argv[process.argv.indexOf("--network") + 1]
  : undefined;
if (
  (requestedNetwork === "hederaTestnet" || requestedNetwork === "hederaMainnet") &&
  !deployerPrivateKey &&
  !process.env.DEPLOYER_PRIVATE_KEY_ENCRYPTED
) {
  throw new Error(
    `HEDERA_PRIVATE_KEY is required for ${requestedNetwork}. Configure a dedicated account key before running this command.`,
  );
}

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    ],
  },
  defaultNetwork: "hardhat",
  namedAccounts: {
    deployer: {
      default: 0,
    },
  },
  networks: {
    hardhat: {
      forking: {
        url: hederaRpcUrl,
        // @ts-expect-error - custom property for hedera-forking plugin
        chainId: 296,
        workerPort: 10001,
      },
    },
    hederaTestnet: {
      url: HEDERA_NETWORKS.testnet.rpcUrl,
      accounts: deployerPrivateKey ? [deployerPrivateKey] : [],
      chainId: HEDERA_NETWORKS.testnet.chainId,
    },
    hederaMainnet: {
      url: HEDERA_NETWORKS.mainnet.rpcUrl,
      accounts: deployerPrivateKey ? [deployerPrivateKey] : [],
      chainId: HEDERA_NETWORKS.mainnet.chainId,
    },
  },
  // Contract verification: use `npm run verify:contract` (scripts/verifySourcify.ts), which talks
  // directly to the Sourcify API v2. @nomicfoundation/hardhat-verify is intentionally not used:
  // its Hardhat 2-compatible line only speaks the Sourcify API v1, which Sourcify removed in
  // July 2026. See: https://docs.sourcify.dev/blog/api-v1-brownouts/
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v6",
  },
};

// Extend the deploy task to also generate TypeScript ABIs after deployment.
task("deploy").setAction(async (args, hre, runSuper) => {
  await runSuper(args);
  await generateTsAbis(hre);
});

export default config;
