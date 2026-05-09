export default function Slide08ScaleEnvelope() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-bg">
      <div className="absolute inset-0 z-0 bp-grid" />

      <div className="absolute top-[3vh] left-[4vw] right-[4vw] z-10 flex justify-between items-start">
        <div>
          <div className="bp-label">DRAWING NO.</div>
          <div className="text-[1.5vw] font-display font-semibold text-text">MW-FA-008</div>
        </div>
        <div className="text-right">
          <div className="bp-label">SHEET</div>
          <div className="text-[1.5vw] font-display font-semibold text-text">08 / 10</div>
        </div>
      </div>

      <div className="absolute top-[11vh] left-[5vw] z-10">
        <div className="text-[4vw] font-display font-bold text-text leading-none tracking-tight mb-[0.5vh]">
          Scale Envelope
        </div>
        <div className="text-[2vw] font-body text-muted mb-[1.5vh]">Numbers verbatim from project task · 1 user vs 1000 users</div>
        <div className="w-[8vw] h-[0.3vh] bg-accent" />
      </div>

      <div className="absolute top-[22vh] left-[5vw] right-[5vw] z-10">
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid hsl(217 33% 20%)" }}>
              <th
                className="text-[1.4vw] font-body text-muted tracking-[0.2em] uppercase font-medium text-left"
                style={{ padding: "1.2vh 2vw 1.2vh 0" }}
              >
                METRIC
              </th>
              <th
                className="text-[1.4vw] font-body text-primary tracking-[0.2em] uppercase font-medium text-left"
                style={{ padding: "1.2vh 2vw" }}
              >
                TODAY (1 USER)
              </th>
              <th
                className="text-[1.4vw] font-body text-accent tracking-[0.2em] uppercase font-medium text-left"
                style={{ padding: "1.2vh 2vw" }}
              >
                TARGET (1000 USERS)
              </th>
              <th
                className="text-[1.4vw] font-body text-muted tracking-[0.2em] uppercase font-medium text-left"
                style={{ padding: "1.2vh 0 1.2vh 2vw" }}
              >
                MECHANISM
              </th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: "1px solid hsl(217 33% 14%)" }}>
              <td className="text-[2vw] font-body text-text" style={{ padding: "1.4vh 2vw 1.4vh 0" }}>
                Daily refresh
              </td>
              <td className="text-[2vw] font-body text-primary" style={{ padding: "1.4vh 2vw" }}>
                300 ms
              </td>
              <td className="text-[2vw] font-body text-accent" style={{ padding: "1.4vh 2vw" }}>
                ~6 s
              </td>
              <td className="text-[1.8vw] font-body text-muted" style={{ padding: "1.4vh 0 1.4vh 2vw" }}>
                Existing runWithConcurrency (cap 50)
              </td>
            </tr>
            <tr style={{ borderBottom: "1px solid hsl(217 33% 14%)" }}>
              <td className="text-[2vw] font-body text-text" style={{ padding: "1.4vh 2vw 1.4vh 0" }}>
                Intraday sweep
              </td>
              <td className="text-[2vw] font-body text-primary" style={{ padding: "1.4vh 2vw" }}>
                300 ms / 5 min
              </td>
              <td className="text-[2vw] font-body text-accent" style={{ padding: "1.4vh 2vw" }}>
                ~6 s / 5 min
              </td>
              <td className="text-[1.8vw] font-body text-muted" style={{ padding: "1.4vh 0 1.4vh 2vw" }}>
                New setInterval · market hours · &lt;2% duty cycle
              </td>
            </tr>
            <tr style={{ borderBottom: "1px solid hsl(217 33% 14%)" }}>
              <td className="text-[2vw] font-body text-text" style={{ padding: "1.4vh 2vw 1.4vh 0" }}>
                Per-fill refresh
              </td>
              <td className="text-[2vw] font-body text-primary" style={{ padding: "1.4vh 2vw" }}>
                ≤5 min
              </td>
              <td className="text-[2vw] font-body text-accent" style={{ padding: "1.4vh 2vw" }}>
                ≤5 min
              </td>
              <td className="text-[1.8vw] font-body text-muted" style={{ padding: "1.4vh 0 1.4vh 2vw" }}>
                Intraday sweep + on-demand button (TE hook dropped to keep TE frozen)
              </td>
            </tr>
            <tr style={{ borderBottom: "1px solid hsl(217 33% 14%)" }}>
              <td className="text-[2vw] font-body text-text" style={{ padding: "1.4vh 2vw 1.4vh 0" }}>
                UI read load
              </td>
              <td className="text-[2vw] font-body text-primary" style={{ padding: "1.4vh 2vw" }}>
                1 DB query / 60 s
              </td>
              <td className="text-[2vw] font-body text-accent" style={{ padding: "1.4vh 2vw" }}>
                ~17 queries / sec
              </td>
              <td className="text-[1.8vw] font-body text-muted" style={{ padding: "1.4vh 0 1.4vh 2vw" }}>
                Indexed read on ≤1000-row table
              </td>
            </tr>
            <tr>
              <td className="text-[2vw] font-body text-text" style={{ padding: "1.4vh 2vw 1.4vh 0" }}>
                Refresh-button abuse
              </td>
              <td className="text-[2vw] font-body text-primary" style={{ padding: "1.4vh 2vw" }}>
                N/A
              </td>
              <td className="text-[2vw] font-body text-accent" style={{ padding: "1.4vh 2vw" }}>
                ≤33 Kotak calls / sec
              </td>
              <td className="text-[1.8vw] font-body text-muted" style={{ padding: "1.4vh 0 1.4vh 2vw" }}>
                30 s per-UCC debounce + 50-parallel cap
              </td>
            </tr>
          </tbody>
        </table>

        <div className="mt-[2vh] bp-node flex gap-[5vw]">
          <div>
            <div className="text-[1.5vw] font-body text-muted uppercase tracking-wider mb-[0.5vh]">TE behavior</div>
            <div className="text-[2vw] font-body text-text">Unchanged · reads DB snapshot per signal · staleness window identical to today</div>
          </div>
          <div>
            <div className="text-[1.5vw] font-body text-muted uppercase tracking-wider mb-[0.5vh]">Daily Kotak getLimits at 1000 users</div>
            <div className="text-[2vw] font-body text-text">~76,000/day · 75 sweeps × 1000 UCCs + 1000 daily · 3.4 calls/sec avg</div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 h-[0.5vh] z-10 bg-accent" />
    </div>
  );
}
