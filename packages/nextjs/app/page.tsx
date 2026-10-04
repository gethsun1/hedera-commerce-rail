import Link from "next/link";
import { getReferenceActivity } from "./reference-data";
import { SettlementPanel } from "./settlement-panel";
import { RainbowKitCustomConnectButton } from "~~/components/scaffold-hbar";
import { ArrowUpRightIcon, CheckCircleIcon, ClockIcon } from "@heroicons/react/24/outline";

export const dynamic = "force-dynamic";

const rails = [
  { code: "01", title: "HBAR escrow", detail: "Native settlement with exact tinybar accounting." },
  { code: "02", title: "HTS fungible tokens", detail: "Token smallest units, association and allowance rules." },
  { code: "03", title: "HCS audit stream", detail: "A deterministic Commerce event identity recorded to a topic." },
  { code: "04", title: "Mirror Node", detail: "Indexed records correlated to their settlement source." },
];

export default async function Home() {
  const activity = await getReferenceActivity();
  return (
    <main className="commerce-shell">
      <header className="commerce-nav">
        <Link href="/" className="brand">
          <span className="brand-mark">H</span>
          <span>
            HEDERA <b>COMMERCE RAIL</b>
          </span>
        </Link>
        <nav aria-label="Main navigation">
          <a href="#rails">The rail</a>
          <a href="#provenance">Provenance</a>
          <Link href="/debug">
            Contract tools <ArrowUpRightIcon />
          </Link>
        </nav>
        <span className="network-pill">
          <i /> HEDERA TESTNET
        </span>
        <div className="commerce-nav-wallet" aria-label="Wallet connection">
          <RainbowKitCustomConnectButton />
        </div>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">
            <span /> PROGRAMMABLE COMMERCE PAYMENTS
          </div>
          <h1>
            Payments with
            <br />
            <em>proof built in.</em>
          </h1>
          <p>
            Escrow for real commerce flows on Hedera. Set the terms, settle in HBAR or HTS, then follow every transition
            from contract event to public audit record.
          </p>
          <div className="hero-actions">
            <a className="primary-action" href="#provenance">
              Explore Testnet activity <ArrowUpRightIcon />
            </a>
            <a className="text-action" href="#rails">
              How the rail works <span>↓</span>
            </a>
          </div>
          <div className="hero-note">
            <CheckCircleIcon /> Contract state is authoritative <span>·</span> HCS is the audit trail
          </div>
        </div>
      </section>

      <section className="rail-section" id="rails">
        <div className="section-heading">
          <div>
            <div className="eyebrow">ONE RAIL, TWO ASSETS</div>
            <h2>Built around the settlement.</h2>
          </div>
          <p>A focused reference implementation for developers building commerce on Hedera.</p>
        </div>
        <div className="rail-grid">
          {rails.map(rail => (
            <article className="rail-item" key={rail.code}>
              <span>{rail.code}</span>
              <div>
                <h3>{rail.title}</h3>
                <p>{rail.detail}</p>
              </div>
              <ArrowUpRightIcon />
            </article>
          ))}
        </div>
      </section>

      <section className="provenance-section" id="provenance">
        <div className="section-heading">
          <div>
            <div className="eyebrow">LIVE INDEXED RECORDS</div>
            <h2>Follow the evidence.</h2>
          </div>
          <span className="real-tag">
            <i /> REAL HEDERA TESTNET DATA
          </span>
        </div>
        <p className="section-intro">
          Existing audit messages, read through the Commerce SDK and correlated with Mirror Node records. Indexing can
          lag consensus.
        </p>
        {!activity.configured ? (
          <div className="empty-state">
            <ClockIcon />
            <div>
              <b>Audit stream is not configured</b>
              <p>Set HCS_TOPIC_ID in the server environment to display indexed Testnet events.</p>
            </div>
          </div>
        ) : activity.error ? (
          <div className="empty-state">
            <ClockIcon />
            <div>
              <b>Mirror Node records are temporarily unavailable</b>
              <p>{activity.error}</p>
            </div>
          </div>
        ) : activity.events.length === 0 ? (
          <div className="empty-state">
            <ClockIcon />
            <div>
              <b>No Commerce events found yet</b>
              <p>The topic is configured; new messages appear here after Mirror Node indexing.</p>
            </div>
          </div>
        ) : (
          <div className="event-list">
            {activity.events.map(entry => (
              <article className="event-row" key={entry.event.eventId}>
                <div className="event-symbol">{entry.verified ? <CheckCircleIcon /> : <ClockIcon />}</div>
                <div className="event-main">
                  <div className="event-title">
                    <b>{entry.event.eventType.replace("payment.", "Payment ")}</b>
                    <span>{entry.verified ? "LOCATED & CORRELATED" : "INDEXING / PARTIAL"}</span>
                  </div>
                  <p>
                    Payment {entry.event.paymentId} <span>·</span>{" "}
                    {entry.event.assetType === "HBAR" ? "HBAR" : `HTS · ${entry.event.assetId}`} <span>·</span>{" "}
                    {entry.event.amount} {entry.event.assetType === "HBAR" ? "tinybars" : "token smallest units"}
                  </p>
                  <code className="event-coordinates">
                    TX {entry.event.sourceTxHash} · CONTRACT {entry.event.contractAddress}
                  </code>
                  <code>{entry.event.eventId}</code>
                </div>
                <div className="event-meta">
                  <small>HCS SEQUENCE</small>
                  <b>{entry.sequence}</b>
                  <small>CONSENSUS</small>
                  <b>{entry.consensus}</b>
                </div>
                <a
                  className="tx-link"
                  href={`https://hashscan.io/testnet/transaction/${encodeURIComponent(entry.event.sourceTxHash)}`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="View settlement transaction on HashScan"
                >
                  <ArrowUpRightIcon />
                </a>
              </article>
            ))}
          </div>
        )}
        <div className="provenance-chain">
          <span>PAYMENT</span>
          <i>→</i>
          <span>CONTRACT TX</span>
          <i>→</i>
          <span>COMMERCE EVENT</span>
          <i>→</i>
          <span>HCS</span>
          <i>→</i>
          <b>MIRROR NODE</b>
        </div>
      </section>
      <SettlementPanel />
      <footer className="commerce-footer">
        <span>
          HEDERA COMMERCE RAIL <b>·</b> REFERENCE APPLICATION
        </span>
        <span>Escrow is not dispute arbitration. Contract rules govern settlement.</span>
      </footer>
    </main>
  );
}
