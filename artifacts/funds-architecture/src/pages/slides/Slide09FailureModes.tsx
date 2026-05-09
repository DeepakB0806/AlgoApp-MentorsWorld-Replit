export default function Slide09FailureModes() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-bg">
      <div className="absolute inset-0 z-0 bp-grid" />

      <div className="absolute top-[3vh] left-[4vw] right-[4vw] z-10 flex justify-between items-start">
        <div>
          <div className="bp-label">DRAWING NO.</div>
          <div className="text-[1.5vw] font-display font-semibold text-text">MW-FA-009</div>
        </div>
        <div className="text-right">
          <div className="bp-label">SHEET</div>
          <div className="text-[1.5vw] font-display font-semibold text-text">09 / 10</div>
        </div>
      </div>

      <div className="absolute top-[11vh] left-[5vw] z-10">
        <div className="text-[4vw] font-display font-bold text-text leading-none tracking-tight mb-[0.5vh]">
          Failure Modes
        </div>
        <div className="text-[2vw] font-body text-muted mb-[1.5vh]">How the system degrades gracefully — TE correctness is unaffected in all cases</div>
        <div className="w-[8vw] h-[0.3vh] bg-accent" />
      </div>

      <div className="absolute top-[22vh] left-[5vw] right-[5vw] z-10">
        <div className="flex gap-[3vw] mb-[3vh]">

          <div className="flex-1 bp-node">
            <div className="text-[1.5vw] font-body text-accent font-semibold uppercase tracking-wider mb-[1vh]">
              getLimits fails for a UCC
            </div>
            <div className="text-[1.5vw] font-body text-muted uppercase tracking-wider mb-[1vh]">EFFECT ON UI</div>
            <div className="text-[2vw] font-body text-text leading-snug mb-[1.5vh]">
              Snapshot upserted with availableCapital = null · UI shows last known value with amber "stale" tint
            </div>
            <div className="text-[1.5vw] font-body text-muted uppercase tracking-wider mb-[0.5vh]">TE IMPACT</div>
            <div className="text-[2vw] font-body text-primary leading-snug">None — TE reads null as ungated (no skip)</div>
          </div>

          <div className="flex-1 bp-node">
            <div className="text-[1.5vw] font-body text-accent font-semibold uppercase tracking-wider mb-[1vh]">
              Broker disconnected
            </div>
            <div className="text-[1.5vw] font-body text-muted uppercase tracking-wider mb-[1vh]">EFFECT ON UI</div>
            <div className="text-[2vw] font-body text-text leading-snug mb-[1.5vh]">
              Capital Manager sweep skips UCC · snapshot age grows · UI shows red "stale" badge after 60 min
            </div>
            <div className="text-[1.5vw] font-body text-muted uppercase tracking-wider mb-[0.5vh]">TE IMPACT</div>
            <div className="text-[2vw] font-body text-primary leading-snug">None — broker disconnect prevents signals from reaching TE regardless</div>
          </div>
        </div>

        <div className="flex gap-[3vw]">

          <div className="flex-1 bp-node">
            <div className="text-[1.5vw] font-body text-accent font-semibold uppercase tracking-wider mb-[1vh]">
              Refresh button spammed
            </div>
            <div className="text-[1.5vw] font-body text-muted uppercase tracking-wider mb-[1vh]">SERVER RESPONSE</div>
            <div className="text-[2vw] font-body text-text leading-snug mb-[1.5vh]">
              POST .../refresh checks snapshotAt age · if younger than 30 s, returns cached snapshot without hitting Kotak
            </div>
            <div className="text-[1.5vw] font-body text-muted uppercase tracking-wider mb-[0.5vh]">KOTAK LOAD CAP</div>
            <div className="text-[2vw] font-body text-primary leading-snug">33 calls / sec max even if all 1000 users click simultaneously</div>
          </div>

          <div className="flex-1 bp-node">
            <div className="text-[1.5vw] font-body text-accent font-semibold uppercase tracking-wider mb-[1vh]">
              broker_configs.userId added (future)
            </div>
            <div className="text-[1.5vw] font-body text-muted uppercase tracking-wider mb-[1vh]">CHANGE SCOPE</div>
            <div className="text-[2vw] font-body text-text leading-snug mb-[1.5vh]">
              Only the server-side filter in GET /api/broker-capital-snapshots changes — adds WHERE userId = req.user.id
            </div>
            <div className="text-[1.5vw] font-body text-muted uppercase tracking-wider mb-[0.5vh]">FRONTEND IMPACT</div>
            <div className="text-[2vw] font-body text-primary leading-snug">Zero — broker-linking.tsx is fully forward-compatible</div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 h-[0.5vh] z-10 bg-accent" />
    </div>
  );
}
