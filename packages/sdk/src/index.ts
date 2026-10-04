import { buildCommerceClient } from "./client";
import type { CommerceClientConfig } from "./client";

export function createCommerceClient(config: CommerceClientConfig) {
  return buildCommerceClient(config);
}

export { createCommerceReader } from "./client";

export type {
  CommerceAsset,
  CommerceClientConfig,
  CommerceEventInput,
  CommerceNetwork,
  CommerceOperation,
  CreatePaymentInput,
  HbarAsset,
  HbarCreatePaymentInput,
  HbarEscrowApi,
  HcsConfig,
  HtsCreatePaymentInput,
  HtsEscrowApi,
  HtsFungibleAsset,
  SettlementConfig,
  SettlementResult,
  TransactionStatus,
} from "./client";
export type {
  CommerceAuditEvent,
  CommerceAuditEventInput,
  EscrowPaymentSnapshot,
  EscrowSourceLog,
} from "./internal/hcs/schema";
export { normalizeEscrowLog } from "./internal/hcs/schema";
export { createAuditAuthorizationMessage } from "./internal/audit-authorization";
export {
  AuditError,
  CommerceSdkError,
  ConfigurationError,
  SettlementError,
  ValidationError,
} from "./errors";
export { MirrorNodeError } from "./internal/mirror-node/client";
