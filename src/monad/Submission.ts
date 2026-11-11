import * as Hex from 'ox/Hex'
import * as internal from './internal/rlp.js'
import * as Transaction from './Transaction.js'

/** A network submission containing a canonical transaction and empty auxiliary data. */
export type Serialized = `0x40${string}`

/**
 * Decodes a three-field network submission. Only empty auxiliary data is supported.
 * The returned canonical envelope is the object to hash, store, or sign.
 *
 * @example
 * import { Submission, Transaction } from 'viem/monad'
 * const envelope = Submission.deserialize('0x40c4818fc0c0')
 * const hash = Transaction.hash(envelope)
 *
 * @param serialized - Network bytes, including the empty auxiliary list.
 * @returns The canonical envelope, without auxiliary data.
 */
export function deserialize(serialized: Hex.Hex): Transaction.Envelope {
  if (
    !Hex.validate(serialized, { even: true, strict: true }) ||
    Hex.slice(serialized, 0, 1) !== '0x40'
  )
    throw new Transaction.InvalidEnvelopeError(
      'Expected transaction type 0x40.',
    )
  const decoded = internal.decode(Hex.slice(serialized, 1))
  if (
    !Array.isArray(decoded) ||
    decoded.length !== 3 ||
    !Array.isArray(decoded[2]) ||
    decoded[2].length !== 0
  )
    throw new Transaction.InvalidEnvelopeError(
      'Submission must contain [chainId, features, []].',
    )
  return Transaction.deserialize(
    Hex.concat('0x40', internal.encode(decoded.slice(0, 2))),
  )
}

export declare namespace deserialize {
  export type ReturnValue = Transaction.Envelope
  export type ErrorType = Transaction.deserialize.ErrorType
}

/**
 * Encodes a canonical envelope for `eth_sendRawTransaction` with empty auxiliary data.
 * Hash the canonical envelope with `Transaction.hash`, not these network bytes.
 *
 * @example
 * import { Submission } from 'viem/monad'
 * Submission.serialize({ chainId: 143n, features: [] })
 * // '0x40c4818fc0c0'
 *
 * @param envelope - The canonical envelope to submit.
 * @returns Three-field network bytes. No auxiliary features are added.
 */
export function serialize(envelope: Transaction.Envelope): Serialized {
  const canonical = Transaction.serialize(envelope)
  const fields = internal.decode(
    Hex.slice(canonical, 1),
  ) as readonly Transaction.Value[]
  return Hex.concat('0x40', internal.encode([...fields, []])) as Serialized
}

export declare namespace serialize {
  export type ReturnValue = Serialized
  export type ErrorType = Transaction.serialize.ErrorType
}
