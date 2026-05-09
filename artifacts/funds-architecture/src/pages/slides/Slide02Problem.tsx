export default function Slide02Problem() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-bg">
      <div className="absolute inset-0 z-0 bp-grid" />

      <div className="absolute top-[3vh] left-[4vw] right-[4vw] z-10 flex justify-between items-start">
        <div>
          <div className="bp-label">DRAWING NO.</div>
          <div className="text-[1.5vw] font-display font-semibold text-text">MW-FA-002</div>
        </div>
        <div className="text-right">
          <div className="bp-label">SHEET</div>
          <div className="text-[1.5vw] font-display font-semibold text-text">02 / 10</div>
        </div>
      </div>

      <div className="absolute top-[11vh] left-[5vw] z-10">
        <div className="text-[4vw] font-display font-bold text-text leading-none tracking-tight mb-[0.5vh]">
          The Problem Today
        </div>
        <div className="text-[2vw] font-body text-muted mb-[1.5vh]">What users see vs. what they need</div>
        <div className="w-[8vw] h-[0.3vh] bg-accent" />
      </div>

      <div className="absolute top-[22vh] left-[5vw] right-[5vw] z-10 flex gap-[3vw]">

        <div className="flex-1 bp-node flex flex-col">
          <div className="bp-label mb-[2.5vh]">WHAT EXISTS TODAY</div>

          <div className="mb-[2.5vh]">
            <div className="text-[1.5vw] font-body text-primary font-semibold uppercase tracking-wider mb-[0.8vh]">
              Per-plan estimated margin
            </div>
            <div className="text-[2vw] font-body text-text leading-snug">
              Shown on each plan card, with no context of remaining available funds
            </div>
          </div>

          <div className="mb-[2.5vh]">
            <div className="text-[1.5vw] font-body text-primary font-semibold uppercase tracking-wider mb-[0.8vh]">
              TE gating is invisible
            </div>
            <div className="text-[2vw] font-body text-text leading-snug">
              Capital check runs at signal time — users cannot preview the outcome in advance
            </div>
          </div>

          <div>
            <div className="text-[1.5vw] font-body text-primary font-semibold uppercase tracking-wider mb-[0.8vh]">
              Deployment is blind
            </div>
            <div className="text-[2vw] font-body text-text leading-snug">
              No way to know which plans TE will skip before the next webhook signal fires
            </div>
          </div>
        </div>

        <div className="flex-1 bp-node-amber flex flex-col">
          <div
            className="text-[1.3vw] font-body tracking-[0.25em] uppercase font-semibold mb-[2.5vh]"
            style={{ color: "#f59e0b" }}
          >
            WHAT'S MISSING
          </div>

          <div className="mb-[2.5vh]">
            <div className="text-[1.5vw] font-body text-accent font-semibold uppercase tracking-wider mb-[0.8vh]">
              Running deduction by rank
            </div>
            <div className="text-[2vw] font-body text-text leading-snug">
              Mirror TE's gating math exactly — see green / red per plan before execution
            </div>
          </div>

          <div className="mb-[2.5vh]">
            <div className="text-[1.5vw] font-body text-accent font-semibold uppercase tracking-wider mb-[0.8vh]">
              Live fund snapshot in the UI
            </div>
            <div className="text-[2vw] font-body text-text leading-snug">
              Capital position on the Broker Linking page — refreshed every 10 min during market hours · no per-fill update
            </div>
          </div>

          <div>
            <div className="text-[1.5vw] font-body text-accent font-semibold uppercase tracking-wider mb-[0.8vh]">
              Expiry-day uplift visible
            </div>
            <div className="text-[2vw] font-body text-text leading-snug">
              Plans on expiry day display "(1.5× expiry uplift applied)" so the math is auditable
            </div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 h-[0.5vh] z-10 bg-accent" />
    </div>
  );
}
