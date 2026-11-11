---
title: 'Typecheck-only verification needs project runtime exclusions'
severity: 'minor'
target: 'vitest'
---

In this repository with Vitest 4.1.12, enabling typecheck on the core project and running pnpm test:typecheck --run --project core still started runtime tests despite the top-level --typecheck.only flag. The unintended offline runtime run was stopped. Focused verification needs typecheck.enabled and typecheck.only on the selected project, an explicit typecheck.include, runtime include set to an empty array, and the target .test-d.ts path on the CLI. Restore temporary settings afterward.
