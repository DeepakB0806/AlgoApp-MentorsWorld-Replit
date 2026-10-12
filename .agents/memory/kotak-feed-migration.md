---
name: Kotak feed migration
description: User-confirmed status of Kotak's old HSM and the active HSI/native market-feed split.
---

Kotak has discontinued HSM, while HSI is functional. The native market-data feed is a separate WebSocket that uses Kotak's account-specific feed URL and session `sid`; do not treat HSI authentication as proof that the native market feed is connected.

**Why:** The broker login and HSI can succeed while market-data ticks remain unavailable until the separate native feed URL, session ID, and subscription flow are correct.

**How to apply:** Keep legacy HSM startup stopped. Validate HSI and the native market feed independently; for the native feed, confirm Kotak auth acknowledgement and a subscribed tick rather than relying on socket-open status alone.
