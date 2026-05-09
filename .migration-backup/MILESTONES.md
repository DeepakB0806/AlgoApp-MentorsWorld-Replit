# Project Milestones

## Milestone 1 — HSI + HSM Live Production Connection
**Date:** April 15, 2026
**Status:** ACHIEVED ✓

### Summary
Both the HyperSync Interactive (HSI) and HyperSync Master (HSM) WebSocket feeds connected successfully to Kotak's E41 datacenter in production for the first time.

### Production Confirmation (deployment logs)
```
[HSM] Routing via Bangalore relay ws://168.144.0.191:8080 → wss://mlhsm.kotaksecurities.com
[HSM] Connected to Kotak HSM

[HSI] HSI URL resolved to wss://e41.kotaksecurities.com/realtime (dataCenter=E41)
[HSI] Routing via Bangalore relay ws://168.144.0.191:8080/realtime → wss://e41.kotaksecurities.com/realtime
[HSI] Auth payload: {type:cn,Authorization:eyJ...,Sid:6be76e4c-8bbd-4e4b-a9d1-61d21dd16a85,src:WEB}
[HSI] Connected via relay. Sending Kotak auth...
[HSI] [DEBUG] msg type="cn" raw={"ak":"ok","type":"cn","task":"cn","msg":"connected"}
```

### Root Cause Chain (HSI)
The HSI feed failed for multiple sessions before the root cause was isolated. The complete causal chain:

1. **Auth token scope (Task #136):** `buildAuthMessage` was using `viewToken`/`sidView` (View scope). Fixed to use `accessToken`/`sessionId` (Trade scope). E41 `/realtime` requires Trade-scope MPIN tokens.

2. **`source` → `src` key (Task #137):** Kotak's official `hslib.js` SDK transforms the key `source` to `src` before wire transmission. E41 requires `src:"WEB"`, not `source:"WEB"`. Fix applied to `buildAuthMessage`.

3. **Relay path detection (Task #137):** The Bangalore relay uses `http-proxy` and correctly forwards the `/realtime` path (sets `req.url = parsedTarget.pathname` from the `x-target-url` header before calling `proxy.ws()`). A relay-failure fallback was added: on `msg === "session message format incorrect"` while `usingRelay=true`, `relayFailed=true` is set. This was later found to be overly broad (see #4).

4. **Quote-stripped wire format (root cause — Task #138):** Discovered by reading `hslib.js` line-by-line. The Kotak SDK's `send()` method does:
   ```javascript
   hsiWs.send(JSON.stringify(req).replace(/"/g, ''))
   ```
   E41 does NOT accept standard JSON. It expects all double quotes removed from the serialized payload. Our server was sending standard `JSON.stringify()` output — E41 rejected every attempt with `"session message format incorrect"` regardless of IP, relay path, or token validity.

### The Fix (single line)
**File:** `server/hsi-kotak-neo-v3.ts` — `ws.on("open")` handler (inside `[HSI-1]`)

**Before:**
```typescript
const authPayload = JSON.stringify(buildAuthMessage(config));
```

**After:**
```typescript
const authPayload = JSON.stringify(buildAuthMessage(config)).replace(/"/g, '');
```

### Wire Format Comparison
| Format | Payload |
|--------|---------|
| ❌ Standard JSON (rejected by E41) | `{"type":"cn","Authorization":"eyJ...","Sid":"f14f...","src":"WEB"}` |
| ✓ E41 wire format (accepted) | `{type:cn,Authorization:eyJ...,Sid:f14f...,src:WEB}` |

### Red Herrings Investigated and Eliminated
- **IP restriction theory:** E41 accepts WebSocket upgrades from any IP (confirmed — WS connection established in all attempts; rejection happened at auth message level, not TCP/TLS level).
- **Relay path stripping:** The relay correctly sets `req.url = '/realtime'` from `x-target-url` regardless of the incoming path. Path was never the issue.
- **Token staleness:** Tokens were valid (user confirmed same tokens connected successfully in demo.html). E41 returned "session message format incorrect" for format errors, not token errors.

### Architecture Notes
- **HSM** uses `viewToken`/`sidView` (View scope) and the `mlhsm` endpoint, which is permissive and accepts standard auth. No quote-stripping required for HSM. HSM was connecting correctly throughout.
- **HSI** uses `accessToken`/`sessionId` (Trade scope) and the `e41` endpoint, which requires the quote-stripped wire format.
- **Relay:** Bangalore droplet at `168.144.0.191:8080` running `http-proxy` (Node.js). Routes through Indian IP. Both HSI and HSM route via this relay.
