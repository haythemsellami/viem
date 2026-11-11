import { parseAccount } from '../accounts/utils/parseAccount.js'
import type { ChainConfig } from '../types/chain.js'
import { defineBlock } from '../utils/formatters/block.js'
import { defineTransaction } from '../utils/formatters/transaction.js'
import { defineTransactionReceipt } from '../utils/formatters/transactionReceipt.js'
import type { SerializeTransactionFn } from '../utils/transaction/serializeTransaction.js'
import * as Formatters from './Formatters.js'
import * as internal from './internal/transaction.js'
import * as Submission from './Submission.js'
import * as Transaction from './Transaction.js'

/**
 * Opt-in baseline type 0x40 RPC integration. Signing returns canonical bytes;
 * `sendTransaction` adds the empty auxiliary-data submission wrapper.
 *
 * @example
 * import { defineChain } from 'viem'
 * import { monad } from 'viem/chains'
 * import { chainConfig } from 'viem/monad'
 * const chain = defineChain({ ...monad, ...chainConfig })
 */
export const chainConfig = {
  formatters: {
    block: {
      ...defineBlock({ format: Formatters.formatBlock }),
      format: Formatters.formatBlock,
    },
    transaction: {
      ...defineTransaction({ format: Formatters.formatTransaction }),
      format: Formatters.formatTransaction,
    },
    transactionReceipt: defineTransactionReceipt({
      format: Formatters.formatTransactionReceipt,
    }),
    transactionRequest: {
      type: 'transactionRequest',
      format: Formatters.formatTransactionRequest,
    },
  },
  prepareTransactionRequest: [
    async (request, { client, phase }) => {
      if ((request.type as string) !== 'monad') return
      const r = request as unknown as Formatters.TransactionRequestMonad & {
        account?: typeof request.account
        nonceManager?: typeof request.nonceManager
        parameters?: typeof request.parameters
      }
      internal.assertRequest(r)
      if (phase !== 'beforeFillTransaction') return
      if (
        request.chainId !== undefined &&
        request.chain &&
        request.chainId !== request.chain.id
      )
        throw new Transaction.InvalidEnvelopeError(
          'chainId does not match the configured chain.',
        )
      if (
        r.parameters?.includes('nonce') &&
        r.nonce === undefined &&
        r.account
      ) {
        if (r.nonceManager)
          throw new Transaction.InvalidEnvelopeError(
            'Supply an explicit bigint nonce instead of a number-based nonce manager.',
          )
        const account = parseAccount(r.account)
        r.nonce = internal.quantity(
          await client.request({
            method: 'eth_getTransactionCount',
            params: [account.address, 'pending'],
          }),
          64,
          'nonce',
        )
      }
      return {
        ...request,
        ...r,
        chainId: request.chainId ?? request.chain?.id,
      } as unknown as typeof request
    },
    { runAt: ['beforeFillTransaction', 'afterFillParameters'] },
  ],
  serializers: {
    transaction: internal.serializeTransaction as SerializeTransactionFn,
    transactionEnvelope: ({ serializedTransaction, transaction }) =>
      (transaction.type as string) === 'monad'
        ? Submission.serialize(Transaction.deserialize(serializedTransaction))
        : serializedTransaction,
  },
} as const satisfies ChainConfig
