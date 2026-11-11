---
title: 'JavaScript rebuilds include generated declaration files'
severity: 'minor'
---

### Expected Behavior
A JavaScript package build should not type-check previously generated declarations as source.
### Current Behavior
After build:types, build:esm and build:cjs can fail with TS2717 for Window.ethereum because tsconfig.build.json includes src/_types. A failed CJS build also leaves the trusted-setup files swapped.
### Possible Solution
Use the clean pnpm build sequence, which emits CJS and ESM before declarations. Restore a failed CJS swap with pnpm build:trustedSetups:end. Excluding generated build directories from source compilation would prevent the collision.
### Minimal Reproducible Example
Run pnpm build:types followed by pnpm build:esm on this checkout.
### Context
Validating the new Monad package export. The source type check and declaration build pass independently.
