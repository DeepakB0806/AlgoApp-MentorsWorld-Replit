---
name: Health card status colors
description: Collapsed HSI and HSM summaries use green only for authenticated Auth OK; other status colors remain unchanged.
---

For collapsed HSI and HSM health-card summaries, an authenticated `Auth OK` status uses the expanded card's green text treatment. `Not configured`, `Not running`, disconnected, reconnecting, and pending states retain their existing styling.

**Why:** The user wants authenticated broker profiles to be immediately recognizable without changing the meaning or visual treatment of any other health state.

**How to apply:** When adding or revising collapsed gateway summaries, style each v2/v3 status independently from its existing `authOk` value and avoid broad color changes to fallback states.