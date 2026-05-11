---
name: milestone-logging
description: Log a milestone to replit.md before marking any task complete. Use before every mark_task_complete call to record what was achieved, key files changed, and diagnostic notes for future agents.
---

# Milestone Logging

Before calling `mark_task_complete` on any task, append a `### [MILESTONE]` block to the `## Milestones` section in `replit.md`.

This is MANDATORY — every completed task must leave a milestone entry. It is the institutional memory of the project.

---

## When to run

Immediately before `mark_task_complete`. After follow-up tasks are proposed, before the final mark.

---

## Milestone block format

```markdown
### [MILESTONE] <Title> — verified <YYYY-MM-DD>

**Task:** #<number> — <task title>

**What changed:** <1-2 sentence summary of the fix or feature delivered>

**Key files:**
- `path/to/file.ts` — what was changed and why
- `path/to/file2.ts` — what was changed and why

**How it works:** <brief explanation of the mechanism — enough for a fresh agent to understand without reading the code>

**Diagnostic — if this breaks, check:**
1. <first thing to verify>
2. <second thing to verify>
```

---

## Rules

- **Always include Task number** — links the milestone back to the task that produced it.
- **Key files must be real paths** — no invented filenames. Only files that were actually changed.
- **Diagnostic section is required** — future agents and the user use this to triage incidents without re-reading code.
- **Do not duplicate** — if the milestone already exists in `replit.md` (same task number), skip.
- **Place in `## Milestones` section** — append after the last existing milestone block. If the section doesn't exist, create it at the bottom of `replit.md`.
- **Date format**: `YYYY-MM-DD` (today's date at time of completion).

---

## Example

```markdown
### [MILESTONE] HSM binary auth protocol fix — verified 2026-05-11

**Task:** #244 — HSM binary auth protocol fix (gateway + probe)

**What changed:** Kotak HSM requires a binary wire protocol for authentication — not JSON. Switched the gateway and probe from JSON sends to a binary frame matching hslib.js `prepareConnectionRequest2`. Added binary CONNECTION_TYPE response decoder to detect auth_ok.

**Key files:**
- `artifacts/api-server/src/hsm-kotak-neo-v3.ts` — added `buildHsmAuthBinary()`, binary send in ws.on("open"), binary auth-ack decoder in ws.on("message")
- `artifacts/api-server/src/kotak-probe.ts` — probe HSM branch now sends binary and decodes binary auth-ack response

**How it works:** Binary frame layout: 2-byte BE payload length, type=1 (CONNECTION_TYPE), field count=3, then 3 fields each with field-ID byte + 2-byte length + data (JWT, SID, source="JS_API"). Auth-ack response detected by `buf[2]===1` and status byte `'K'` (BinRespStat.OK) at offset 7.

**Diagnostic — if this breaks, check:**
1. `[HSM] Sending binary auth frame: N bytes` must appear in logs on connect
2. `[HSM] auth_ok received (binary CONNECTION_TYPE response)` must follow within 1s
3. If neither appears, check `buildHsmAuthBinary` export and ws.on("open") handler in `hsm-kotak-neo-v3.ts`
4. Binary response hex dump logged as `[HSM] [DIAG] First raw message: N bytes hex=...` — byte[2] must be `01`, byte[7] must be `4b`
```
