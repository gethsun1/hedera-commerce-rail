import {
  buildCommerceClient,
  type CommerceClientConfig,
  type CommerceClientTestAdapters,
} from "../client";

export function createCommerceClientWithAdapters(
  config: CommerceClientConfig,
  adapters: CommerceClientTestAdapters,
) {
  return buildCommerceClient(config, adapters);
}
