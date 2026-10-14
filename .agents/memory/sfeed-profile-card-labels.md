---
name: SFeed profile card labels
description: SFeed health cards identify Kotak environments by the broker profile name stored in the database.
---

Use the saved broker profile name (for example, Sandbox or Production) to identify each SFeed health card; API version is not an environment label.

**Why:** Kotak Sandbox and Production profiles can share the same Current v3 API version, so version-based card titles are ambiguous.

**How to apply:** When rendering per-profile SFeed health, use the profile name from the broker configuration record and keep credentials and feed URLs hidden.