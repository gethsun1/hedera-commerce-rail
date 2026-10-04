export function createAuditAuthorizationMessage(input: {
  transactionHash: string;
  contractAddress: string;
  paymentId: string;
  assetType: "HBAR" | "HTS_FUNGIBLE";
}) {
  return [
    "Hedera Commerce audit publication request",
    "network:hedera-testnet",
    `transaction:${input.transactionHash.toLowerCase()}`,
    `contract:${input.contractAddress.toLowerCase()}`,
    `payment:${input.paymentId}`,
    `asset:${input.assetType}`,
  ].join("\n");
}
