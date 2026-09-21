---
name: Kotak HSI version boundary
description: The existing v3-suffixed HSI gateway is the protected Legacy v2 baseline; Current v3 uses the isolated v4-suffixed implementation.
---

The logical Kotak API profile is selected by `apiVersion`, not by the gateway filename. `v2_legacy` must continue through the existing v3-suffixed HSI gateway, while `v3_current` uses the isolated v4-suffixed gateway.

**Why:** The existing Legacy v2 HSI lifecycle contains production-tested and user-locked behavior. Changing it while introducing Current v3 isolation risks breaking a working broker connection or mixing credentials, sockets, heartbeats, callbacks, and status state.

**How to apply:** Add Current v3 behavior in the v4-suffixed gateway and route through a version-aware adapter. Do not rename, rewrite, or globally rewire the existing v3-suffixed HSI file.