export default function Slide04BuildStatus() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-bg">
      <div className="absolute inset-0 z-0 bp-grid" />

      <div className="absolute top-[3vh] left-[4vw] right-[4vw] z-10 flex justify-between items-start">
        <div>
          <div className="bp-label">DRAWING NO.</div>
          <div className="text-[1.5vw] font-display font-semibold text-text">MW-FA-004</div>
        </div>
        <div className="text-right">
          <div className="bp-label">SHEET</div>
          <div className="text-[1.5vw] font-display font-semibold text-text">04 / 10</div>
        </div>
      </div>

      <div className="absolute top-[11vh] left-[5vw] z-10">
        <div className="text-[4vw] font-display font-bold text-text leading-none tracking-tight mb-[0.5vh]">
          What's Built vs. What's New
        </div>
        <div className="text-[2vw] font-body text-muted mb-[1.5vh]">
          Same system map · color-coded by implementation status
        </div>
        <div className="w-[8vw] h-[0.3vh] bg-accent" />
      </div>

      <div className="absolute top-[22vh] left-[5vw] right-[5vw] z-10 flex gap-[3vw]">

        <div className="flex-1 bp-node-green flex flex-col">
          <div className="flex items-center gap-[1.5vw] mb-[3vh]">
            <div className="w-[1.5vw] h-[1.5vw] rounded-full bg-primary flex-none" />
            <div
              className="text-[1.4vw] font-body tracking-[0.2em] uppercase font-semibold"
              style={{ color: "#10b981" }}
            >
              ALREADY BUILT (GREEN)
            </div>
          </div>

          <div className="mb-[2.5vh]">
            <div className="text-[1.5vw] font-body text-primary font-semibold uppercase tracking-wider mb-[0.5vh]">
              broker_capital_snapshots table
            </div>
            <div className="text-[2vw] font-body text-text leading-snug">
              Schema in shared/schema.ts · no changes needed
            </div>
          </div>

          <div className="mb-[2.5vh]">
            <div className="text-[1.5vw] font-body text-primary font-semibold uppercase tracking-wider mb-[0.5vh]">
              Capital Manager daily scheduler
            </div>
            <div className="text-[2vw] font-body text-text leading-snug">
              09:00 IST sweep · refreshAllCapital · all active UCCs
            </div>
          </div>

          <div className="mb-[2.5vh]">
            <div className="text-[1.5vw] font-body text-primary font-semibold uppercase tracking-wider mb-[0.5vh]">
              runWithConcurrency (cap = te_ucc_concurrency)
            </div>
            <div className="text-[2vw] font-body text-text leading-snug">
              Batched, rate-limited · default 50 parallel UCCs
            </div>
          </div>

          <div>
            <div className="text-[1.5vw] font-body text-primary font-semibold uppercase tracking-wider mb-[0.5vh]">
              TE gating loop
            </div>
            <div className="text-[2vw] font-body text-text leading-snug">
              Sort by rank · 1.5× expiry uplift · deduct or skip · lines 311–367
            </div>
          </div>
        </div>

        <div className="flex-1 bp-node-amber flex flex-col">
          <div className="flex items-center gap-[1.5vw] mb-[3vh]">
            <div className="w-[1.5vw] h-[1.5vw] rounded-full bg-accent flex-none" />
            <div
              className="text-[1.4vw] font-body tracking-[0.2em] uppercase font-semibold"
              style={{ color: "#f59e0b" }}
            >
              NEW IN THIS TASK (AMBER)
            </div>
          </div>

          <div className="mb-[2vh]">
            <div className="text-[1.5vw] font-body text-accent font-semibold uppercase tracking-wider mb-[0.4vh]">
              Intraday scheduler (cm-kotak-neo-v3.ts)
            </div>
            <div className="text-[2vw] font-body text-text leading-snug">
              setInterval · 10 min · gated to 09:15–15:30 IST market hours
            </div>
          </div>

          <div className="mb-[2vh]">
            <div className="text-[1.5vw] font-body text-accent font-semibold uppercase tracking-wider mb-[0.4vh]">
              Post-fill hook from TE per UCC
            </div>
            <div className="text-[2vw] font-body text-text leading-snug">
              te-kotak-neo-v3.ts triggers refreshCapitalForUcc after each fill
            </div>
          </div>

          <div className="mb-[2vh]">
            <div className="text-[1.5vw] font-body text-accent font-semibold uppercase tracking-wider mb-[0.4vh]">
              Single-UCC refresh helper
            </div>
            <div className="text-[2vw] font-body text-text leading-snug">
              refreshCapitalForUcc(ucc) — reuses existing EL pipeline
            </div>
          </div>

          <div className="mb-[2vh]">
            <div className="text-[1.5vw] font-body text-accent font-semibold uppercase tracking-wider mb-[0.4vh]">
              GET + POST snapshot endpoints
            </div>
            <div className="text-[2vw] font-body text-text leading-snug">
              GET /api/broker-capital-snapshots · POST .../refresh (30 s debounce)
            </div>
          </div>

          <div>
            <div className="text-[1.5vw] font-body text-accent font-semibold uppercase tracking-wider mb-[0.4vh]">
              Frontend gating mirror
            </div>
            <div className="text-[2vw] font-body text-text leading-snug">
              broker-linking.tsx · same sort + uplift logic as TE · 60 s polling
            </div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 h-[0.5vh] z-10 bg-accent" />
    </div>
  );
}
