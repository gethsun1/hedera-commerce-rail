import { expect } from "chai";
import { JsonRpcProvider, Wallet } from "ethers";
import { createBrowserCommerceClient } from "../src/browser";
import {
  assertPaymentTerms,
  hbarToWeibars,
  positiveInteger,
  validateHtsIdentity,
} from "../src/internal/settlement";
import { ValidationError } from "../src/errors";

describe("browser SDK entry", () => {
  it("shares exact denomination, identity, and stored-term validation", () => {
    expect(hbarToWeibars(1_000_000n)).eq(10_000_000_000_000_000n);
    expect(positiveInteger("1000000", "amount", ValidationError)).eq(
      1_000_000n,
    );
    expect(
      validateHtsIdentity(
        "0.0.10843331",
        "0x0000000000000000000000000000000000a574c3",
      ).type,
    ).eq("HTS_FUNGIBLE");
    expect(() =>
      assertPaymentTerms({ type: "HBAR" }, { type: "HTS_FUNGIBLE" }),
    ).to.throw(ValidationError);
  });

  it("accepts an externally supplied signer and never serializes signer data", async () => {
    const provider = new JsonRpcProvider("http://127.0.0.1:8545");
    const signer = new Wallet(`0x${"11".repeat(32)}`, provider);
    const client = createBrowserCommerceClient({
      network: "testnet",
      signer,
      contracts: {
        hbar: "0x85a038f7FB8E01EBD6F0E5B02791E57Bfb6aa260",
        hts: "0xa1069144BAc92E69634F8af332C92d053d9e72bb",
      },
    });
    expect(await client.account()).to.equal(await signer.getAddress());
    expect(JSON.stringify(client)).not.to.contain("privateKey");
    expect(JSON.stringify(client)).not.to.contain(signer.address);
    expect(client.toJSON()).to.deep.equal({
      network: "testnet",
      capabilities: { settlement: true },
    });
    await provider.destroy();
  });
});
