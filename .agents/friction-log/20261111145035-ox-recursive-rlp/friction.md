---
title: 'Ox recursive RLP codec overflows on deeply nested values'
severity: 'minor'
target: 'ox'
---

Ox 0.14.65 Rlp.toHex and Rlp.fromHex recurse through list values. A canonical Monad envelope of 12093 bytes with 4096 nested lists throws RangeError on Node 26.13.0 during decoding and encoding. Unknown transaction features need to round-trip without an undocumented runtime-dependent depth limit. The Monad module now uses explicit stacks for list decoding, encoding, and validation, while retaining Ox byte-string encoding and crypto helpers. Regression tests cover 16384 levels, canonical length and boundary checks, cycles, and shared acyclic lists.
