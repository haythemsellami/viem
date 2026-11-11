import type { Address } from 'abitype'
import * as Hex from 'ox/Hex'
import type { Account } from '../accounts/types.js'
import type { Block as EthereumBlock } from '../types/block.js'
import type {
  RpcAuthorizationList,
  RpcBlock,
  RpcTransaction,
  RpcTransactionReceipt,
} from '../types/rpc.js'
import type {
  AccessList,
  TransactionRequest as EthereumRequest,
  Transaction as EthereumTransaction,
  TransactionEIP1559,
  TransactionReceipt,
  TransactionRequestEIP1559,
} from '../types/transaction.js'
import type { ExactPartial } from '../types/utils.js'
import { formatBlock as formatEthereumBlock } from '../utils/formatters/block.js'
import { formatTransaction as formatEthereumTransaction } from '../utils/formatters/transaction.js'
import { formatTransactionReceipt as formatEthereumReceipt } from '../utils/formatters/transactionReceipt.js'
import { formatTransactionRequest as formatEthereumRequest } from '../utils/formatters/transactionRequest.js'
import * as internal from './internal/transaction.js'
import * as Transaction from './Transaction.js'

/** An existing authorization tuple with full-width chain identifiers and nonces. */
export type Authorization = {
  /** Delegation target. */
  address: Address
  /** Authorization chain identifier, including zero for any chain. */
  chainId: bigint
  /** Authority nonce, encoded as uint64. */
  nonce: bigint
  /** ECDSA r component as hex. */
  r: Hex.Hex
  /** ECDSA s component as hex. */
  s: Hex.Hex
  /** Signature recovery parity. */
  yParity: 0 | 1
}

/** Baseline sender-paid Monad request. Use `to: null` for contract creation. */
export type TransactionRequestMonad = TransactionRequestEIP1559<
  bigint,
  bigint,
  'monad'
> & {
  /** Existing authorization tuples; omission and an empty list are distinct. */
  authorizationList?: readonly Authorization[] | undefined
  /** Configured EVM chain identifier. Must be a safe integer. */
  chainId?: number | undefined
  /** Explicit selection of the universal transaction type. */
  type: 'monad'
}

/** Requests supported by the opt-in Monad chain configuration. */
export type TransactionRequest = EthereumRequest | TransactionRequestMonad

/** Baseline RPC request using standard transaction fields and quantity hex. */
export type TransactionRequestRpc = TransactionRequestEIP1559<
  Hex.Hex,
  Hex.Hex,
  '0x40'
> & {
  /** Existing authorization tuples, with RPC quantity encoding. */
  authorizationList?: RpcAuthorizationList | undefined
  /** Chain identifier as an RPC quantity. */
  chainId?: Hex.Hex | undefined
}

/** Formatted baseline transaction. Optional list presence is preserved. */
export type TransactionMonad = Omit<
  TransactionEIP1559,
  'accessList' | 'authorizationList' | 'nonce' | 'type'
> & {
  /** Access list, absent if its feature was omitted. */
  accessList?: AccessList | undefined
  /** Authorization list, absent if its feature was omitted. */
  authorizationList?: readonly Authorization[] | undefined
  /** Sender nonce without integer precision loss. */
  nonce: bigint
  /** Optional canonical bytes returned by the node, without auxiliary data. */
  raw?: Transaction.Serialized | undefined
  /** Universal transaction type. */
  type: 'monad'
}

/** Baseline RPC transaction. Nodes must preserve omitted versus present list features. */
export type TransactionRpc = Omit<
  TransactionEIP1559<Hex.Hex, Hex.Hex, boolean, '0x40'>,
  'accessList' | 'authorizationList' | 'typeHex'
> & {
  /** Access list, absent if its feature was omitted. */
  accessList?: AccessList | undefined
  /** Existing authorization tuples in RPC form. */
  authorizationList?: RpcAuthorizationList | undefined
  /** Optional canonical transaction bytes, never submission bytes. */
  raw?: Transaction.Serialized | undefined
}

/** A block containing Ethereum or Monad transactions. */
export type Block = EthereumBlock<
  bigint,
  boolean,
  'latest',
  EthereumTransaction | TransactionMonad
>

/** Formats full-block transactions through the same formatter as individual reads. */
export function formatBlock(
  block: ExactPartial<Omit<RpcBlock, 'transactions'>> & {
    transactions?:
      | readonly (
          | Hex.Hex
          | ExactPartial<RpcTransaction>
          | ExactPartial<TransactionRpc>
        )[]
      | undefined
  },
): Block {
  return {
    ...formatEthereumBlock({ ...block, transactions: [] }),
    transactions: (block.transactions ?? []).map((transaction) =>
      typeof transaction === 'string'
        ? transaction
        : formatTransaction(transaction),
    ),
  } as Block
}

/** Formats standard RPC fields while preserving uint64 nonces and optional lists. */
export function formatTransaction(
  transaction: ExactPartial<RpcTransaction> | ExactPartial<TransactionRpc>,
): EthereumTransaction | TransactionMonad {
  if (transaction.type !== '0x40')
    return formatEthereumTransaction(
      transaction as ExactPartial<RpcTransaction>,
    )
  const { authorizationList, nonce, raw, ...rest } = transaction
  // The base formatter must never see full-width nonces or authorization quantities.
  const formatted = formatEthereumTransaction({
    ...rest,
    type: '0x2',
    nonce: undefined,
    authorizationList: undefined,
  })
  if (raw !== undefined) Transaction.deserialize(raw)
  return {
    ...formatted,
    ...(raw !== undefined ? { raw } : {}),
    authorizationList:
      authorizationList == null
        ? undefined
        : authorizationList.map((authorization) => ({
            address: authorization.address,
            chainId: internal.quantity(
              authorization.chainId,
              256,
              'authorization.chainId',
            ),
            nonce: internal.quantity(
              authorization.nonce,
              64,
              'authorization.nonce',
            ),
            r: authorization.r,
            s: authorization.s,
            yParity: Number(
              internal.quantity(
                authorization.yParity,
                1,
                'authorization.yParity',
              ),
            ) as 0 | 1,
          })),
    nonce: nonce == null ? undefined : internal.quantity(nonce, 64, 'nonce'),
    type: 'monad',
    typeHex: '0x40',
  } as TransactionMonad
}

/** Formats a JSON receipt, including the universal transaction discriminant. */
export function formatTransactionReceipt(
  receipt: ExactPartial<RpcTransactionReceipt>,
): TransactionReceipt {
  const formatted = formatEthereumReceipt(receipt)
  return receipt.type === '0x40' ? { ...formatted, type: 'monad' } : formatted
}

/** Formats baseline requests for standard RPC methods; local signing is required. */
export function formatTransactionRequest(
  request: TransactionRequest,
  action?: string | undefined,
) {
  if (request.type !== 'monad') return formatEthereumRequest(request)
  internal.assertRequest(request)
  if (action === 'sendTransaction' || action === 'signTransaction')
    throw new Transaction.InvalidEnvelopeError(
      'Monad transactions require a local ECDSA account.',
    )
  type WithAccount = TransactionRequestMonad & { account?: Account | undefined }
  const { account, authorizationList, chainId } = request as WithAccount
  const result = {
    ...formatEthereumRequest({
      ...request,
      authorizationList: undefined,
      type: 'eip1559',
    } as EthereumRequest),
    type: '0x40',
  } as TransactionRequestRpc
  if (account) result.from = account.address
  if (chainId !== undefined)
    result.chainId = Hex.fromNumber(internal.quantity(chainId, 256, 'chainId'))
  if (authorizationList !== undefined)
    result.authorizationList = authorizationList.map((authorization) => ({
      address: authorization.address,
      chainId: Hex.fromNumber(
        internal.quantity(authorization.chainId, 256, 'authorization.chainId'),
      ),
      nonce: Hex.fromNumber(
        internal.quantity(authorization.nonce, 64, 'authorization.nonce'),
      ),
      r: Hex.fromNumber(
        internal.quantity(BigInt(authorization.r), 256, 'authorization.r'),
      ),
      s: Hex.fromNumber(
        internal.quantity(BigInt(authorization.s), 256, 'authorization.s'),
      ),
      yParity: Hex.fromNumber(
        internal.quantity(authorization.yParity, 1, 'authorization.yParity'),
      ),
    }))
  return result
}
