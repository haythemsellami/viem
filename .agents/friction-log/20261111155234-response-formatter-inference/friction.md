---
title: 'Response formatter inference needs definition metadata'
severity: 'minor'
---

## Expected Behavior
Custom chain response types should appear in public client reads.

## Current Behavior
A bare response formatter containing only type and format can fall back to Ethereum return types because IsNarrowable considers it equivalent to ChainFormatter.

## Possible Solution
Spread defineTransaction or defineBlock metadata, then override format directly when base conversions would lose nonce precision.

## Minimal Reproducible Example
Configure a transaction formatter returning a custom type with a bigint nonce and inspect getTransaction and getBlock return types without definition metadata.

## Context
Public client type tests exposed this while adding the baseline Monad formatter.
