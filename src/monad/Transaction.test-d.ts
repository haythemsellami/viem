import type { Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { Transaction } from 'viem/monad'
import { expectTypeOf, test } from 'vitest'

test('public envelope and codec types preserve full-width integers and readonly features', () => {
  const envelope = { chainId: 143n, features: [['0xff', ['0x', []]]] } as const
  const serialized = Transaction.serialize(envelope)
  const decoded = Transaction.deserialize(serialized)

  expectTypeOf(serialized).toEqualTypeOf<`0x40${string}`>()
  expectTypeOf(decoded).toEqualTypeOf<Transaction.Envelope>()
  expectTypeOf(decoded.chainId).toEqualTypeOf<bigint>()
  expectTypeOf(decoded.features).toEqualTypeOf<readonly Transaction.Feature[]>()
  expectTypeOf(Transaction.hash(decoded)).toEqualTypeOf<Hex>()
  expectTypeOf(Transaction.getSignPayload(decoded)).toEqualTypeOf<Hex>()
})

test('baseline builder and local account compose without generic transaction casts', () => {
  const account = privateKeyToAccount(
    '0x0000000000000000000000000000000000000000000000000000000000000001',
  )
  const parameters = {
    chainId: 143,
    nonce: 0n,
    gas: 21_000n,
    maxFeePerGas: 1n,
    maxPriorityFeePerGas: 0n,
  }
  const transaction = Transaction.from(parameters)

  expectTypeOf(transaction).toEqualTypeOf<Transaction.Envelope>()
  expectTypeOf(Transaction.sign({ account, transaction })).toEqualTypeOf<
    Promise<Transaction.Serialized>
  >()
  // @ts-expect-error Nonces require bigint to preserve their full uint64 range.
  Transaction.from({ ...parameters, nonce: 1 })
  // @ts-expect-error Recursive RLP values contain bytes or lists, not numeric values.
  Transaction.serialize({ chainId: 143n, features: [['0xff', 1n]] })
  // @ts-expect-error Raw envelopes use bigint chain identifiers.
  Transaction.serialize({ chainId: 143, features: [] })
  // @ts-expect-error The canonical envelope has no auxiliary-data field.
  Transaction.serialize({ chainId: 143n, features: [], auxiliaryData: [] })
})
