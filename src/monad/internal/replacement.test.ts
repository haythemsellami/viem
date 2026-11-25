import { Transaction } from 'viem/monad'
import { expect, test } from 'vitest'
import { classify } from './replacement.js'

const sender = '0x0000000000000000000000000000000000000001'
const target = '0x0000000000000000000000000000000000000002'
const candidate = {
  hash: `0x${'0'.repeat(64)}` as `0x${string}`,
  from: sender,
  nonce: 0n,
  type: 'monad',
} as const
const fields = {
  chainId: 143,
  nonce: 0n,
  gas: 100_000n,
  maxFeePerGas: 2n,
  maxPriorityFeePerGas: 1n,
} as const

test('classifies replacements from complete canonical calls', () => {
  const before = Transaction.from({
    ...fields,
    calls: [{ to: target }, { to: sender, value: 2n }],
  })
  const repriced = Transaction.from({
    ...fields,
    gas: 200_000n,
    maxFeePerGas: 3n,
    calls: [{ to: target }, { to: sender, value: 2n }],
  })
  const changed = Transaction.from({
    ...fields,
    calls: [{ to: target }, { to: sender, value: 3n }],
  })
  const prefix = Transaction.from({ ...fields, calls: [{ to: target }] })
  const cancel = Transaction.from({ ...fields, calls: [{ to: sender }] })
  expect([
    classify(candidate, before, repriced),
    classify(candidate, before, changed),
    classify(candidate, before, prefix),
    classify(candidate, before, cancel),
    classify(candidate, undefined, repriced),
    classify(candidate, before, undefined),
  ]).toMatchInlineSnapshot(`
    [
      "repriced",
      "replaced",
      "replaced",
      "cancelled",
      "replaced",
      "replaced",
    ]
  `)
})

test('retains CALL versus one-entry CALLS and optional feature identity', () => {
  const scalar = Transaction.from({ ...fields, to: target })
  const batch = Transaction.from({ ...fields, calls: [{ to: target }] })
  const access = Transaction.from({ ...fields, to: target, accessList: [] })
  expect([
    classify(candidate, scalar, batch),
    classify(candidate, scalar, access),
  ]).toMatchInlineSnapshot(`
    [
      "replaced",
      "replaced",
    ]
  `)
})
