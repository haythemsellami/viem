import * as Hex from 'ox/Hex'
import * as Secp256k1 from 'ox/Secp256k1'
import * as Signature from 'ox/Signature'
import type { Account } from '../../accounts/types.js'
import type { Signature as EthereumSignature } from '../../types/misc.js'
import type { TransactionSerializable } from '../../types/transaction.js'
import { isAddressEqual } from '../../utils/address/isAddressEqual.js'
import { serializeTransaction as serializeEthereumTransaction } from '../../utils/transaction/serializeTransaction.js'
import type * as Formatters from '../Formatters.js'
import * as Transaction from '../Transaction.js'

export function quantity(
  value: bigint | number | Hex.Hex,
  bits: number,
  name: string,
): bigint {
  if (typeof value === 'number' && !Number.isSafeInteger(value))
    throw new Transaction.InvalidEnvelopeError(
      `${name} must be a safe integer or bigint.`,
    )
  if (typeof value === 'string' && !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value))
    throw new Transaction.InvalidEnvelopeError(
      `${name} must be an RPC quantity.`,
    )
  const result = BigInt(value)
  if (result < 0n || result >= 1n << BigInt(bits))
    throw new Transaction.InvalidEnvelopeError(`${name} must fit uint${bits}.`)
  return result
}

export function assertRequest(request: Formatters.TransactionRequestMonad) {
  for (const key of [
    'gasPrice',
    'calls',
    'feePayer',
    'auxiliaryData',
    'features',
    'raw',
    'blobs',
    'blobVersionedHashes',
    'maxFeePerBlobGas',
    'sidecars',
    'kzg',
  ])
    if ((request as unknown as Record<string, unknown>)[key] !== undefined)
      throw new Transaction.InvalidEnvelopeError(
        `${key} is not supported by baseline Monad requests.`,
      )
  for (const [key, bits] of [
    ['nonce', 64],
    ['gas', 64],
    ['value', 256],
    ['maxFeePerGas', 256],
    ['maxPriorityFeePerGas', 256],
    ['chainId', 256],
  ] as const)
    if (request[key] !== undefined) quantity(request[key], bits, key)
}

export function serializeTransaction(
  request: Formatters.TransactionRequest | TransactionSerializable,
  signature?: EthereumSignature | undefined,
) {
  if (request.type !== 'monad')
    return serializeEthereumTransaction(
      request as TransactionSerializable,
      signature,
    )
  assertRequest(request)
  for (const key of [
    'chainId',
    'nonce',
    'gas',
    'maxFeePerGas',
    'maxPriorityFeePerGas',
  ] as const)
    if (request[key] === undefined)
      throw new Transaction.InvalidEnvelopeError(
        `${key} is required for signing.`,
      )
  const envelope = Transaction.from({
    ...request,
    chainId: request.chainId!,
    nonce: quantity(request.nonce!, 64, 'nonce'),
    gas: request.gas!,
    maxFeePerGas: request.maxFeePerGas!,
    maxPriorityFeePerGas: request.maxPriorityFeePerGas!,
    to: request.to ?? undefined,
    authorizationList: request.authorizationList?.map((authorization) => ({
      ...authorization,
      chainId: quantity(authorization.chainId, 256, 'authorization.chainId'),
      nonce: quantity(authorization.nonce, 64, 'authorization.nonce'),
      r: BigInt(authorization.r),
      s: BigInt(authorization.s),
    })),
    signature: undefined,
  })
  if (!signature) return Transaction.serialize(envelope)
  const normalized = Signature.from({
    r: BigInt(signature.r),
    s: BigInt(signature.s),
    yParity:
      signature.yParity ??
      Number(
        signature.v === 0n || signature.v === 1n
          ? signature.v
          : signature.v! - 27n,
      ),
  })
  Signature.assert(normalized, { recovered: true })
  type WithAccount = Formatters.TransactionRequestMonad & {
    account?: Account | undefined
  }
  const { account, from } = request as WithAccount
  const address = account?.address ?? from
  if (
    address &&
    !isAddressEqual(
      Secp256k1.recoverAddress({
        payload: Transaction.getSignPayload(envelope),
        signature: normalized,
      }),
      address,
    )
  )
    throw new Transaction.InvalidEnvelopeError(
      'The signature does not match the account address.',
    )
  const order = Secp256k1.noble.CURVE.n
  if (normalized.s > order / 2n) {
    normalized.s = order - normalized.s
    normalized.yParity ^= 1
  }
  return Transaction.serialize({
    ...envelope,
    features: envelope.features.map(([key, value]) => [
      key,
      key === '0x06'
        ? [
            integer(BigInt(normalized.yParity)),
            integer(normalized.r),
            integer(normalized.s),
          ]
        : value,
    ]),
  })
}

function integer(value: bigint): Hex.Hex {
  if (value === 0n) return '0x'
  const hex = Hex.fromNumber(value)
  return Hex.padLeft(hex, Hex.size(hex))
}
