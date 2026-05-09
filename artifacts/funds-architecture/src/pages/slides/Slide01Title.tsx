export default function Slide01Title() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-bg">
      <div className="absolute inset-0 z-0 bp-grid" />

      <div className="absolute top-[3vh] left-[4vw] right-[4vw] z-10 flex justify-between items-start">
        <div>
          <div className="bp-label">DRAWING NO.</div>
          <div className="text-[1.5vw] font-display font-semibold text-text tracking-wider">MW-FA-001</div>
        </div>
        <div className="text-right">
          <div className="bp-label">DATE</div>
          <div className="text-[1.5vw] font-display font-semibold text-text">2026-05-09</div>
        </div>
      </div>

      <div className="absolute left-[6vw] top-[26vh] z-10">
        <div className="text-[1.6vw] font-body text-accent tracking-[0.35em] uppercase mb-[2vh]">PROJECT TITLE</div>
        <div
          className="text-[6.5vw] font-display font-extrabold text-text leading-none tracking-tighter"
          style={{ textWrap: "balance" } as React.CSSProperties}
        >
          FUNDS-AVAILABLE
        </div>
        <div className="text-[6.5vw] font-display font-extrabold text-text leading-none tracking-tighter">
          RUNNING DEDUCTION
        </div>
        <div className="text-[4vw] font-display font-bold tracking-tight text-accent mt-[0.5vh]">
          AT 1000+ USER SCALE
        </div>
        <div className="w-[14vw] h-[0.3vh] bg-accent mt-[3vh] mb-[2.5vh]" />
        <div className="text-[2vw] font-body text-muted">
          MentorsWorld Algo Trading — Task #206 Architecture
        </div>
        <div className="text-[1.8vw] font-body text-muted mt-[0.8vh]">
          Scale-aware design · broker_capital_snapshots · TE gating mirror
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 h-[0.5vh] z-10 bg-accent" />

      <div className="absolute bottom-[2.5vh] left-[4vw] z-10">
        <div className="bp-label">PREPARED BY</div>
        <div className="text-[1.5vw] font-display text-text tracking-wide">MentorsWorld Engineering</div>
      </div>
      <div className="absolute bottom-[2.5vh] left-[50vw] -translate-x-1/2 z-10 text-center">
        <div className="bp-label">CLASSIFICATION</div>
        <div className="text-[1.5vw] font-display text-text tracking-wide">INTERNAL</div>
      </div>
      <div className="absolute bottom-[2.5vh] right-[4vw] z-10 text-right">
        <div className="bp-label">SCALE</div>
        <div className="text-[1.5vw] font-display text-text tracking-wide">1 : 1</div>
      </div>
    </div>
  );
}
