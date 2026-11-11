---
title: 'Ox hex quantity helpers need byte padding for RLP'
severity: 'minor'
---

### Expected Behavior
RLP integer construction should be easy to express with byte-aligned hex helpers.
### Current Behavior
Hex.fromNumber(7n) and Hex.trimLeft both return odd-length quantity hex, while the envelope codec requires even-length byte strings.
### Possible Solution
Use Hex.padLeft(hex, Hex.size(hex)) and encode integer zero as 0x. This convention is now recorded in AGENTS.md.
### Minimal Reproducible Example
Hex.fromNumber(7n) returns 0x7, not 0x07.
### Context
Implementing the canonical Monad transaction codec using Ox 0.14.65.
