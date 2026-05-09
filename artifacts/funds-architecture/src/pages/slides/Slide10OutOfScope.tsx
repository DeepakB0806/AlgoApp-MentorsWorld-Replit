export default function Slide10OutOfScope() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-bg">
      <div className="absolute inset-0 z-0 bp-grid" />

      <div className="absolute top-[3vh] left-[4vw] right-[4vw] z-10 flex justify-between items-start">
        <div>
          <div className="bp-label">DRAWING NO.</div>
          <div className="text-[1.5vw] font-display font-semibold text-text">MW-FA-010</div>
        </div>
        <div className="text-right">
          <div className="bp-label">SHEET</div>
          <div className="text-[1.5vw] font-display font-semibold text-text">10 / 10</div>
        </div>
      </div>

      <div className="absolute top-[11vh] left-[5vw] z-10">
        <div className="text-[4vw] font-display font-bold text-text leading-none tracking-tight mb-[0.5vh]">
          What This Task Does Not Do
        </div>
        <div className="text-[2vw] font-body text-muted mb-[1.5vh]">Explicit scope boundary — deferred to future tasks</div>
        <div className="w-[8vw] h-[0.3vh] bg-accent" />
      </div>

      <div className="absolute top-[22vh] left-[5vw] right-[5vw] z-10 flex gap-[4vw]">

        <div className="flex flex-col gap-[2.5vh]" style={{ width: "52vw" }}>

          <div className="bp-node flex items-start gap-[2vw]">
            <div className="text-[3vw] font-display font-bold text-muted flex-none leading-none mt-[0.5vh]">01</div>
            <div>
              <div className="text-[2.2vw] font-display font-bold text-text leading-tight mb-[0.5vh]">
                Auto-disable plans on negative balance
              </div>
              <div className="text-[2vw] font-body text-muted leading-snug">
                Guardrail that pauses plans when running balance goes below zero — separate task
              </div>
            </div>
          </div>

          <div className="bp-node flex items-start gap-[2vw]">
            <div className="text-[3vw] font-display font-bold text-muted flex-none leading-none mt-[0.5vh]">02</div>
            <div>
              <div className="text-[2.2vw] font-display font-bold text-text leading-tight mb-[0.5vh]">
                Per-leg margin breakdown
              </div>
              <div className="text-[2vw] font-body text-muted leading-snug">
                Showing individual leg margins inside the running deduction — out of scope
              </div>
            </div>
          </div>

          <div className="bp-node flex items-start gap-[2vw]">
            <div className="text-[3vw] font-display font-bold text-muted flex-none leading-none mt-[0.5vh]">03</div>
            <div>
              <div className="text-[2.2vw] font-display font-bold text-text leading-tight mb-[0.5vh]">
                Cross-broker portfolio aggregation
              </div>
              <div className="text-[2vw] font-body text-muted leading-snug">
                Summing capital across multiple broker accounts — not in scope
              </div>
            </div>
          </div>

          <div className="bp-node flex items-start gap-[2vw]">
            <div className="text-[3vw] font-display font-bold text-muted flex-none leading-none mt-[0.5vh]">04</div>
            <div>
              <div className="text-[2.2vw] font-display font-bold text-text leading-tight mb-[0.5vh]">
                Multi-tenancy migration
              </div>
              <div className="text-[2vw] font-body text-muted leading-snug">
                Moving broker_configs to per-user ownership — independent task
              </div>
            </div>
          </div>

          <div className="bp-node flex items-start gap-[2vw]">
            <div className="text-[3vw] font-display font-bold text-muted flex-none leading-none mt-[0.5vh]">05</div>
            <div>
              <div className="text-[2.2vw] font-display font-bold text-text leading-tight mb-[0.5vh]">
                Capital snapshot history and charting
              </div>
              <div className="text-[2vw] font-body text-muted leading-snug">
                Historical capital curve or balance trend graphs — future enhancement
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col justify-between" style={{ flex: 1 }}>
          <div className="bp-node-green flex-1 flex flex-col justify-center">
            <div className="text-[1.4vw] font-body text-primary tracking-[0.2em] uppercase font-semibold mb-[2vh]">
              WHAT THIS TASK DOES DO
            </div>
            <div className="flex flex-col gap-[1.8vh]">
              <div className="flex items-start gap-[1vw]">
                <div className="text-[2vw] text-primary flex-none mt-[0.2vh]">+</div>
                <div className="text-[2vw] font-body text-text leading-snug">GET + POST snapshot endpoints</div>
              </div>
              <div className="flex items-start gap-[1vw]">
                <div className="text-[2vw] text-primary flex-none mt-[0.2vh]">+</div>
                <div className="text-[2vw] font-body text-text leading-snug">Intraday 5-min scheduler (cm_intraday_refresh_mins setting)</div>
              </div>
              <div className="flex items-start gap-[1vw]">
                <div className="text-[2vw] text-primary flex-none mt-[0.2vh]">+</div>
                <div className="text-[2vw] font-body text-text leading-snug">On-demand Refresh button (30 s debounce)</div>
              </div>
              <div className="flex items-start gap-[1vw]">
                <div className="text-[2vw] text-primary flex-none mt-[0.2vh]">+</div>
                <div className="text-[2vw] font-body text-text leading-snug">Frontend gating mirror (bit-identical to TE)</div>
              </div>
              <div className="flex items-start gap-[1vw]">
                <div className="text-[2vw] text-primary flex-none mt-[0.2vh]">+</div>
                <div className="text-[2vw] font-body text-text leading-snug">Funds chip + per-plan running deduction UI</div>
              </div>
            </div>
          </div>

          <div className="mt-[2vh] text-[1.8vw] font-body text-muted">
            Frozen files: te-kotak-neo-v3.ts · smc-kotak-neo-v3.ts · tl-kotak-neo-v3.ts · el-kotak-neo-v3.ts · shared/schema.ts
          </div>
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 h-[0.5vh] z-10 bg-accent" />

      <div className="absolute bottom-[2.5vh] left-[4vw] z-10">
        <div className="bp-label">REVISION</div>
        <div className="text-[1.5vw] font-display text-text tracking-wide">R0 — INITIAL RELEASE</div>
      </div>
      <div className="absolute bottom-[2.5vh] right-[4vw] z-10 text-right">
        <div className="bp-label">NEXT TASK</div>
        <div className="text-[1.5vw] font-display text-text tracking-wide">Task #206 — Implementation</div>
      </div>
    </div>
  );
}
