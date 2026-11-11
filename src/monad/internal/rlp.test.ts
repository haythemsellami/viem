import { RLP } from '@ethereumjs/rlp'
import { encodeRlp } from 'ethers'
import fc from 'fast-check'
import * as Hex from 'ox/Hex'
import { describe, expect, test } from 'vitest'
import type { Value } from '../Transaction.js'
import * as internal from './rlp.js'

describe('encode and decode', () => {
  test.each([0, 1, 55, 56, 127, 128, 255, 256, 65_535, 65_536])(
    'matches independent codecs at length %i',
    (length) => {
      const bytes = `0x${'80'.repeat(length)}` as const
      const list = Array.from({ length }, () => '0x01' as const)
      for (const value of [bytes, list, ['0x00' as const, bytes, [], list]]) {
        const serialized = internal.encode(value)

        expect(serialized).toBe(encodeRlp(value))
        expect(internal.decode(serialized)).toEqual(value)
        expect(
          Hex.fromBytes(RLP.encode(RLP.decode(Hex.toBytes(serialized)))),
        ).toBe(serialized)
      }
    },
  )

  test('matches independent encoding and decoding for generated nested values', () => {
    const bytes = fc
      .uint8Array({ maxLength: 100 })
      .map((value) => Hex.fromBytes(value))
    const leaf = fc.oneof(bytes, fc.array(bytes, { maxLength: 8 }))
    const value = fc.oneof(leaf, fc.array(leaf, { maxLength: 8 }))

    fc.assert(
      fc.property(value, (value) => {
        const serialized = internal.encode(value)

        expect(serialized).toBe(encodeRlp(value))
        expect(internal.decode(serialized)).toEqual(value)
        expect(
          Hex.fromBytes(RLP.encode(RLP.decode(Hex.toBytes(serialized)))),
        ).toBe(serialized)
      }),
      { numRuns: 1000, seed: 0x40 },
    )
  })

  test('round trips a deeply nested independently constructed wire value', () => {
    let encoded = '80'
    const depth = 16_384
    // Wrap the complete encoded child bottom-up, independently of the encoder's
    // top-down traversal and deferred list prefixes.
    for (let i = 0; i < depth; i++) {
      const length = encoded.length / 2
      const prefix =
        length < 56
          ? (0xc0 + length).toString(16)
          : length <= 255
            ? `f8${length.toString(16).padStart(2, '0')}`
            : `f9${length.toString(16).padStart(4, '0')}`
      encoded = prefix + encoded
    }
    const serialized = `0x${encoded}` as const

    const decoded = internal.decode(serialized)
    let leaf: Value = decoded
    for (let i = 0; i < depth; i++) {
      if (typeof leaf === 'string' || leaf.length !== 1)
        throw new Error(`Unexpected RLP shape at depth ${i}.`)
      leaf = leaf[0]!
    }

    expect(leaf).toMatchInlineSnapshot('"0x"')
    expect(internal.encode(decoded)).toBe(serialized)
  })

  test.each([
    ['empty input', '0x'],
    ['trailing bytes', '0xc000'],
    ['nonminimal byte', '0x8100'],
    ['short string in long form', '0xb80101'],
    ['short list in long form', '0xf80101'],
    ['leading zero string length', `0xb90038${'80'.repeat(56)}`],
    ['leading zero list length', `0xf90038${'80'.repeat(56)}`],
    ['truncated string', '0x8280'],
    ['truncated list', '0xc280'],
    ['truncated string length', '0xb9ff'],
    ['truncated list length', '0xf9ff'],
    ['string exceeds list boundary', '0xc18180'],
    ['list exceeds parent boundary', '0xc1c180'],
    ['length crosses list boundary', `0xc1b838${'80'.repeat(56)}`],
    ['eight-byte string length', '0xbfffffffffffffffff'],
    ['eight-byte list length', '0xffffffffffffffffff'],
  ] as const)('rejects %s', (_, serialized) => {
    expect(() => internal.decode(serialized as Hex.Hex)).toThrow(
      internal.InvalidRlpError,
    )
  })
})
