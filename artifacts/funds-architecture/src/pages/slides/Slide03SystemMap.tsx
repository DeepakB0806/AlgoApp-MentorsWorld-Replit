export default function Slide03SystemMap() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-bg">
      <div className="absolute inset-0 z-0 bp-grid" />

      <div className="absolute top-[3vh] left-[4vw] right-[4vw] z-10 flex justify-between items-start">
        <div>
          <div className="bp-label">DRAWING NO.</div>
          <div className="text-[1.5vw] font-display font-semibold text-text">MW-FA-003</div>
        </div>
        <div className="text-right">
          <div className="bp-label">SHEET</div>
          <div className="text-[1.5vw] font-display font-semibold text-text">03 / 10</div>
        </div>
      </div>

      <div className="absolute top-[11vh] left-[5vw] z-10">
        <div className="text-[4vw] font-display font-bold text-text leading-none tracking-tight mb-[0.5vh]">
          System Map
        </div>
        <div className="text-[2vw] font-body text-muted mb-[1.5vh]">High-level data flow — 5 components</div>
        <div className="w-[8vw] h-[0.3vh] bg-accent" />
      </div>

      <div className="absolute top-[22vh] left-[5vw] right-[5vw] z-10 flex gap-[3vw]">

        <div className="flex flex-col items-start" style={{ width: "35vw" }}>
          <div className="bp-label mb-[2vh]">WRITE PATH</div>

          <div className="bp-node w-full">
            <div className="bp-label">EXTERNAL</div>
            <div className="text-[2.4vw] font-display font-bold text-text leading-tight">Kotak Neo API</div>
            <div className="text-[1.8vw] font-body text-muted mt-[0.5vh]">EL.getLimits — funds query</div>
          </div>

          <div className="bp-arrow w-full py-[1.2vh]">↓</div>

          <div className="bp-node w-full">
            <div className="bp-label">CAPITAL MANAGER</div>
            <div className="text-[2.2vw] font-display font-bold text-text leading-tight">
              cm-kotak-neo-v3.ts
            </div>
            <div className="text-[1.8vw] font-body text-muted mt-[0.5vh]">
              refreshAllCapital · scheduleNextCapitalRefresh
            </div>
          </div>

          <div className="bp-arrow w-full py-[1.2vh]">↓</div>

          <div className="bp-node-green w-full">
            <div className="text-[1.3vw] font-body tracking-[0.25em] uppercase text-primary font-semibold mb-[0.5vh]">
              DATABASE (PostgreSQL)
            </div>
            <div className="text-[2.2vw] font-display font-bold text-primary leading-tight">
              broker_capital_snapshots
            </div>
            <div className="text-[1.8vw] font-body text-muted mt-[0.5vh]">
              one row per UCC · updated by all write paths
            </div>
          </div>
        </div>

        <div className="flex items-center justify-center" style={{ paddingTop: "16vh" }}>
          <div className="bp-arrow text-[3vw]">→</div>
        </div>

        <div className="flex flex-col justify-center gap-[3vh]" style={{ flex: 1, paddingTop: "8vh" }}>
          <div className="bp-label mb-[1vh]">CONSUMERS (READ)</div>

          <div className="bp-node">
            <div className="bp-label">TRADE ENGINE</div>
            <div className="text-[2.2vw] font-display font-bold text-text leading-tight">
              te-kotak-neo-v3.ts
            </div>
            <div className="text-[1.8vw] font-body text-muted mt-[0.5vh]">
              reads snapshot per signal · gating loop lines 311–367
            </div>
          </div>

          <div className="bp-node">
            <div className="bp-label">BROKER LINKING UI</div>
            <div className="text-[2.2vw] font-display font-bold text-text leading-tight">
              broker-linking.tsx
            </div>
            <div className="text-[1.8vw] font-body text-muted mt-[0.5vh]">
              60 s polling · per-plan running deduction display
            </div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 h-[0.5vh] z-10 bg-accent" />
    </div>
  );
}
