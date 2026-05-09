export default function Slide06ReadPath() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-bg">
      <div className="absolute inset-0 z-0 bp-grid" />

      <div className="absolute top-[3vh] left-[4vw] right-[4vw] z-10 flex justify-between items-start">
        <div>
          <div className="bp-label">DRAWING NO.</div>
          <div className="text-[1.5vw] font-display font-semibold text-text">MW-FA-006</div>
        </div>
        <div className="text-right">
          <div className="bp-label">SHEET</div>
          <div className="text-[1.5vw] font-display font-semibold text-text">06 / 10</div>
        </div>
      </div>

      <div className="absolute top-[11vh] left-[5vw] z-10">
        <div className="text-[4vw] font-display font-bold text-text leading-none tracking-tight mb-[0.5vh]">
          UI Read Path
        </div>
        <div className="text-[2vw] font-body text-muted mb-[1.5vh]">Browser polling → gating mirror → per-plan card render</div>
        <div className="w-[8vw] h-[0.3vh] bg-accent" />
      </div>

      <div className="absolute top-[24vh] left-[5vw] right-[5vw] z-10">

        <div className="flex items-stretch gap-0 mb-[4vh]">

          <div className="bp-node flex-none" style={{ width: "18vw" }}>
            <div className="bp-label">CLIENT</div>
            <div className="text-[2.2vw] font-display font-bold text-text leading-tight">Browser</div>
            <div className="text-[1.8vw] font-body text-muted mt-[0.5vh]">broker-linking.tsx</div>
          </div>

          <div className="bp-arrow px-[1.5vw]">→</div>

          <div className="bp-node-amber flex-none" style={{ width: "22vw" }}>
            <div className="text-[1.3vw] font-body text-accent tracking-[0.2em] uppercase font-semibold mb-[0.5vh]">
              ENDPOINT (60 s POLL)
            </div>
            <div className="text-[1.9vw] font-display font-bold text-text leading-tight">
              GET /api/broker-capital-snapshots
            </div>
            <div className="text-[1.7vw] font-body text-muted mt-[0.5vh]">
              single DB read · ≤1000 rows · returns Array&lt;snapshot&gt;
            </div>
          </div>

          <div className="bp-arrow px-[1.5vw]">→</div>

          <div className="bp-node flex-none" style={{ width: "18vw" }}>
            <div className="bp-label">FRONTEND</div>
            <div className="text-[2vw] font-display font-bold text-text leading-tight">Gating Mirror</div>
            <div className="text-[1.7vw] font-body text-muted mt-[0.5vh]">
              Map&lt;brokerConfigId, snapshot&gt; · O(1) lookup
            </div>
          </div>

          <div className="bp-arrow px-[1.5vw]">→</div>

          <div className="bp-node flex-none" style={{ width: "18vw" }}>
            <div className="bp-label">OUTPUT</div>
            <div className="text-[2vw] font-display font-bold text-text leading-tight">Plan Card Render</div>
            <div className="text-[1.7vw] font-body text-muted mt-[0.5vh]">green / red · running total · stale badge</div>
          </div>
        </div>

        <div className="bp-node mt-[2vh]">
          <div className="text-[1.5vw] font-body text-muted tracking-[0.2em] uppercase mb-[1.5vh]">PER-PLAN CARD ELEMENTS</div>
          <div className="flex gap-[4vw]">
            <div>
              <div className="text-[1.5vw] font-body text-accent font-semibold mb-[0.5vh]">Broker header chip</div>
              <div className="text-[2vw] font-body text-text">
                Funds: ₹X,XX,XXX · Snapshot N min old · [Refresh]
              </div>
            </div>
            <div>
              <div className="text-[1.5vw] font-body text-accent font-semibold mb-[0.5vh]">Per-plan line</div>
              <div className="text-[2vw] font-body text-text">
                Funds after Rank N: ₹X,XX,XXX · green if fits, red if TE will skip
              </div>
            </div>
            <div>
              <div className="text-[1.5vw] font-body text-accent font-semibold mb-[0.5vh]">Expiry note</div>
              <div className="text-[2vw] font-body text-text">
                "(1.5× expiry uplift applied)" — shown only on expiry day
              </div>
            </div>
          </div>
        </div>

        <div className="mt-[2vh] text-[1.8vw] font-body text-muted">
          Forward-compatible: when broker_configs.userId lands, only the server-side filter changes — frontend code unchanged.
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 h-[0.5vh] z-10 bg-accent" />
    </div>
  );
}
