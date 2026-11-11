import { chainConfig, Formatters, Transaction } from 'viem/monad'
import { expect, test } from 'vitest'

const address = '0x0000000000000000000000000000000000000001'
const request = {
  type: 'monad',
  chainId: 143,
  nonce: 2n ** 64n - 1n,
  gas: 2n ** 64n - 1n,
  to: address,
  value: 0n,
  data: '0x',
  maxFeePerGas: 2n,
  maxPriorityFeePerGas: 1n,
  authorizationList: [
    {
      address,
      chainId: 2n ** 256n - 1n,
      nonce: 2n ** 64n - 1n,
      yParity: 0,
      r: '0x01',
      s: '0x02',
    },
  ],
} as const

test('standard requests preserve quantity widths and explicit empty lists', () => {
  expect(Formatters.formatTransactionRequest(request)).toMatchInlineSnapshot(`
    {
      "authorizationList": [
        {
          "address": "0x0000000000000000000000000000000000000001",
          "chainId": "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
          "nonce": "0xffffffffffffffff",
          "r": "0x1",
          "s": "0x2",
          "yParity": "0x0",
        },
      ],
      "chainId": "0x8f",
      "data": "0x",
      "gas": "0xffffffffffffffff",
      "maxFeePerGas": "0x2",
      "maxPriorityFeePerGas": "0x1",
      "nonce": "0xffffffffffffffff",
      "to": "0x0000000000000000000000000000000000000001",
      "type": "0x40",
      "value": "0x0",
    }
  `)
  expect(
    Formatters.formatTransactionRequest({
      type: 'monad',
      to: null,
      nonce: 0n,
      accessList: [],
      authorizationList: [],
    }),
  ).toMatchInlineSnapshot(`
    {
      "accessList": [],
      "authorizationList": [],
      "nonce": "0x0",
      "to": null,
      "type": "0x40",
    }
  `)
  expect(
    Formatters.formatTransactionRequest({ type: 'monad' }),
  ).toMatchInlineSnapshot(`
    {
      "type": "0x40",
    }
  `)
})

test('read formatting preserves nonce and authorization widths before base conversion', () => {
  const rpc = Formatters.formatTransactionRequest(request)
  expect(
    Formatters.formatTransaction({
      ...rpc,
      input: '0x',
      v: '0x0',
      r: '0x1',
      s: '0x2',
    } as Partial<Formatters.TransactionRpc>),
  ).toMatchInlineSnapshot(`
    {
      "authorizationList": [
        {
          "address": "0x0000000000000000000000000000000000000001",
          "chainId": 115792089237316195423570985008687907853269984665640564039457584007913129639935n,
          "nonce": 18446744073709551615n,
          "r": "0x1",
          "s": "0x2",
          "yParity": 0,
        },
      ],
      "blockHash": null,
      "blockNumber": null,
      "chainId": 143,
      "data": "0x",
      "gas": 18446744073709551615n,
      "gasPrice": undefined,
      "input": "0x",
      "maxFeePerGas": 2n,
      "maxPriorityFeePerGas": 1n,
      "nonce": 18446744073709551615n,
      "r": "0x1",
      "s": "0x2",
      "to": "0x0000000000000000000000000000000000000001",
      "transactionIndex": null,
      "type": "monad",
      "typeHex": "0x40",
      "v": 0n,
      "value": 0n,
      "yParity": 0,
    }
  `)
})

test('omitted and empty list features retain different canonical identities', () => {
  const fields = {
    type: 'monad',
    chainId: 143,
    nonce: 0n,
    gas: 21_000n,
    maxFeePerGas: 2n,
    maxPriorityFeePerGas: 1n,
  } as const
  const omitted = chainConfig.serializers.transaction(fields as never)
  const empty = chainConfig.serializers.transaction({
    ...fields,
    accessList: [],
    authorizationList: [],
  } as never)

  expect(omitted).not.toBe(empty)
  expect(
    Formatters.formatTransaction({ type: '0x40', nonce: '0x0' }).accessList,
  ).toBeUndefined()
  expect(
    Formatters.formatTransaction({ type: '0x40', nonce: '0x0', accessList: [] })
      .accessList,
  ).toEqual([])
})

test('validates canonical raw bytes separately from standard fields', () => {
  const raw = Transaction.serialize({ chainId: 143n, features: [] })
  expect(Formatters.formatTransaction({ type: '0x40', raw })).toHaveProperty(
    'raw',
    raw,
  )
  expect(() =>
    Formatters.formatTransaction({ type: '0x40', raw: '0x40c4818fc0c0' }),
  ).toThrow()
})

test('rejects unsafe numbers, out-of-range quantities, unsupported features, and RPC signing', () => {
  for (const [key, value] of [
    ['nonce', Number.MAX_SAFE_INTEGER + 1],
    ['nonce', -1n],
    ['nonce', 2n ** 64n],
    ['gas', 2n ** 64n],
    ['maxFeePerGas', 2n ** 256n],
    ['calls', []],
    ['feePayer', true],
    ['auxiliaryData', []],
    ['gasPrice', 1n],
    ['features', []],
    ['raw', '0x'],
  ])
    expect(() =>
      Formatters.formatTransactionRequest({
        ...request,
        [key as string]: value,
      }),
    ).toThrow()
  for (const nonce of ['0x', '0x00', '0x10000000000000000'] as const)
    expect(() =>
      Formatters.formatTransaction({ type: '0x40', nonce }),
    ).toThrow()
  for (const action of ['sendTransaction', 'signTransaction'])
    expect(() => Formatters.formatTransactionRequest(request, action)).toThrow(
      'local ECDSA account',
    )
})

test('delegates ordinary Ethereum transactions and receipts', () => {
  expect(
    Formatters.formatTransactionRequest({
      type: 'eip1559',
      nonce: 0,
      maxFeePerGas: 2n,
    }),
  ).toMatchInlineSnapshot(`
    {
      "maxFeePerGas": "0x2",
      "nonce": "0x0",
      "type": "0x2",
    }
  `)
  expect(
    Formatters.formatTransaction({ type: '0x2', nonce: '0x7' }),
  ).toHaveProperty('nonce', 7)
  expect(
    Formatters.formatTransactionReceipt({
      type: '0x40',
      status: '0x0',
      logs: [],
    }),
  ).toMatchInlineSnapshot(`
    {
      "blockNumber": null,
      "contractAddress": null,
      "cumulativeGasUsed": null,
      "effectiveGasPrice": null,
      "gasUsed": null,
      "logs": [],
      "status": "reverted",
      "to": null,
      "transactionIndex": null,
      "type": "monad",
    }
  `)
  expect(Formatters.formatTransactionReceipt({ type: '0x2' })).toHaveProperty(
    'type',
    'eip1559',
  )
})

test('full blocks preserve mixed transaction types and hash-only responses', () => {
  const block = {
    transactions: [
      { type: '0x2', nonce: '0x1' },
      { type: '0x40', nonce: '0xffffffffffffffff' },
    ],
  } as Parameters<typeof Formatters.formatBlock>[0]
  expect(Formatters.formatBlock(block)).toMatchObject({
    transactions: [
      { type: 'eip1559', nonce: 1 },
      { type: 'monad', nonce: 2n ** 64n - 1n },
    ],
  })
  expect(
    Formatters.formatBlock({ ...block, transactions: ['0xab'] }),
  ).toHaveProperty('transactions', ['0xab'])
  expect(Formatters.formatBlock({})).toHaveProperty('transactions', [])
})
