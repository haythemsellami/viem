import { decodeRlp, encodeRlp, keccak256 } from 'ethers'
import { privateKeyToAccount } from 'viem/accounts'
import { Submission, Transaction } from 'viem/monad'
import { expect, test } from 'vitest'

test('wraps canonical signed bytes without changing transaction identity', async () => {
  const canonical = await Transaction.sign({
    account: privateKeyToAccount(`0x${'1'.repeat(64)}`),
    transaction: Transaction.from({
      chainId: 143,
      nonce: 0n,
      gas: 21_000n,
      maxFeePerGas: 2n,
      maxPriorityFeePerGas: 1n,
    }),
  })
  const transaction = Transaction.deserialize(canonical)
  const submitted = Submission.serialize(transaction)
  const fields = decodeRlp(`0x${canonical.slice(4)}`) as string[]

  expect(submitted).toBe(`0x40${encodeRlp([...fields, []]).slice(2)}`)
  expect(Submission.deserialize(submitted)).toEqual(transaction)
  expect(Transaction.hash(transaction)).toBe(keccak256(canonical))
  expect(keccak256(submitted)).not.toBe(Transaction.hash(transaction))
  expect(() => Transaction.deserialize(submitted)).toThrow()
  expect(() => Submission.deserialize(canonical)).toThrow()
})

test('rejects malformed wrappers and nonempty auxiliary data', () => {
  for (const body of [
    [],
    ['0x8f', []],
    ['0x8f', [], '0x'],
    ['0x8f', [], [['0x01', '0x']]],
    ['0x8f', [], [], []],
  ])
    expect(() =>
      Submission.deserialize(`0x40${encodeRlp(body).slice(2)}`),
    ).toThrow()
  for (const value of [
    '0x',
    '0x4',
    '0x41c4818fc0c0',
    '0x40c4818fc0c000',
    '0x40c4818fc1c0',
    '0x40c500818fc0c0',
  ] as const)
    expect(() => Submission.deserialize(value)).toThrow()
})

test('preserves opaque nested canonical data without recursive traversal', () => {
  let value: Transaction.Value = '0x'
  for (let i = 0; i < 16_384; i++) value = [value]
  const transaction = { chainId: 143n, features: [['0xff', value]] } as const
  const submitted = Submission.serialize(transaction)

  expect(Transaction.serialize(Submission.deserialize(submitted))).toBe(
    Transaction.serialize(transaction),
  )
})
