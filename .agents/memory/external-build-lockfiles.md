---
name: External build lockfiles
description: Keep npm lockfiles usable by build systems outside Replit.
---

An npm lockfile can contain resolved tarball URLs on Replit's internal package-firewall host, which external build machines cannot resolve.

**Why:** Render cannot resolve Replit's internal package host, while equivalent tarballs are available from the public npm registry.

**How to apply:** Before external npm builds, inspect `resolved` URLs in `package-lock.json`. Replace internal-only hosts with public registry URLs without changing package versions or integrity hashes, then verify no private-host URLs remain.
