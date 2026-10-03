import * as dotenv from "dotenv";
import * as path from "path";

// Workspace scripts run from this package directory; load the repository-level
// environment first, then fill any missing values from a package-local file.
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env") });
import { Wallet } from "ethers";
import password from "@inquirer/password";
import { spawn } from "child_process";
import { config } from "hardhat";

/**
 * Unencrypts the private key and runs the hardhat deploy command
 */
async function main() {
  const networkIndex = process.argv.indexOf("--network");
  const networkName = networkIndex !== -1 ? process.argv[networkIndex + 1] : config.defaultNetwork;

  if (networkName === "localhost" || networkName === "hardhat") {
    // Deploy command on the localhost network
    const hardhat = spawn("hardhat", ["deploy", ...process.argv.slice(2)], {
      stdio: "inherit",
      env: process.env,
      shell: process.platform === "win32",
    });

    hardhat.on("exit", code => {
      process.exit(code || 0);
    });
    return;
  }

  const encryptedKey = process.env.DEPLOYER_PRIVATE_KEY_ENCRYPTED;

  if (!process.env.HEDERA_PRIVATE_KEY && !encryptedKey) {
    console.log("🚫️ You don't have a deployer account. Run `npm run account:generate` or `npm run account:import` first");
    return;
  }

  if (!process.env.HEDERA_PRIVATE_KEY) {
    const pass = await password({ message: "Enter password to decrypt private key:" });
    try {
      const wallet = await Wallet.fromEncryptedJson(encryptedKey!, pass);
      process.env.__RUNTIME_DEPLOYER_PRIVATE_KEY = wallet.privateKey;
    } catch {
      console.error("Failed to decrypt private key. Wrong password?");
      process.exit(1);
    }
  }

  const hardhat = spawn("hardhat", ["deploy", ...process.argv.slice(2)], {
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });

  hardhat.on("exit", code => {
    process.exit(code || 0);
  });
}

main().catch(console.error);
