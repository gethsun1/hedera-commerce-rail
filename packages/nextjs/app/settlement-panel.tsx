"use client";

import { useState } from "react";
import { createAuditAuthorizationMessage, createBrowserCommerceClient } from "@hedera-commerce/sdk/browser";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { BrowserProvider, type Eip1193Provider } from "ethers";
import { useAccount, useDisconnect } from "wagmi";

const HBAR_CONTRACT = "0x85a038f7FB8E01EBD6F0E5B02791E57Bfb6aa260";
const HTS_CONTRACT = "0xa1069144BAc92E69634F8af332C92d053d9e72bb";
const HTS_TOKEN = {
  type: "HTS_FUNGIBLE" as const,
  tokenId: "0.0.10843331",
  tokenAddress: "0x0000000000000000000000000000000000a574c3",
};

export function SettlementPanel() {
  const { address, chain, connector, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { openConnectModal } = useConnectModal();
  const [payee, setPayee] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentId, setPaymentId] = useState("");
  const [record, setRecord] = useState<{
    payer: string;
    payee: string;
    arbiter: string;
    amount: string;
    deadline: string;
    state: number;
  }>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [txHash, setTxHash] = useState("");
  const [createHash, setCreateHash] = useState("");
  const [audit, setAudit] = useState<{
    status: string;
    eventId?: string;
    sequence?: string;
    consensus?: string;
    mirrorLocated?: boolean;
    error?: string;
  }>();
  const [auditRequest, setAuditRequest] = useState<Record<string, string>>();
  const correctNetwork = chain?.id === 296;

  const requestAudit = async (
    result: { transactionHash: string; contractAddress: string },
    id: string,
    assetType: "HBAR" | "HTS_FUNGIBLE",
  ) => {
    const body = {
      transactionHash: result.transactionHash,
      contractAddress: result.contractAddress,
      paymentId: id,
      assetType,
    };
    setAuditRequest(body);
    setAudit({ status: "pending" });
    try {
      if (!connector) throw new Error("Reconnect the wallet to authorize audit publication.");
      const walletProvider = await connector.getProvider();
      const signer = await new BrowserProvider(walletProvider as Eip1193Provider).getSigner();
      const signature = await signer.signMessage(createAuditAuthorizationMessage(body));
      const response = await fetch("/api/audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, signature }),
      });
      const value = await response.json();
      setAudit({
        status: value.status ?? "failed",
        eventId: value.event?.eventId ?? value.eventId,
        sequence: value.publication?.sequenceNumber,
        consensus: value.consensusTimestamp,
        mirrorLocated: value.mirrorNode === "located",
        error: value.error,
      });
    } catch {
      setAudit({
        status: "failed",
        error:
          "Audit authorization was declined or publication failed. Settlement remains confirmed; retry audit publication.",
      });
    }
  };

  const client = async () => {
    if (!connector) throw new Error("Connect a wallet first.");
    const provider = await connector.getProvider();
    const ethersProvider = new BrowserProvider(provider as Eip1193Provider);
    const signer = await ethersProvider.getSigner();
    return createBrowserCommerceClient({
      network: "testnet",
      signer,
      contracts: { hbar: HBAR_CONTRACT, hts: HTS_CONTRACT },
    });
  };
  const act = async (operation: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    setTxHash("");
    try {
      await operation();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Wallet transaction failed.");
    } finally {
      setBusy(false);
    }
  };
  const refresh = async (id = paymentId) => {
    const sdk = await client();
    const payment = await sdk.escrow.hbar.read(id);
    setRecord(payment);
    setPaymentId(id);
  };
  const createAndFund = () =>
    act(async () => {
      if (!address) throw new Error("Connect a wallet first.");
      if (!correctNetwork) throw new Error("Switch wallet to Hedera Testnet (chain ID 296).");
      const sdk = await client();
      const created = await sdk.escrow.hbar.create({
        payee,
        amount,
        deadline: BigInt(Math.floor(Date.now() / 1000) + 86400),
      });
      if (!created.paymentId) throw new Error("Confirmed create did not return a payment ID.");
      setCreateHash(created.transactionHash);
      setTxHash(created.transactionHash);
      setPaymentId(created.paymentId);
      const funded = await sdk.escrow.hbar.fund(created.paymentId, { type: "HBAR" }, amount);
      setTxHash(funded.transactionHash);
      await refresh(created.paymentId);
      setMessage(`Payment ${created.paymentId} created and funded. Both transactions are confirmed.`);
    });
  const lifecycle = (kind: "release" | "refund") =>
    act(async () => {
      const sdk = await client();
      const payment = await sdk.escrow.hbar.read(paymentId);
      const result = await sdk.escrow.hbar[kind](paymentId, payment.asset);
      setTxHash(result.transactionHash);
      void requestAudit(result, paymentId, "HBAR");
      await refresh();
      setMessage(`${kind === "release" ? "Release" : "Refund"} confirmed.`);
    });

  return (
    <section className="settlement-panel" aria-labelledby="settlement-title">
      <div>
        <div className="eyebrow">
          <span /> WALLET AUTHORIZED SETTLEMENT
        </div>
        <h2 id="settlement-title">HBAR payment</h2>
        <p>
          Transactions are signed by the connected wallet through the Commerce SDK. Amounts use tinybars (1 HBAR =
          100,000,000 tinybars).
        </p>
      </div>
      {!isConnected ? (
        <button className="primary-action" onClick={() => openConnectModal?.()}>
          Connect wallet
        </button>
      ) : (
        <>
          <div className="wallet-status">
            <span>{address}</span>
            <b>
              {chain?.name} · {chain?.id}
            </b>
            <button className="text-action" onClick={() => disconnect()}>
              Disconnect
            </button>
          </div>
          {!correctNetwork && <p role="alert">Wrong network. Switch to Hedera Testnet (296) before settlement.</p>}
          <div className="settlement-form">
            <label>
              Payee EVM address
              <input value={payee} onChange={e => setPayee(e.target.value)} placeholder="0x…" />
            </label>
            <label>
              Amount in tinybars
              <input
                inputMode="numeric"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="100000000"
              />
            </label>
            <button
              className="primary-action"
              disabled={busy || !correctNetwork || !payee || !amount}
              onClick={createAndFund}
            >
              {busy ? "Waiting for wallet…" : "Create and fund"}
            </button>
          </div>
          <div className="settlement-form">
            <label>
              Existing payment ID
              <input value={paymentId} onChange={e => setPaymentId(e.target.value)} placeholder="Payment ID" />
            </label>
            <button
              className="text-action"
              disabled={busy || !correctNetwork || !paymentId}
              onClick={() => act(() => refresh())}
            >
              Read on-chain state
            </button>
            {record && (
              <>
                <p>
                  State: {(["Created", "Funded", "Released", "Refunded"] as const)[record.state] ?? "Unknown"} · Payer{" "}
                  {record.payer} · Payee {record.payee} · {record.amount} tinybars · deadline{" "}
                  {new Date(Number(record.deadline) * 1000).toLocaleString()}
                </p>
                <button
                  className="primary-action"
                  disabled={
                    busy ||
                    !correctNetwork ||
                    record.state !== 1 ||
                    (record.payer.toLowerCase() !== address?.toLowerCase() &&
                      record.arbiter.toLowerCase() !== address?.toLowerCase())
                  }
                  onClick={() => lifecycle("release")}
                >
                  Release
                </button>
                <button
                  className="text-action"
                  disabled={
                    busy ||
                    !correctNetwork ||
                    record.state !== 1 ||
                    !(
                      (record.payer.toLowerCase() === address?.toLowerCase() &&
                        Date.now() / 1000 > Number(record.deadline)) ||
                      record.arbiter.toLowerCase() === address?.toLowerCase()
                    )
                  }
                  onClick={() => lifecycle("refund")}
                >
                  Refund
                </button>
              </>
            )}
          </div>
        </>
      )}
      {message && <p role="status">{message}</p>}
      {txHash && (
        <p>
          Transaction:{" "}
          <a href={`https://hashscan.io/testnet/transaction/${txHash}`} target="_blank" rel="noreferrer">
            {txHash}
          </a>
        </p>
      )}
      <p>
        Escrow contract: <code>{HBAR_CONTRACT}</code>
      </p>
      {createHash && createHash !== txHash && (
        <p>
          Create transaction:{" "}
          <a href={`https://hashscan.io/testnet/transaction/${createHash}`} target="_blank" rel="noreferrer">
            {createHash}
          </a>
        </p>
      )}
      <div className="audit-status" aria-live="polite">
        <b>
          Audit ·{" "}
          {audit?.status === "published"
            ? "Published"
            : audit?.status === "pending"
              ? "Mirror Node indexing pending"
              : audit?.status === "failed"
                ? "Publish failed"
                : "Awaiting confirmed settlement"}
        </b>
        <span>
          Mirror Node ·{" "}
          {audit?.mirrorLocated
            ? "Contract event located"
            : audit?.status === "pending"
              ? "Indexing pending"
              : "Not checked"}
        </span>
        {audit?.eventId && <code>Event ID {audit.eventId}</code>}
        {audit?.sequence && <span>Topic sequence {audit.sequence}</span>}
        {audit?.consensus && <span>Consensus {audit.consensus}</span>}
        {audit?.error && <span>{audit.error}</span>}
        {auditRequest && audit?.status !== "published" && (
          <button
            className="text-action"
            onClick={() =>
              requestAudit(
                { transactionHash: auditRequest.transactionHash, contractAddress: auditRequest.contractAddress },
                auditRequest.paymentId,
                auditRequest.assetType as "HBAR" | "HTS_FUNGIBLE",
              )
            }
          >
            Retry audit lookup / publication
          </button>
        )}
      </div>
      <HtsSettlementPanel connected={isConnected} address={address} chainId={chain?.id} connector={connector} />
    </section>
  );
}

function HtsSettlementPanel({
  connected,
  address,
  chainId,
  connector,
}: {
  connected: boolean;
  address?: `0x${string}`;
  chainId?: number;
  connector?: ReturnType<typeof useAccount>["connector"];
}) {
  const [payee, setPayee] = useState("");
  const [amount, setAmount] = useState("1000000");
  const [paymentId, setPaymentId] = useState("");
  const [payment, setPayment] = useState<{
    payer: string;
    payee: string;
    arbiter: string;
    amount: string;
    deadline: string;
    state: number;
  }>();
  const [status, setStatus] = useState("");
  const [tx, setTx] = useState("");
  const [auditState, setAuditState] = useState("");
  const [busy, setBusy] = useState(false);
  const sdk = async () => {
    if (!connector) throw new Error("Connect a wallet first.");
    const provider = new BrowserProvider((await connector.getProvider()) as Eip1193Provider);
    return createBrowserCommerceClient({
      network: "testnet",
      signer: await provider.getSigner(),
      contracts: { hbar: HBAR_CONTRACT, hts: HTS_CONTRACT },
    });
  };
  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setStatus("");
    try {
      await operation();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "HTS operation failed.");
    } finally {
      setBusy(false);
    }
  };
  const refresh = async (id = paymentId) => {
    const client = await sdk();
    const current = await client.escrow.hts.read(id, HTS_TOKEN);
    setPayment(current);
    setPaymentId(id);
  };
  const auditConfirmed = (result: { transactionHash: string; contractAddress: string }, id: string) => {
    setTx(result.transactionHash);
    setAuditState("Mirror Node indexing pending");
    void (async () => {
      try {
        if (!connector) throw new Error("Reconnect the wallet to authorize audit publication.");
        const walletProvider = await connector.getProvider();
        const signer = await new BrowserProvider(walletProvider as Eip1193Provider).getSigner();
        const auditInput = {
          transactionHash: result.transactionHash,
          contractAddress: result.contractAddress,
          paymentId: id,
          assetType: "HTS_FUNGIBLE" as const,
        };
        const signature = await signer.signMessage(createAuditAuthorizationMessage(auditInput));
        const response = await fetch("/api/audit", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...auditInput, signature }),
        });
        const value = await response.json();
        setAuditState(
          value.status === "published"
            ? `Mirror Node located · HCS published · event ${value.event?.eventId} · sequence ${value.publication?.sequenceNumber ?? "pending"} · consensus ${value.consensusTimestamp ?? "indexing pending"}`
            : `${value.status ?? "failed"} · ${value.error ?? "Retry audit publication."}`,
        );
      } catch {
        setAuditState("Audit authorization was declined or publication failed · settlement remains confirmed.");
      }
    })();
  };
  return (
    <div className="hts-panel">
      <div className="eyebrow">HTS FUNGIBLE TOKEN REFERENCE</div>
      <h3>Token payment · 0.0.10843331</h3>
      <p>
        Testnet disposable token, six decimals. 1 token = 1,000,000 smallest units. The connected payer must own enough
        tokens and associate this token to their account. Association and approval are signed by that wallet; the escrow
        contract also needs association before receiving tokens. No account ownership is assumed.
      </p>
      {!connected ? (
        <p>Connect a Hedera wallet to use the HTS reference flow.</p>
      ) : (
        <>
          <p>
            Connected payer: <code>{address}</code> · Network{" "}
            {chainId === 296 ? "Hedera Testnet (296)" : `chain ${chainId ?? "unknown"}`}
          </p>
          {chainId === 296 && (
            <div className="settlement-form">
              <button
                className="text-action"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const result = await (await sdk()).escrow.hts.associateAccount!(HTS_TOKEN);
                    setTx(result.transactionHash);
                    setStatus("Your token association is confirmed (or already associated).");
                  })
                }
              >
                Associate my token account
              </button>
              <button
                className="text-action"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const result = await (await sdk()).escrow.hts.associateToken!(HTS_TOKEN);
                    setTx(result.transactionHash);
                    setStatus("Escrow token association confirmed.");
                  })
                }
              >
                Associate escrow
              </button>
              <label>
                Payee EVM address
                <input value={payee} onChange={e => setPayee(e.target.value)} placeholder="0x…" />
              </label>
              <label>
                Amount in token smallest units
                <input inputMode="numeric" value={amount} onChange={e => setAmount(e.target.value)} />
              </label>
              <button
                className="primary-action"
                disabled={busy || !payee || !amount}
                onClick={() =>
                  run(async () => {
                    const recipient = payee;
                    const quantity = amount;
                    const client = await sdk();
                    const result = await client.escrow.hts.create({
                      payee: recipient,
                      amount: quantity,
                      token: HTS_TOKEN,
                      deadline: BigInt(Math.floor(Date.now() / 1000) + 86400),
                    });
                    const id = result.paymentId!;
                    setPaymentId(id);
                    await refresh(id);
                    setStatus(`Payment ${id} created. Approve the exact amount, then fund.`);
                  })
                }
              >
                Create HTS payment
              </button>
              <label>
                Payment ID
                <input value={paymentId} onChange={e => setPaymentId(e.target.value)} placeholder="Payment ID" />
              </label>
              <button className="text-action" disabled={busy || !paymentId} onClick={() => run(() => refresh())}>
                Read payment state
              </button>
              {payment && (
                <>
                  <p>
                    State: {(["Created", "Funded", "Released", "Refunded"] as const)[payment.state] ?? "Unknown"} ·
                    payer {payment.payer} · payee {payment.payee} · {payment.amount} smallest units
                  </p>
                  {payment.state === 0 && payment.payer.toLowerCase() === address?.toLowerCase() && (
                    <>
                      <button
                        className="text-action"
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            const result = await (
                              await sdk()
                            ).escrow.hts.approve!(paymentId, HTS_TOKEN, payment.amount);
                            setTx(result.transactionHash);
                            setStatus("Payer allowance confirmed for the escrow.");
                          })
                        }
                      >
                        Approve exact token allowance
                      </button>
                      <button
                        className="primary-action"
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            const client = await sdk();
                            await client.escrow.hts.fund(paymentId, HTS_TOKEN, payment.amount);
                            await refresh();
                            setStatus("Funding confirmed.");
                          })
                        }
                      >
                        Fund payment
                      </button>
                    </>
                  )}
                  {payment.state === 1 &&
                    (payment.payer.toLowerCase() === address?.toLowerCase() ||
                      payment.arbiter.toLowerCase() === address?.toLowerCase()) && (
                      <>
                        <button
                          className="primary-action"
                          disabled={busy}
                          onClick={() =>
                            run(async () => {
                              const client = await sdk();
                              const result = await client.escrow.hts.release(paymentId, HTS_TOKEN);
                              auditConfirmed(result, paymentId);
                              await refresh();
                              setStatus("Release confirmed.");
                            })
                          }
                        >
                          Release
                        </button>
                        <button
                          className="text-action"
                          disabled={
                            busy ||
                            (payment.arbiter.toLowerCase() !== address?.toLowerCase() &&
                              Date.now() / 1000 <= Number(payment.deadline))
                          }
                          onClick={() =>
                            run(async () => {
                              const client = await sdk();
                              const result = await client.escrow.hts.refund(paymentId, HTS_TOKEN);
                              auditConfirmed(result, paymentId);
                              await refresh();
                              setStatus("Refund confirmed.");
                            })
                          }
                        >
                          Refund (deadline or arbiter rules apply)
                        </button>
                      </>
                    )}
                </>
              )}
            </div>
          )}
        </>
      )}
      {status && <p role="status">{status}</p>}
      {tx && (
        <p>
          Transaction{" "}
          <a href={`https://hashscan.io/testnet/transaction/${tx}`} target="_blank" rel="noreferrer">
            {tx}
          </a>
        </p>
      )}
      <p>
        Escrow contract: <code>{HTS_CONTRACT}</code>
      </p>
      {auditState && <p>Audit / verification: {auditState}</p>}
    </div>
  );
}
