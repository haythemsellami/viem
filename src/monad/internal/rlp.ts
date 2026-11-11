import * as Hex from 'ox/Hex'
import * as Rlp from 'ox/Rlp'
import { BaseError } from '../../errors/base.js'
import type { Value } from '../Transaction.js'

/** Decodes one canonical RLP value using explicit list boundaries. */
export function decode(serialized: Hex.Hex): Value {
  const bytes = Hex.toBytes(serialized)
  const values: Value[] = []
  type Frame = { end: number; values: Value[] }
  const stack: Frame[] = [{ end: bytes.length, values }]
  let position = 0
  while (stack.length) {
    const frame = stack[stack.length - 1]!
    if (position === frame.end) {
      stack.pop()
      continue
    }
    const prefix = bytes[position++]!
    if (prefix < 0x80) {
      frame.values.push(Hex.fromBytes(bytes.subarray(position - 1, position)))
      continue
    }
    const isList = prefix >= 0xc0
    let length = prefix - (isList ? 0xc0 : 0x80)
    if (length > 55) {
      const size = length - 55
      if (size > frame.end - position)
        throw new InvalidRlpError('Truncated RLP length.')
      if (bytes[position] === 0)
        throw new InvalidRlpError('RLP lengths must not have leading zeros.')
      length = 0
      for (let i = 0; i < size; i++) length = length * 256 + bytes[position++]!
      if (length < 56)
        throw new InvalidRlpError(
          'RLP lengths below 56 must use the short form.',
        )
    }
    // Check before allocating or adding the length to the cursor. Even an
    // eight-byte length beyond number precision exceeds the remaining input.
    if (length > frame.end - position)
      throw new InvalidRlpError('RLP value exceeds its enclosing boundary.')
    const end = position + length
    if (isList) {
      const values: Value[] = []
      frame.values.push(values)
      stack.push({ end, values })
    } else {
      if (length === 1 && bytes[position]! < 0x80)
        throw new InvalidRlpError(
          'Single bytes below 0x80 must encode themselves.',
        )
      frame.values.push(Hex.fromBytes(bytes.subarray(position, end)))
      position = end
    }
  }
  if (values.length !== 1)
    throw new InvalidRlpError('Expected one RLP value without trailing bytes.')
  return values[0]!
}

export declare namespace decode {
  type ErrorType = InvalidRlpError | Hex.toBytes.ErrorType
}

/** Encodes a validated, acyclic value without recursively copying list bodies. */
export function encode(value: Value): Hex.Hex {
  type Frame = {
    index: number
    length: number
    prefix: number
    values: readonly Value[]
  }
  const stack: Frame[] = [{ index: 0, length: 0, prefix: -1, values: [value] }]
  const chunks: string[] = []
  while (stack.length) {
    const frame = stack[stack.length - 1]!
    if (frame.index === frame.values.length) {
      stack.pop()
      if (frame.prefix !== -1) {
        const prefix = listPrefix(frame.length)
        chunks[frame.prefix] = prefix.slice(2)
        frame.length += Hex.size(prefix)
      }
      const parent = stack[stack.length - 1]
      if (parent) parent.length += frame.length
      continue
    }
    const value = frame.values[frame.index++]!
    if (typeof value === 'string') {
      const encoded = Rlp.fromHex(value)
      chunks.push(encoded.slice(2))
      frame.length += Hex.size(encoded)
    } else {
      const prefix = chunks.length
      chunks.push('')
      stack.push({ index: 0, length: 0, prefix, values: value })
    }
  }
  return `0x${chunks.join('')}`
}

export declare namespace encode {
  type ErrorType = Rlp.fromHex.ErrorType | Hex.fromNumber.ErrorType
}

function listPrefix(length: number): Hex.Hex {
  if (length < 56) return Hex.fromNumber(0xc0 + length, { size: 1 })
  const hex = Hex.fromNumber(length)
  const size = Hex.size(hex)
  return Hex.concat(
    Hex.fromNumber(0xf7 + size, { size: 1 }),
    Hex.padLeft(hex, size),
  )
}

/** Thrown for noncanonical, truncated, or overlong RLP input. */
export class InvalidRlpError extends BaseError {
  override name = 'Monad.Rlp.InvalidRlpError'
}
