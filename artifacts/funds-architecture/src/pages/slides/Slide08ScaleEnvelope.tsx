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

      <div className="absolute top-[10vh] left-[5vw] z-10">
        <div className="text-[3.8vw] font-display font-bold text-text leading-none tracking-tight mb-[0.4vh]">
          Scale Envelope
        </div>
        <div className="text-[1.8vw] font-body text-muted mb-[1.2vh]">Numbers verbatim from project task · 1 user vs 1000 users</div>
        <div className="w-[8vw] h-[0.3vh] bg-accent" />
      </div>

      <div className="absolute top-[20vh] left-[5vw] right-[5vw] z-10">
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid hsl(217 33% 20%)" }}>
              <th
                className="text-[1.3vw] font-body text-muted tracking-[0.2em] uppercase font-medium text-left"
                style={{ padding: "1vh 1.5vw 1vh 0", width: "18%" }}
              >
                METRIC
              </th>
              <th
                className="text-[1.3vw] font-body text-primary tracking-[0.2em] uppercase font-medium text-left"
                style={{ padding: "1vh 1.5vw", width: "22%" }}
              >
                TODAY (1 USER)
              </th>
              <th
                className="text-[1.3vw] font-body text-accent tracking-[0.2em] uppercase font-medium text-left"
                style={{ padding: "1vh 1.5vw", width: "30%" }}
              >
                TARGET (1000 USERS)
              </th>
              <th
                className="text-[1.3vw] font-body text-muted tracking-[0.2em] uppercase font-medium text-left"
                style={{ padding: "1vh 0 1vh 1.5vw" }}
              >
                MECHANISM
              </th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: "1px solid hsl(217 33% 14%)" }}>
              <td className="text-[1.75vw] font-body text-text" style={{ padding: "1.2vh 1.5vw 1.2vh 0" }}>
                Daily refresh
              </td>
              <td className="text-[1.6vw] font-body text-primary" style={{ padding: "1.2vh 1.5vw" }}>
                1 UCC × 300 ms = 300 ms
              </td>
              <td className="text-[1.6vw] font-body text-accent" style={{ padding: "1.2vh 1.5vw" }}>
                1000 / 50 × 300 ms ≈ 6 s
              </td>
              <td className="text-[1.6vw] font-body text-muted" style={{ padding: "1.2vh 0 1.2vh 1.5vw" }}>
                Existing runWithConcurrency
              </td>
            </tr>
            <tr style={{ borderBottom: "1px solid hsl(217 33% 14%)" }}>
              <td className="text-[1.75vw] font-body text-text" style={{ padding: "1.2vh 1.5vw 1.2vh 0" }}>
                Intraday sweep
              </td>
              <td className="text-[1.6vw] font-body text-primary" style={{ padding: "1.2vh 1.5vw" }}>
                1 sweep / 5 min
              </td>
              <td className="text-[1.6vw] font-body text-accent" style={{ padding: "1.2vh 1.5vw" }}>
                1000 UCCs / 50 parallel ≈ 6 s per sweep
              </td>
              <td className="text-[1.6vw] font-body text-muted" style={{ padding: "1.2vh 0 1.2vh 1.5vw" }}>
                New setInterval, gated to market hours
              </td>
            </tr>
            <tr style={{ borderBottom: "1px solid hsl(217 33% 14%)" }}>
              <td className="text-[1.75vw] font-body text-text" style={{ padding: "1.2vh 1.5vw 1.2vh 0" }}>
                Per-fill refresh
              </td>
              <td className="text-[1.6vw] font-body text-primary" style={{ padding: "1.2vh 1.5vw" }}>
                ≤ 5 min (or user clicks Refresh)
              </td>
              <td className="text-[1.6vw] font-body text-accent" style={{ padding: "1.2vh 1.5vw" }}>
                ≤ 5 min (or user clicks Refresh)
              </td>
              <td className="text-[1.6vw] font-body text-muted" style={{ padding: "1.2vh 0 1.2vh 1.5vw" }}>
                Intraday scheduler + on-demand button
              </td>
            </tr>
            <tr style={{ borderBottom: "1px solid hsl(217 33% 14%)" }}>
              <td className="text-[1.75vw] font-body text-text" style={{ padding: "1.2vh 1.5vw 1.2vh 0" }}>
                UI read load
              </td>
              <td className="text-[1.6vw] font-body text-primary" style={{ padding: "1.2vh 1.5vw" }}>
                1 DB query / 60 s
              </td>
              <td className="text-[1.6vw] font-body text-accent" style={{ padding: "1.2vh 1.5vw" }}>
                1000 DB queries / 60 s ≈ 17/sec
              </td>
              <td className="text-[1.6vw] font-body text-muted" style={{ padding: "1.2vh 0 1.2vh 1.5vw" }}>
                Indexed read on a ≤1000-row table
              </td>
            </tr>
            <tr>
              <td className="text-[1.75vw] font-body text-text" style={{ padding: "1.2vh 1.5vw 1.2vh 0" }}>
                Refresh-button abuse
              </td>
              <td className="text-[1.6vw] font-body text-primary" style={{ padding: "1.2vh 1.5vw" }}>
                N/A
              </td>
              <td className="text-[1.5vw] font-body text-accent" style={{ padding: "1.2vh 1.5vw" }}>
                1000 users click at once → 1000 calls / 30 s window
              </td>
              <td className="text-[1.6vw] font-body text-muted" style={{ padding: "1.2vh 0 1.2vh 1.5vw" }}>
                30 s per-UCC server debounce + 50-parallel cap
              </td>
            </tr>
          </tbody>
        </table>

        <div className="mt-[1.5vh] bp-node flex gap-[4vw]">
          <div style={{ flex: 1 }}>
            <div className="text-[1.3vw] font-body text-muted uppercase tracking-wider mb-[0.4vh]">Daily Kotak getLimits calls at 1000 users</div>
            <div className="text-[1.7vw] font-body text-text">~1000 + (75 sweeps × 1000) ≈ 76,000/day · 3.4 calls/sec average across 6.25 hr window</div>
          </div>
          <div style={{ flex: 1 }}>
            <div className="text-[1.3vw] font-body text-muted uppercase tracking-wider mb-[0.4vh]">TE behavior</div>
            <div className="text-[1.7vw] font-body text-text">Unchanged · reads DB snapshot per signal · staleness window identical to today</div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 h-[0.5vh] z-10 bg-accent" />
    </div>
  );
}
