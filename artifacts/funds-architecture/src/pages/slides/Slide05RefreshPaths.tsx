export default function Slide05RefreshPaths() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-bg">
      <div className="absolute inset-0 z-0 bp-grid" />

      <div className="absolute top-[3vh] left-[4vw] right-[4vw] z-10 flex justify-between items-start">
        <div>
          <div className="bp-label">DRAWING NO.</div>
          <div className="text-[1.5vw] font-display font-semibold text-text">MW-FA-005</div>
        </div>
        <div className="text-right">
          <div className="bp-label">SHEET</div>
          <div className="text-[1.5vw] font-display font-semibold text-text">05 / 10</div>
        </div>
      </div>

      <div className="absolute top-[11vh] left-[5vw] z-10">
        <div className="text-[4vw] font-display font-bold text-text leading-none tracking-tight mb-[0.5vh]">
          Refresh Paths — Write Side
        </div>
        <div className="text-[2vw] font-body text-muted mb-[1.5vh]">Three triggers, one pipeline, one destination</div>
        <div className="w-[8vw] h-[0.3vh] bg-accent" />
      </div>

      <div className="absolute top-[22vh] left-[5vw] right-[5vw] z-10 flex gap-[2vw] items-stretch">

        <div className="flex flex-col gap-[2vh]" style={{ width: "33vw" }}>
          <div className="bp-label mb-[0.5vh]">TRIGGERS</div>

          <div className="bp-node-amber">
            <div className="text-[1.5vw] font-body text-accent font-semibold uppercase tracking-wider mb-[0.5vh]">
              (A) Daily 09:00 IST Sweep
            </div>
            <div className="text-[2vw] font-body text-text leading-snug">
              scheduleNextCapitalRefresh → refreshAllCapital · all active UCCs at market open
            </div>
          </div>

          <div className="bp-node-amber">
            <div className="text-[1.5vw] font-body text-accent font-semibold uppercase tracking-wider mb-[0.5vh]">
              (B) Intraday Every 5 Min
            </div>
            <div className="text-[2vw] font-body text-text leading-snug">
              setInterval · gated to 09:15–15:30 IST · same batched pipeline · ~2% duty cycle at 1000 UCCs
            </div>
          </div>

          <div className="bp-node-amber">
            <div className="text-[1.5vw] font-body text-accent font-semibold uppercase tracking-wider mb-[0.5vh]">
              (C) On-Demand Refresh Button
            </div>
            <div className="text-[2vw] font-body text-text leading-snug">
              POST /api/broker-capital-snapshots/:id/refresh · 30 s server debounce per UCC
            </div>
          </div>
        </div>

        <div className="flex items-center justify-center px-[1vw]">
          <div className="flex flex-col items-center gap-[1vh]">
            <div className="bp-arrow text-[3vw]">→</div>
            <div className="text-[1.5vw] font-body text-muted text-center" style={{ maxWidth: "12vw" }}>
              all reuse same pipeline
            </div>
          </div>
        </div>

        <div className="flex flex-col justify-center gap-[2vh]" style={{ flex: 1 }}>
          <div className="bp-label mb-[0.5vh]">SHARED PIPELINE</div>

          <div className="bp-node flex flex-col gap-[1.5vh]">
            <div className="text-[2vw] font-body text-text font-semibold">
              EL.getLimits(ucc)
            </div>
            <div className="bp-arrow justify-start text-[2vw] py-0">↓</div>
            <div className="text-[2vw] font-body text-text font-semibold">
              extractAvailableCash(limits)
            </div>
            <div className="bp-arrow justify-start text-[2vw] py-0">↓</div>
            <div className="text-[2vw] font-body text-text font-semibold">
              upsertCapitalSnapshot(ucc, cash)
            </div>
            <div className="bp-arrow justify-start text-[2vw] py-0">↓</div>
            <div className="bp-node-green">
              <div className="text-[1.4vw] font-body text-primary font-semibold uppercase tracking-wider mb-[0.3vh]">
                DESTINATION
              </div>
              <div className="text-[2vw] font-display font-bold text-primary leading-tight">
                broker_capital_snapshots
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 h-[0.5vh] z-10 bg-accent" />
    </div>
  );
}
