import { encodeRlp, keccak256, recoverAddress, SigningKey } from 'ethers'
import * as Rlp from 'ox/Rlp'
import * as Signature from 'ox/Signature'
import { type Hex, parseTransaction } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { Transaction } from 'viem/monad'
import { describe, expect, test } from 'vitest'

const privateKey =
  '0x0000000000000000000000000000000000000000000000000000000000000001'
const account = privateKeyToAccount(privateKey)
const destination = '0x0000000000000000000000000000000000000002'
const parameters = {
  chainId: 143,
  nonce: 7n,
  gas: 21_000n,
  to: destination,
  value: 1_000_000_000_000_000_000n,
  maxPriorityFeePerGas: 2_000_000_000n,
  maxFeePerGas: 50_000_000_000n,
} as const

// Independent RLP construction of the draft's baseline example.
const fields = [
  '0x8f',
  [
    ['0x01', '0x07'],
    ['0x02', '0x5208'],
    [
      '0x03',
      [
        ['0x01', destination],
        ['0x02', '0x0de0b6b3a7640000'],
        ['0x03', '0x'],
      ],
    ],
    ['0x06', []],
    ['0x07', ['0x77359400', '0x0ba43b7400']],
  ],
]

function replaceFeature(
  envelope: Transaction.Envelope,
  key: Hex,
  value: Transaction.Value,
): Transaction.Envelope {
  return {
    ...envelope,
    features: envelope.features.map(([k, v]) => [k, k === key ? value : v]),
  }
}

describe('from', () => {
  test('builds the baseline example and matches independently encoded bytes', () => {
    const transaction = Transaction.from(parameters)
    const serialized = Transaction.serialize(transaction)

    expect(serialized).toBe(`0x40${encodeRlp(fields).slice(2)}`)
    expect(Transaction.deserialize(serialized)).toEqual(transaction)
    expect(transaction).toMatchInlineSnapshot(`
      {
        "chainId": 143n,
        "features": [
          [
            "0x01",
            "0x07",
          ],
          [
            "0x02",
            "0x5208",
          ],
          [
            "0x03",
            [
              [
                "0x01",
                "0x0000000000000000000000000000000000000002",
              ],
              [
                "0x02",
                "0x0de0b6b3a7640000",
              ],
              [
                "0x03",
                "0x",
              ],
            ],
          ],
          [
            "0x06",
            [],
          ],
          [
            "0x07",
            [
              "0x77359400",
              "0x0ba43b7400",
            ],
          ],
        ],
      }
    `)
    expect(serialized).toMatchInlineSnapshot(
      `"0x40f845818ff841c20107c402825208e703e5d601940000000000000000000000000000000000000002ca02880de0b6b3a7640000c20380c206c0cd07cb8477359400850ba43b7400"`,
    )
  })

  test('encodes contract creation and zero integers distinctly from an empty signature list', () => {
    const transaction = Transaction.from({
      chainId: 0n,
      nonce: 0n,
      gas: 0n,
      maxFeePerGas: 0n,
      maxPriorityFeePerGas: 0n,
      data: '0x60006000f3',
    })

    expect(
      Transaction.deserialize(Transaction.serialize(transaction)),
    ).toMatchInlineSnapshot(`
      {
        "chainId": 0n,
        "features": [
          [
            "0x01",
            "0x",
          ],
          [
            "0x02",
            "0x",
          ],
          [
            "0x03",
            [
              [
                "0x01",
                "0x",
              ],
              [
                "0x02",
                "0x",
              ],
              [
                "0x03",
                "0x60006000f3",
              ],
            ],
          ],
          [
            "0x06",
            [],
          ],
          [
            "0x07",
            [
              "0x",
              "0x",
            ],
          ],
        ],
      }
    `)
  })

  test('preserves full uint64 and uint256 values and optional lists', () => {
    const transaction = Transaction.from({
      ...parameters,
      chainId: (1n << 256n) - 1n,
      nonce: (1n << 64n) - 1n,
      gas: (1n << 64n) - 1n,
      value: (1n << 256n) - 1n,
      maxFeePerGas: (1n << 256n) - 1n,
      maxPriorityFeePerGas: (1n << 256n) - 1n,
      accessList: [
        {
          address: destination,
          storageKeys: [`0x${'00'.repeat(32)}`, `0x${'ff'.repeat(32)}`],
        },
      ],
      authorizationList: [
        {
          chainId: (1n << 256n) - 1n,
          address: destination,
          nonce: (1n << 64n) - 1n,
          yParity: 1,
          r: 1n,
          s: 2n,
        },
      ],
      signature: { yParity: 1, r: 3n, s: 4n },
    })
    const decoded = Transaction.deserialize(Transaction.serialize(transaction))

    expect(decoded).toEqual(transaction)
    expect(decoded).toMatchInlineSnapshot(`
      {
        "chainId": 115792089237316195423570985008687907853269984665640564039457584007913129639935n,
        "features": [
          [
            "0x01",
            "0xffffffffffffffff",
          ],
          [
            "0x02",
            "0xffffffffffffffff",
          ],
          [
            "0x03",
            [
              [
                "0x01",
                "0x0000000000000000000000000000000000000002",
              ],
              [
                "0x02",
                "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
              ],
              [
                "0x03",
                "0x",
              ],
            ],
          ],
          [
            "0x04",
            [
              [
                "0x0000000000000000000000000000000000000002",
                [
                  "0x0000000000000000000000000000000000000000000000000000000000000000",
                  "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
                ],
              ],
            ],
          ],
          [
            "0x05",
            [
              [
                "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
                "0x0000000000000000000000000000000000000002",
                "0xffffffffffffffff",
                "0x01",
                "0x01",
                "0x02",
              ],
            ],
          ],
          [
            "0x06",
            [
              "0x01",
              "0x03",
              "0x04",
            ],
          ],
          [
            "0x07",
            [
              "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
              "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            ],
          ],
        ],
      }
    `)
  })

  test('preserves absent versus explicit empty access and authorization lists', () => {
    const absent = Transaction.from(parameters)
    const empty = Transaction.from({
      ...parameters,
      accessList: [],
      authorizationList: [],
    })

    expect(absent.features.map(([key]) => key)).toMatchInlineSnapshot(`
      [
        "0x01",
        "0x02",
        "0x03",
        "0x06",
        "0x07",
      ]
    `)
    expect(
      Transaction.deserialize(Transaction.serialize(empty)).features,
    ).toEqual(empty.features)
    expect(Transaction.getSignPayload(absent)).not.toBe(
      Transaction.getSignPayload(empty),
    )
  })

  test.each([
    ['unsafe chainId', { chainId: Number.MAX_SAFE_INTEGER + 1 }],
    ['fractional chainId', { chainId: 1.5 }],
    ['negative chainId', { chainId: -1n }],
    ['overflowing chainId', { chainId: 1n << 256n }],
    ['negative nonce', { nonce: -1n }],
    ['overflowing nonce', { nonce: 1n << 64n }],
    ['overflowing gas', { gas: 1n << 64n }],
    ['overflowing amount', { value: 1n << 256n }],
    ['overflowing fee', { maxFeePerGas: 1n << 256n }],
    [
      'priority above cap',
      { maxPriorityFeePerGas: parameters.maxFeePerGas + 1n },
    ],
  ])('rejects %s', (_, overrides) => {
    expect(() => Transaction.from({ ...parameters, ...overrides })).toThrow(
      Transaction.InvalidEnvelopeError,
    )
  })
})

describe('serialize and deserialize', () => {
  test.each([4096, 16_384])(
    'preserves unknown values nested %i levels deep',
    (depth) => {
      let value: Transaction.Value = '0x0001ff'
      for (let i = 0; i < depth; i++) value = [value]
      const transaction: Transaction.Envelope = {
        chainId: 143n,
        features: [
          ['0x03', [['0xff', value]]],
          ['0xff', value],
        ],
      }

      const serialized = Transaction.serialize(transaction)
      const decoded = Transaction.deserialize(serialized)
      let leaf = decoded.features[1]![1]
      for (let i = 0; i < depth; i++) {
        if (typeof leaf === 'string' || leaf.length !== 1)
          throw new Error(`Unexpected RLP shape at depth ${i}.`)
        leaf = leaf[0]!
      }

      expect(leaf).toMatchInlineSnapshot('"0x0001ff"')
      expect(Transaction.serialize(decoded)).toBe(serialized)
      expect(Transaction.hash(decoded)).toBe(keccak256(serialized))
      expect(() => Transaction.getSignPayload(decoded)).toThrow(
        Transaction.UnsupportedFeatureError,
      )
    },
  )

  test('rejects cyclic values but preserves shared acyclic lists', () => {
    const leaf: Transaction.Value[] = ['0x00', []]
    const value: Transaction.Value[] = [leaf, leaf]
    const transaction: Transaction.Envelope = {
      chainId: 143n,
      features: [['0xff', value]],
    }

    const raw = Transaction.serialize(transaction)

    expect(raw).toBe(
      `0x40${encodeRlp([
        '0x8f',
        [
          [
            '0xff',
            [
              ['0x00', []],
              ['0x00', []],
            ],
          ],
        ],
      ]).slice(2)}`,
    )
    expect(Transaction.deserialize(raw)).toEqual(transaction)

    leaf.push(value)

    expect(() => Transaction.serialize(transaction)).toThrow(
      Transaction.InvalidEnvelopeError,
    )
    expect(() => Transaction.hash(transaction)).toThrow(
      'must not contain cycles',
    )
  })

  test('preserves opaque nested values, high-byte keys, and zero-byte keys', () => {
    const transaction: Transaction.Envelope = {
      chainId: 143n,
      features: [
        ['0x00', '0x0000'],
        ['0x80', ['0xc0', [], [['0x0001', '0xff']]]],
        ['0xff', '0x'],
      ],
    }
    const serialized = Transaction.serialize(transaction)

    expect(Transaction.deserialize(serialized)).toEqual(transaction)
    expect(Transaction.serialize(Transaction.deserialize(serialized))).toBe(
      serialized,
    )
    expect(Transaction.hash(transaction)).toBe(keccak256(serialized))
    expect(() => Transaction.getSignPayload(transaction)).toThrow(
      Transaction.UnsupportedFeatureError,
    )
  })

  test('can decode incomplete cleartext calls and unknown call fields', () => {
    const transaction: Transaction.Envelope = {
      chainId: 143n,
      features: [
        [
          '0x03',
          [
            ['0x01', destination],
            ['0x80', ['0x', []]],
          ],
        ],
      ],
    }

    expect(Transaction.deserialize(Transaction.serialize(transaction))).toEqual(
      transaction,
    )
  })

  test('accepts uppercase hex without changing bytes', () => {
    const serialized = Transaction.serialize(
      Transaction.from({ ...parameters, data: '0xABCD' }),
    )

    expect(
      Transaction.serialize(
        Transaction.deserialize(`0x${serialized.slice(2).toUpperCase()}`),
      ),
    ).toBe(serialized.toLowerCase())
  })

  test.each([
    ['auxiliary data', `0x40${encodeRlp(['0x8f', [], []]).slice(2)}`],
    ['missing features', `0x40${encodeRlp(['0x8f']).slice(2)}`],
    ['wrong type', '0x02c3818fc0'],
    ['empty input', '0x'],
    ['odd hex', '0x40c'],
    ['nonhex characters', '0x40zz'],
    ['truncated RLP', '0x40c3818f'],
    ['no RLP', '0x40'],
    ['trailing bytes', '0x40c3818fc000'],
    ['list boundary overrun', '0x40c2818fc0'],
    ['nonminimal byte encoding', '0x40c38101c0'],
    ['nonminimal list length', '0x40f803818fc0'],
    ['leading zero chainId', `0x40${encodeRlp(['0x008f', []]).slice(2)}`],
    ['zero as a zero byte', `0x40${encodeRlp(['0x00', []]).slice(2)}`],
    ['features byte string', `0x40${encodeRlp(['0x8f', '0x']).slice(2)}`],
  ])('rejects %s', (_, serialized) => {
    expect(() => Transaction.deserialize(serialized as Hex)).toThrow()
  })

  test.each<{ name: string; features: readonly Transaction.Feature[] }>([
    {
      name: 'duplicate features',
      features: [
        ['0x01', '0x'],
        ['0x01', '0x'],
      ],
    },
    {
      name: 'unsorted features',
      features: [
        ['0x02', '0x'],
        ['0x01', '0x'],
      ],
    },
    { name: 'empty key', features: [['0x', '0x']] },
    { name: 'multibyte key', features: [['0x0100', '0x']] },
    { name: 'odd byte string', features: [['0xff', '0x1']] },
    { name: 'invalid hex', features: [['0xff', '0xgg']] },
    { name: 'nonce leading zero', features: [['0x01', '0x0001']] },
    { name: 'nonce overflow', features: [['0x01', '0x010000000000000000']] },
    { name: 'nonce list', features: [['0x01', []]] },
    { name: 'gas overflow', features: [['0x02', '0x010000000000000000']] },
    { name: 'call byte string', features: [['0x03', '0x']] },
    {
      name: 'unsorted call',
      features: [
        [
          '0x03',
          [
            ['0x02', '0x'],
            ['0x01', destination],
          ],
        ],
      ],
    },
    {
      name: 'duplicate call field',
      features: [
        [
          '0x03',
          [
            ['0x01', destination],
            ['0x01', destination],
          ],
        ],
      ],
    },
    { name: 'short destination', features: [['0x03', [['0x01', '0x01']]]] },
    { name: 'nonminimal amount', features: [['0x03', [['0x02', '0x00']]]] },
    { name: 'list calldata', features: [['0x03', [['0x03', []]]]] },
    { name: 'access list byte string', features: [['0x04', '0x']] },
    { name: 'access list entry shape', features: [['0x04', [[destination]]]] },
    { name: 'access list address', features: [['0x04', [['0x', []]]]] },
    { name: 'storage keys shape', features: [['0x04', [[destination, '0x']]]] },
    {
      name: 'storage key width',
      features: [['0x04', [[destination, ['0x01']]]]],
    },
    { name: 'authorization shape', features: [['0x05', [[]]]] },
    {
      name: 'authorization chainId',
      features: [['0x05', [['0x00', destination, '0x', '0x', '0x01', '0x01']]]],
    },
    {
      name: 'authorization address',
      features: [['0x05', [['0x', '0x', '0x', '0x', '0x01', '0x01']]]],
    },
    {
      name: 'authorization nonce',
      features: [
        [
          '0x05',
          [['0x', destination, '0x010000000000000000', '0x', '0x01', '0x01']],
        ],
      ],
    },
    {
      name: 'authorization parity width',
      features: [
        ['0x05', [['0x', destination, '0x', '0x0100', '0x01', '0x01']]],
      ],
    },
    {
      name: 'authorization r',
      features: [['0x05', [['0x', destination, '0x', '0x', '0x00', '0x01']]]],
    },
    {
      name: 'authorization s',
      features: [['0x05', [['0x', destination, '0x', '0x', '0x01', '0x00']]]],
    },
    { name: 'signature placeholder byte', features: [['0x06', '0xc0']] },
    { name: 'signature arity', features: [['0x06', ['0x', '0x01']]] },
    {
      name: 'signature parity width',
      features: [['0x06', ['0x0100', '0x01', '0x01']]],
    },
    { name: 'signature r', features: [['0x06', ['0x', '0x00', '0x01']]] },
    { name: 'signature s', features: [['0x06', ['0x', '0x01', '0x00']]] },
    { name: 'fee tuple arity', features: [['0x07', ['0x01']]] },
    {
      name: 'fee width',
      features: [['0x07', ['0x', `0x01${'00'.repeat(32)}`]]],
    },
  ])('rejects $name', ({ features }) => {
    expect(() => Transaction.serialize({ chainId: 143n, features })).toThrow(
      Transaction.InvalidEnvelopeError,
    )
  })

  test('rejects malformed feature entries and non-byte runtime values', () => {
    for (const features of [
      [[]],
      [['0x01']],
      [['0x01', '0x', '0x']],
      [['0xff', [42]]],
    ])
      expect(() =>
        Transaction.serialize({
          chainId: 143n,
          features,
        } as unknown as Transaction.Envelope),
      ).toThrow(Transaction.InvalidEnvelopeError)
  })

  test('validates known fields on decoding, including malformed received key order', () => {
    for (const features of [
      [['0x01', '0x00']],
      [
        ['0x02', '0x'],
        ['0x01', '0x'],
      ],
      [['0x06', '0xc0']],
    ]) {
      const raw = `0x40${encodeRlp(['0x8f', features]).slice(2)}` as Hex

      expect(() => Transaction.deserialize(raw)).toThrow(
        Transaction.InvalidEnvelopeError,
      )
    }
  })

  test('does not extend the generic Ethereum parser', () => {
    expect(() =>
      parseTransaction(Transaction.serialize(Transaction.from(parameters))),
    ).toThrow()
  })
})

describe('getSignPayload and hash', () => {
  test('uses the empty list in the retained signature slot and separates signed identity', async () => {
    const transaction = Transaction.from(parameters)
    const payload = Transaction.getSignPayload(transaction)
    const raw = await Transaction.sign({ account, transaction })
    const signed = Transaction.deserialize(raw)

    expect(payload).toBe(keccak256(`0x40${encodeRlp(fields).slice(2)}`))
    expect(Transaction.getSignPayload(signed)).toBe(payload)
    expect(Transaction.hash(signed)).toBe(keccak256(raw))
    expect(Transaction.hash(signed)).not.toBe(payload)
    expect(payload).toMatchInlineSnapshot(
      `"0x28c7c329dfe2c25987d0c4039f187bcd972562f301bfdf474d9cda9c695272ba"`,
    )
    expect(Transaction.hash(signed)).toMatchInlineSnapshot(
      `"0x1af324647ba3a40fd6e4836eb9896d6c424256b4cdb2d88f0c02a01894105a5b"`,
    )

    const withoutSignature = {
      ...transaction,
      features: transaction.features.filter(([key]) => key !== '0x06'),
    }
    expect(Transaction.hash(withoutSignature)).not.toBe(payload)
    const wrongPlaceholder = transaction.features.map(([key, value]) => [
      key,
      key === '0x06' ? '0xc0' : value,
    ])
    expect(
      keccak256(`0x40${Rlp.fromHex(['0x8f', wrongPlaceholder]).slice(2)}`),
    ).not.toBe(payload)
  })

  test.each(['0x01', '0x02', '0x03', '0x06', '0x07'])(
    'requires baseline feature %s',
    (missing) => {
      const transaction = Transaction.from(parameters)
      const incomplete = {
        ...transaction,
        features: transaction.features.filter(([key]) => key !== missing),
      }

      expect(() => Transaction.getSignPayload(incomplete)).toThrow(
        `Baseline signing requires feature ${missing}`,
      )
    },
  )

  test('rejects unknown features and incomplete or extended calls for signing', async () => {
    const baseline = Transaction.from(parameters)
    const extended: Transaction.Envelope = {
      ...baseline,
      features: [...baseline.features, ['0x80', []]],
    }
    const incomplete = replaceFeature(baseline, '0x03', [['0x01', destination]])
    const extendedCall = replaceFeature(baseline, '0x03', [
      ['0x01', destination],
      ['0x02', '0x'],
      ['0x03', '0x'],
      ['0x04', []],
    ])

    expect(() => Transaction.getSignPayload(extended)).toThrow(
      Transaction.UnsupportedFeatureError,
    )
    expect(() => Transaction.getSignPayload(incomplete)).toThrow(
      'requires destination, value, and data',
    )
    expect(() => Transaction.getSignPayload(extendedCall)).toThrow(
      Transaction.UnsupportedFeatureError,
    )
    await expect(
      Transaction.sign({ account, transaction: extended }),
    ).rejects.toThrow(Transaction.UnsupportedFeatureError)
  })

  test('commits to every non-signature feature', () => {
    const baseline = Transaction.from(parameters)
    const digest = Transaction.getSignPayload(baseline)
    const alternatives = [
      { ...parameters, chainId: 144 },
      { ...parameters, nonce: 8n },
      { ...parameters, gas: 22_000n },
      { ...parameters, to: account.address },
      { ...parameters, value: 1n },
      { ...parameters, data: '0x01' as Hex },
      { ...parameters, maxFeePerGas: parameters.maxFeePerGas + 1n },
      {
        ...parameters,
        maxPriorityFeePerGas: parameters.maxPriorityFeePerGas + 1n,
      },
      { ...parameters, accessList: [] },
      { ...parameters, authorizationList: [] },
    ]

    for (const parameters of alternatives)
      expect(Transaction.getSignPayload(Transaction.from(parameters))).not.toBe(
        digest,
      )
  })
})

describe('sign', () => {
  test.each([0n, 7n])(
    'normalizes a high-s signer at nonce %s without rewriting received signatures',
    async (nonce) => {
      const transaction = Transaction.from({ ...parameters, nonce })
      const digest = Transaction.getSignPayload(transaction)
      const signature = Signature.fromHex(await account.sign({ hash: digest }))
      const order =
        0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n
      const high = {
        ...signature,
        s: order - signature.s,
        yParity: signature.yParity ^ 1,
      }
      const received = Transaction.from({
        ...parameters,
        nonce,
        signature: high,
      })
      const receivedBytes = Transaction.serialize(received)
      const highAccount = {
        address: account.address,
        async sign({ hash }: { hash: Hex }) {
          const signature = Signature.fromHex(await account.sign({ hash }))
          return Signature.toHex({
            ...signature,
            s: order - signature.s,
            yParity: signature.yParity ^ 1,
          })
        },
      }

      const expected = await Transaction.sign({ account, transaction })
      const serialized = await Transaction.sign({
        account: highAccount,
        transaction: received,
      })
      const decoded = Transaction.deserialize(serialized)

      expect(high.s > order / 2n).toBe(true)
      expect(serialized).toBe(expected)
      expect(Transaction.getSignPayload(decoded)).toBe(digest)
      expect(Transaction.hash(decoded)).toBe(keccak256(expected))
      expect(Transaction.hash(decoded)).not.toBe(keccak256(receivedBytes))
      expect(
        Transaction.serialize(Transaction.deserialize(receivedBytes)),
      ).toBe(receivedBytes)
      expect(Transaction.serialize(received)).toBe(receivedBytes)
    },
  )

  test('matches independent ECDSA signing and recovers the sender', async () => {
    const transaction = Transaction.from(parameters)
    const before = structuredClone(transaction)
    const raw = await Transaction.sign({ account, transaction })
    const signature = new SigningKey(privateKey).sign(
      keccak256(`0x40${encodeRlp(fields).slice(2)}`),
    )
    const decoded = Transaction.deserialize(raw)
    const tuple = decoded.features.find(([key]) => key === '0x06')?.[1]

    expect(tuple).toEqual([
      signature.yParity ? '0x01' : '0x',
      signature.r,
      signature.s,
    ])
    expect(recoverAddress(Transaction.getSignPayload(decoded), signature)).toBe(
      account.address,
    )
    expect(raw).toMatchInlineSnapshot(
      `"0x40f88a818ff886c20107c402825208e703e5d601940000000000000000000000000000000000000002ca02880de0b6b3a7640000c20380f84606f84380a0d7ba41089d4b5f34a71ec49a06dfa32668e65c6c6823882a965df9dec2684279a051e2bd8636bc7e96be8215b50f52ef0b2efc957a45f7504e513ff9b799a70a5ccd07cb8477359400850ba43b7400"`,
    )
    expect(transaction).toEqual(before)
    expect(await Transaction.sign({ account, transaction: decoded })).toBe(raw)
  })

  test('snapshots the transaction before awaiting the signer', async () => {
    const transaction = Transaction.from(parameters)
    const expected = await Transaction.sign({ account, transaction })
    const pending = Transaction.sign({ account, transaction })
    transaction.chainId = 999n
    ;(transaction.features[0] as [Hex, Transaction.Value])[1] = '0x08'

    expect(await pending).toBe(expected)
  })

  test('rejects an account without raw signing', async () => {
    await expect(
      Transaction.sign({
        account: { address: account.address },
        transaction: Transaction.from(parameters),
      }),
    ).rejects.toThrow('must support raw hash signing')
  })

  test('rejects a misconfigured account whose signer belongs to another address', async () => {
    await expect(
      Transaction.sign({
        account: { ...account, address: destination },
        transaction: Transaction.from(parameters),
      }),
    ).rejects.toThrow('does not match the account address')
  })

  test('rejects a signer adapter that omits recovery parity', async () => {
    const compactAccount = {
      address: account.address,
      async sign({ hash }: { hash: Hex }) {
        const signature = await account.sign({ hash })
        return signature.slice(0, 130) as Hex
      },
    }

    await expect(
      Transaction.sign({
        account: compactAccount,
        transaction: Transaction.from(parameters),
      }),
    ).rejects.toThrow('signature must be exactly 65 bytes')
  })
})
