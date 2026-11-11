import type { Address } from 'abitype'
import * as Hash from 'ox/Hash'
import * as Hex from 'ox/Hex'
import * as Secp256k1 from 'ox/Secp256k1'
import * as Signature from 'ox/Signature'
import type { LocalAccount } from '../accounts/types.js'
import { BaseError } from '../errors/base.js'
import { isAddressEqual } from '../utils/address/isAddressEqual.js'
import * as internal from './internal/rlp.js'

/** An RLP byte string or list. Unknown feature values retain this representation. */
export type Value = Hex.Hex | readonly Value[]

/** An ordered feature entry. The key is exactly one byte, including for key zero. */
export type Feature = readonly [key: Hex.Hex, value: Value]

/** The canonical Monad universal transaction envelope, without auxiliary data. */
export type Envelope = {
  /** Chain identifier, represented without JavaScript integer precision loss. */
  chainId: bigint
  /** Features with unique one-byte keys in ascending order. */
  features: readonly Feature[]
}

/** A serialized canonical Monad universal transaction. */
export type Serialized = `0x40${string}`

/**
 * Decodes a canonical envelope, preserving unknown features and omitted fields.
 * Validates RLP canonicality and the shape of present baseline fields, without
 * requiring a complete, signable transaction. Nested values are processed
 * iteratively without a fixed depth limit.
 *
 * @example
 * import { Transaction } from 'viem/monad'
 * const envelope = Transaction.deserialize('0x40c3818fc0')
 * // { chainId: 143n, features: [] }
 *
 * @param serialized - The two-element envelope prefixed with `0x40`.
 * @returns The decoded envelope.
 */
export function deserialize(serialized: Hex.Hex): Envelope {
  assertBytes(serialized, 'transaction')
  if (Hex.slice(serialized, 0, 1) !== '0x40')
    throw new InvalidEnvelopeError('Expected transaction type 0x40.')
  const body = Hex.slice(serialized, 1)
  const decoded = internal.decode(body)
  const [chainId, features] = tuple(decoded, 2, 'envelope')
  const envelope = {
    chainId: integer(chainId, 256, 'chainId'),
    features: featureMap(features, 'features'),
  }
  assertEnvelope(envelope)
  return envelope
}

export declare namespace deserialize {
  export type ReturnValue = Envelope
  export type ErrorType = InvalidEnvelopeError | internal.decode.ErrorType
}

/**
 * Builds a cleartext ECDSA envelope using the baseline feature registry.
 * Optional lists are omitted unless supplied; an explicit empty list is retained.
 *
 * @example
 * import { Transaction } from 'viem/monad'
 * const envelope = Transaction.from({
 *   chainId: 143, nonce: 7n, gas: 21_000n,
 *   to: '0x0000000000000000000000000000000000000001',
 *   value: 1_000_000_000_000_000_000n,
 *   maxPriorityFeePerGas: 2_000_000_000n, maxFeePerGas: 50_000_000_000n,
 * })
 *
 * @param parameters - Existing transaction fields to encode as features.
 * @returns An envelope with an empty signature list unless a signature is supplied.
 */
export function from(parameters: from.Parameters): Envelope {
  const {
    accessList,
    authorizationList,
    chainId,
    data = '0x',
    gas,
    maxFeePerGas,
    maxPriorityFeePerGas,
    nonce,
    signature,
    to,
    value = 0n,
  } = parameters
  if (typeof chainId === 'number' && !Number.isSafeInteger(chainId))
    throw new InvalidEnvelopeError('chainId must be a safe integer or bigint.')
  const envelope: Envelope = {
    chainId: BigInt(chainId),
    features: [
      ['0x01', encodeInteger(nonce, 64, 'nonce')],
      ['0x02', encodeInteger(gas, 64, 'gas')],
      [
        '0x03',
        [
          ['0x01', to ?? '0x'],
          ['0x02', encodeInteger(value, 256, 'value')],
          ['0x03', data],
        ],
      ],
      ...(accessList === undefined
        ? []
        : ([
            [
              '0x04',
              accessList.map(({ address, storageKeys }) => [
                address,
                storageKeys,
              ]),
            ],
          ] as const)),
      ...(authorizationList === undefined
        ? []
        : ([
            [
              '0x05',
              authorizationList.map(
                ({ address, chainId, nonce, r, s, yParity }) => [
                  encodeInteger(chainId, 256, 'authorization.chainId'),
                  address,
                  encodeInteger(nonce, 64, 'authorization.nonce'),
                  encodeInteger(BigInt(yParity), 8, 'authorization.yParity'),
                  encodeInteger(r, 256, 'authorization.r'),
                  encodeInteger(s, 256, 'authorization.s'),
                ],
              ),
            ],
          ] as const)),
      [
        '0x06',
        signature
          ? [
              encodeInteger(BigInt(signature.yParity), 8, 'signature.yParity'),
              encodeInteger(signature.r, 256, 'signature.r'),
              encodeInteger(signature.s, 256, 'signature.s'),
            ]
          : [],
      ],
      [
        '0x07',
        [
          encodeInteger(maxPriorityFeePerGas, 256, 'maxPriorityFeePerGas'),
          encodeInteger(maxFeePerGas, 256, 'maxFeePerGas'),
        ],
      ],
    ],
  }
  assertBaseline(envelope)
  return envelope
}

export declare namespace from {
  export type Parameters = {
    /** Optional EIP-2930 access list. Omission and an explicit empty list remain distinct. */
    accessList?:
      | readonly {
          /** Account accessed by the transaction. */
          address: Address
          /** Storage slots, each exactly 32 bytes. */
          storageKeys: readonly Hex.Hex[]
        }[]
      | undefined
    /** Optional existing EIP-7702 authorization tuples. Nonces retain all 64 bits. */
    authorizationList?:
      | readonly {
          /** Delegation target. */
          address: Address
          /** Authorization chain identifier; zero is permitted. */
          chainId: bigint
          /** Authority nonce. */
          nonce: bigint
          /** Signature r component. */
          r: bigint
          /** Signature s component. */
          s: bigint
          /** Signature recovery parity. */
          yParity: 0 | 1
        }[]
      | undefined
    /** Chain identifier. Numbers must be safe integers. */
    chainId: bigint | number
    /** Call data or contract initialization code. Defaults to empty bytes. */
    data?: Hex.Hex | undefined
    /** Gas limit, an unsigned 64-bit integer. */
    gas: bigint
    /** Maximum inclusion fee per gas. */
    maxFeePerGas: bigint
    /** Maximum priority fee per gas; cannot exceed maxFeePerGas. */
    maxPriorityFeePerGas: bigint
    /** Account nonce, an unsigned 64-bit integer. */
    nonce: bigint
    /** Sender signature. Omit to encode an empty RLP list for signing. */
    signature?: Signature.Signature | undefined
    /** Destination. Omit for contract creation (an empty destination byte string). */
    to?: Address | undefined
    /** Native token amount, in wei. Defaults to zero. */
    value?: bigint | undefined
  }
  export type ReturnValue = Envelope
  export type ErrorType = InvalidEnvelopeError | UnsupportedFeatureError
}

/**
 * Computes the baseline sender signing digest. Feature `0x06` remains present
 * with an empty RLP list; existing signature components do not affect the digest.
 * Unknown features and incomplete cleartext calls cannot be signed.
 *
 * @example
 * import { Transaction } from 'viem/monad'
 * const envelope = Transaction.from({ chainId: 143, nonce: 0n, gas: 21_000n, maxFeePerGas: 1n, maxPriorityFeePerGas: 0n })
 * const digest = Transaction.getSignPayload(envelope)
 *
 * @param envelope - A complete baseline envelope.
 * @returns The keccak256 digest to sign directly, without a personal-message prefix.
 */
export function getSignPayload(envelope: Envelope): Hex.Hex {
  assertBaseline(envelope)
  return hash({
    ...envelope,
    features: envelope.features.map(([key, value]) => [
      key,
      key === '0x06' ? [] : value,
    ]),
  })
}

export declare namespace getSignPayload {
  export type ReturnValue = Hex.Hex
  export type ErrorType = hash.ErrorType | UnsupportedFeatureError
}

/**
 * Hashes the canonical envelope, including its signature when present.
 * Unknown features are included unchanged. An unsigned envelope's hash is not
 * the final signed transaction's identifier.
 *
 * @example
 * import { Transaction } from 'viem/monad'
 * const hash = Transaction.hash(Transaction.deserialize('0x40c3818fc0'))
 *
 * @param envelope - The canonical transaction envelope.
 * @returns The keccak256 hash of the serialized envelope.
 */
export function hash(envelope: Envelope): Hex.Hex {
  return Hash.keccak256(serialize(envelope))
}

export declare namespace hash {
  export type ReturnValue = Hex.Hex
  export type ErrorType = serialize.ErrorType | Hash.keccak256.ErrorType
}

/**
 * Encodes `0x40 || rlp([chainId, features])`. Does not sort keys or add auxiliary
 * data. Present known fields are checked, while unknown values remain opaque.
 * Nested lists are processed iteratively; cyclic values are rejected.
 *
 * @example
 * import { Transaction } from 'viem/monad'
 * Transaction.serialize({ chainId: 143n, features: [] })
 * // '0x40c3818fc0'
 *
 * @param envelope - A structurally valid envelope with ordered features.
 * @returns The canonical transaction bytes.
 */
export function serialize(envelope: Envelope): Serialized {
  assertEnvelope(envelope)
  return Hex.concat(
    '0x40',
    internal.encode([
      encodeInteger(envelope.chainId, 256, 'chainId'),
      envelope.features,
    ]),
  ) as Serialized
}

export declare namespace serialize {
  export type ReturnValue = Serialized
  export type ErrorType = InvalidEnvelopeError | internal.encode.ErrorType
}

/**
 * Signs a baseline transaction with a local account's raw ECDSA signer.
 * Snapshots the envelope before awaiting the account and verifies the returned
 * signature against the account address before normalizing it to low-s and
 * encoding it. Normalization flips recovery parity when replacing s with n - s.
 *
 * @example
 * import { privateKeyToAccount } from 'viem/accounts'
 * import { Transaction } from 'viem/monad'
 * const account = privateKeyToAccount('0x0000000000000000000000000000000000000000000000000000000000000001')
 * const transaction = Transaction.from({ chainId: 143, nonce: 0n, gas: 21_000n, maxFeePerGas: 1n, maxPriorityFeePerGas: 0n })
 * const serialized = await Transaction.sign({ account, transaction })
 *
 * @param parameters - The account and complete baseline envelope.
 * @returns The signed canonical transaction bytes.
 */
export async function sign(parameters: sign.Parameters): Promise<Serialized> {
  const { account, transaction } = parameters
  const { address } = account
  if (!account.sign)
    throw new InvalidEnvelopeError('The account must support raw hash signing.')
  const envelope = deserialize(serialize(transaction))
  const payload = getSignPayload(envelope)
  const signed = await account.sign({ hash: payload })
  assertBytes(signed, 'signature', 65)
  const signature = Signature.fromHex(signed)
  Signature.assert(signature, { recovered: true })
  if (
    !isAddressEqual(Secp256k1.recoverAddress({ payload, signature }), address)
  )
    throw new InvalidEnvelopeError(
      'The signature does not match the account address.',
    )
  const order = Secp256k1.noble.CURVE.n
  if (signature.s > order / 2n) {
    signature.s = order - signature.s
    signature.yParity ^= 1
  }
  return serialize({
    ...envelope,
    features: envelope.features.map(([key, value]) => [
      key,
      key === '0x06'
        ? [
            encodeInteger(BigInt(signature.yParity), 8, 'signature.yParity'),
            encodeInteger(signature.r, 256, 'signature.r'),
            encodeInteger(signature.s, 256, 'signature.s'),
          ]
        : value,
    ]),
  })
}

export declare namespace sign {
  export type Parameters = {
    /** Local ECDSA account with raw hash signing support. */
    account: Pick<LocalAccount, 'address' | 'sign'>
    /** Complete baseline transaction. Existing sender signatures are replaced. */
    transaction: Envelope
  }
  export type ReturnValue = Serialized
  export type ErrorType =
    | getSignPayload.ErrorType
    | Signature.fromHex.ErrorType
    | Secp256k1.recoverAddress.ErrorType
    | Error
}

function assertBytes(
  value: unknown,
  name: string,
  size?: number,
): asserts value is Hex.Hex {
  if (
    typeof value !== 'string' ||
    !Hex.validate(value, { even: true, strict: true }) ||
    (size !== undefined && Hex.size(value) !== size)
  )
    throw new InvalidEnvelopeError(
      `${name} must be ${size === undefined ? 'an even-length hex byte string' : `exactly ${size} bytes`}.`,
    )
}

function list(value: unknown, name: string): readonly Value[] {
  if (!Array.isArray(value))
    throw new InvalidEnvelopeError(`${name} must be an RLP list.`)
  return value
}

function tuple(value: unknown, size: number, name: string): readonly Value[] {
  const values = list(value, name)
  if (values.length !== size)
    throw new InvalidEnvelopeError(
      `${name} must contain exactly ${size} elements.`,
    )
  return values
}

function integer(value: unknown, bits: number, name: string): bigint {
  assertBytes(value, name)
  if (Hex.size(value) > bits / 8 || value.slice(2, 4) === '00')
    throw new InvalidEnvelopeError(
      `${name} must be a minimally encoded uint${bits}.`,
    )
  return value === '0x' ? 0n : Hex.toBigInt(value)
}

function encodeInteger(value: bigint, bits: number, name: string): Hex.Hex {
  if (typeof value !== 'bigint' || value < 0n || value >= 1n << BigInt(bits))
    throw new InvalidEnvelopeError(`${name} must be a uint${bits} bigint.`)
  const hex = Hex.fromNumber(value)
  return value === 0n ? '0x' : Hex.padLeft(hex, Hex.size(hex))
}

function assertValue(value: unknown): void {
  type Frame = { index: number; values: readonly unknown[] }
  const stack: Frame[] = [{ index: 0, values: [value] }]
  const active = new Set<readonly unknown[]>()
  while (stack.length) {
    const frame = stack[stack.length - 1]!
    if (frame.index === frame.values.length) {
      active.delete(frame.values)
      stack.pop()
      continue
    }
    const item = frame.values[frame.index++]
    if (Array.isArray(item)) {
      if (active.has(item))
        throw new InvalidEnvelopeError(
          'Feature values must not contain cycles.',
        )
      active.add(item)
      stack.push({ index: 0, values: item })
    } else assertBytes(item, 'feature value')
  }
}

function featureMap(value: unknown, name: string): readonly Feature[] {
  const entries = list(value, name)
  let previous = -1
  for (const entry of entries) {
    const [key, value] = tuple(entry, 2, `${name} entry`)
    assertBytes(key, `${name} key`, 1)
    const current = Hex.toNumber(key)
    if (current <= previous)
      throw new InvalidEnvelopeError(
        `${name} keys must be unique and sorted ascending.`,
      )
    previous = current
    assertValue(value)
  }
  return entries as readonly Feature[]
}

function assertEnvelope(envelope: Envelope): void {
  encodeInteger(envelope.chainId, 256, 'chainId')
  for (const [key, value] of featureMap(envelope.features, 'features')) {
    switch (key.toLowerCase()) {
      case '0x01':
      case '0x02':
        integer(value, 64, key === '0x01' ? 'nonce' : 'gas')
        break
      case '0x03':
        for (const [field, value_] of featureMap(value, 'call')) {
          if (field === '0x01' && value_ !== '0x')
            assertBytes(value_, 'destination', 20)
          if (field === '0x02') integer(value_, 256, 'value')
          if (field === '0x03') assertBytes(value_, 'data')
        }
        break
      case '0x04':
        for (const entry of list(value, 'accessList')) {
          const [address, storageKeys] = tuple(entry, 2, 'accessList entry')
          assertBytes(address, 'accessList address', 20)
          for (const key of list(storageKeys, 'storageKeys'))
            assertBytes(key, 'storage key', 32)
        }
        break
      case '0x05':
        for (const entry of list(value, 'authorizationList')) {
          const [chainId, address, nonce, yParity, r, s] = tuple(
            entry,
            6,
            'authorization',
          )
          integer(chainId, 256, 'authorization.chainId')
          assertBytes(address, 'authorization.address', 20)
          integer(nonce, 64, 'authorization.nonce')
          integer(yParity, 8, 'authorization.yParity')
          integer(r, 256, 'authorization.r')
          integer(s, 256, 'authorization.s')
        }
        break
      case '0x06':
        if (list(value, 'signature').length) {
          const [yParity, r, s] = tuple(value, 3, 'signature')
          integer(yParity, 8, 'signature.yParity')
          integer(r, 256, 'signature.r')
          integer(s, 256, 'signature.s')
        }
        break
      case '0x07': {
        const [priority, max] = tuple(value, 2, 'inclusion gas bid')
        integer(priority, 256, 'maxPriorityFeePerGas')
        integer(max, 256, 'maxFeePerGas')
      }
    }
  }
}

function assertBaseline(envelope: Envelope): void {
  assertEnvelope(envelope)
  for (const [key] of envelope.features)
    if (Hex.toNumber(key) < 1 || Hex.toNumber(key) > 7)
      throw new UnsupportedFeatureError(key)
  for (const key of ['0x01', '0x02', '0x03', '0x06', '0x07'])
    if (!envelope.features.some(([feature]) => feature === key))
      throw new InvalidEnvelopeError(
        `Baseline signing requires feature ${key}.`,
      )
  const call = featureMap(
    envelope.features.find(([key]) => key === '0x03')![1],
    'call',
  )
  for (const [key] of call)
    if (!['0x01', '0x02', '0x03'].includes(key))
      throw new UnsupportedFeatureError(key, 'call field')
  if (call.length !== 3)
    throw new InvalidEnvelopeError(
      'Baseline signing requires destination, value, and data.',
    )
  const [priority, max] = tuple(
    envelope.features.find(([key]) => key === '0x07')![1],
    2,
    'inclusion gas bid',
  )
  if (
    integer(priority, 256, 'maxPriorityFeePerGas') >
    integer(max, 256, 'maxFeePerGas')
  )
    throw new InvalidEnvelopeError(
      'maxPriorityFeePerGas cannot exceed maxFeePerGas.',
    )
}

/** Thrown for a malformed envelope, incomplete baseline, or invalid signing result. */
export class InvalidEnvelopeError extends BaseError {
  override name = 'Monad.Transaction.InvalidEnvelopeError'
}

/** Thrown when baseline signing encounters a feature whose signing rules are unknown. */
export class UnsupportedFeatureError extends BaseError {
  override name = 'Monad.Transaction.UnsupportedFeatureError'
  constructor(key: Hex.Hex, kind = 'feature') {
    super(`Unsupported ${kind} ${key} for baseline signing.`)
  }
}
