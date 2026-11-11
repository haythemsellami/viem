---
title: 'Opt-in RLP stress tests exceed the default Node heap'
severity: 'minor'
---

### Expected Behavior
Targeted RPC regression checks complete within the default memory budget.

### Current Behavior
Enabling TEST_RLP=true exhausted the approximately 4 GiB Node heap in existing large-list tests. The normal configuration excludes this suite.

### Possible Solution
Keep the default exclusion for RPC work and run large-list stress tests separately with an explicit memory budget.

### Minimal Reproducible Example
SKIP_GLOBAL_SETUP=true TEST_RLP=true pnpm test --run --retry 0 src/utils/encoding/toRlp.test.ts

### Context
The normal targeted run passed 340 tests across 13 files, including Monad nested-RLP regressions.
