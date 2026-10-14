---
name: Kotak sandbox usage
description: The separate Kotak Sandbox is unused; the owner chose reversible archiving over permanent deletion because it cannot reliably simulate trades.
---

The project owner says the separate Kotak Neo Sandbox profile has never been used and Kotak's sandbox does not support enough functionality to simulate trades. The owner chose a reversible archive rather than permanent deletion so the profile can be restored with one instruction.

**Why:** The broker profile may still have historical plan/trade links, and Replit checkpoints do not restore production database changes. A targeted archive/restore preserves those links and avoids broad production restores.

**How to apply:** Treat Production as the live profile. Exclude archived Sandbox from active operations but retain its row and credentials until the owner explicitly chooses permanent deletion. Never assume the environment toggle makes Kotak orders simulated.