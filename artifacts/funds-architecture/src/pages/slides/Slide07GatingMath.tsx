export default function Slide07GatingMath() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-bg">
      <div className="absolute inset-0 z-0 bp-grid" />

      <div className="absolute top-[3vh] left-[4vw] right-[4vw] z-10 flex justify-between items-start">
        <div>
          <div className="bp-label">DRAWING NO.</div>
          <div className="text-[1.5vw] font-display font-semibold text-text">MW-FA-007</div>
        </div>
        <div className="text-right">
          <div className="bp-label">SHEET</div>
          <div className="text-[1.5vw] font-display font-semibold text-text">07 / 10</div>
        </div>
      </div>

      <div className="absolute top-[11vh] left-[5vw] z-10">
        <div className="text-[4vw] font-display font-bold text-text leading-none tracking-tight mb-[0.5vh]">
          The Gating Math
        </div>
        <div className="text-[2vw] font-body text-muted mb-[1.5vh]">
          Correctness-critical — UI must be bit-identical to TE lines 311–367
        </div>
        <div className="w-[8vw] h-[0.3vh] bg-accent" />
      </div>

      <div className="absolute top-[22vh] left-[5vw] right-[5vw] z-10 flex gap-[3vw]">

        <div className="flex flex-col gap-[2vh]" style={{ width: "54vw" }}>

          <div className="bp-node-amber">
            <div
              className="text-[1.5vw] font-body font-semibold uppercase tracking-wider mb-[1vh]"
              style={{ color: "#f59e0b" }}
            >
              STEP 1 — Sort plans by rank ascending
            </div>
            <div className="text-[2vw] font-body text-text leading-snug">
              const ranked = [...brokerPlans].sort((a, b) =&gt; (a.rank ?? 999) - (b.rank ?? 999))
            </div>
            <div className="text-[1.8vw] font-body text-muted mt-[0.8vh]">
              Same sort order as TE line 312 · null rank goes last (999)
            </div>
          </div>

          <div className="bp-arrow text-[2vw] pl-[4vw] justify-start py-[0.3vh]">↓</div>

          <div className="bp-node-amber">
            <div
              className="text-[1.5vw] font-body font-semibold uppercase tracking-wider mb-[1vh]"
              style={{ color: "#f59e0b" }}
            >
              STEP 2 — Compute gating with expiry-day uplift
            </div>
            <div className="text-[2vw] font-body text-text leading-snug">
              const gating = isExpiryDay ? estimated * 1.5 : estimated
            </div>
            <div className="text-[1.8vw] font-body text-muted mt-[0.8vh]">
              isExpiryDay = plan.instrumentExpiryDay === todayDayName (IST) · same as TE lines 351–354
            </div>
          </div>

          <div className="bp-arrow text-[2vw] pl-[4vw] justify-start py-[0.3vh]">↓</div>

          <div className="bp-node-amber">
            <div
              className="text-[1.5vw] font-body font-semibold uppercase tracking-wider mb-[1vh]"
              style={{ color: "#f59e0b" }}
            >
              STEP 3 — Deduct or mark as skipped
            </div>
            <div className="text-[2vw] font-body text-text leading-snug">
              if (gating &lt;= remaining) {"{"} remaining -= gating · green {"}"} else {"{"} red — "TE will skip" {"}"}
            </div>
            <div className="text-[1.8vw] font-body text-muted mt-[0.8vh]">
              remaining starts at snapshot.availableCapital · null/0 = ungated (UI shows "No snapshot yet")
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-[2vh]" style={{ flex: 1 }}>
          <div className="bp-label mb-[1vh]">CORRECTNESS NOTES</div>

          <div className="bp-node flex-1 flex flex-col gap-[2vh]">
            <div>
              <div className="text-[1.5vw] font-body text-primary font-semibold uppercase tracking-wider mb-[0.5vh]">
                Null snapshot = no gate
              </div>
              <div className="text-[1.9vw] font-body text-text leading-snug">
                TE treats 0/null as Infinity — UI shows "No snapshot — running deduction unavailable"
              </div>
            </div>

            <div>
              <div className="text-[1.5vw] font-body text-primary font-semibold uppercase tracking-wider mb-[0.5vh]">
                Optional shared helper
              </div>
              <div className="text-[1.9vw] font-body text-text leading-snug">
                shared/capital-gating.ts — extracts the 6-line loop so TE and UI share one source of truth
              </div>
            </div>

            <div>
              <div className="text-[1.5vw] font-body text-primary font-semibold uppercase tracking-wider mb-[0.5vh]">
                ExpiryDay source
              </div>
              <div className="text-[1.9vw] font-body text-text leading-snug">
                GET /api/strategy-plans extended to include instrumentExpiryDay via additive join — no schema change
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 h-[0.5vh] z-10 bg-accent" />
    </div>
  );
}
