---
"viem": minor
---

Added a dedicated `viem/monad` module for canonical type `0x40` encoding, decoding, ECDSA signing, and hashing, with low-s normalization, iterative nested-value processing, and opt-in baseline RPC integration using standard fields, chain overrides, full-width nonce lookup and replacement recovery, and empty auxiliary-data submission wrappers with canonical hash recovery during synchronous sending.
