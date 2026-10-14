---
name: Kotak sandbox usage
description: The project owner has not used the separate Kotak Sandbox profile and reports Kotak's sandbox is too limited to simulate trades reliably.
---

The project owner says the separate Kotak Neo Sandbox profile has never been used and that Kotak's sandbox does not support enough functionality to simulate trades.

**Why:** Do not assume a profile labeled UAT/Sandbox provides safe or meaningful paper trading; the app must verify actual Kotak endpoint and order behavior.

**How to apply:** Treat Production as the live profile. Keep or remove the separate Sandbox profile only according to whether a real, supported UAT workflow exists; never use the environment toggle alone as evidence that orders are simulated.