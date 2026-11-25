import type * as Hex from 'ox/Hex'
import type { ChainTransactionReplacement } from '../../types/chain.js'
import type { Transaction as EthereumTransaction } from '../../types/transaction.js'
import * as Transaction from '../Transaction.js'

type GetReason = NonNullable<ChainTransactionReplacement['getReason']>
type Candidate = Parameters<GetReason>[0]['replaced'] & {
  type?: string | undefined
}

/** Compare signed intent, never the attempted prefix in a native RPC response. */
export const getReason: GetReason = async (
  { replaced, replacement },
  { client },
) => {
  const native = (tx: Candidate) =>
    tx.type === 'monad' || tx.raw?.startsWith('0x40')
  if (!native(replaced) && !native(replacement)) return undefined

  const canonical = async (tx: Candidate) => {
    try {
      const raw =
        tx.raw ??
        (await client.request<{
          Parameters: [Hex.Hex]
          ReturnType: Hex.Hex | null
        }>(
          { method: 'debug_getRawTransaction', params: [tx.hash] },
          { retryCount: 0 },
        ))
      if (!raw?.startsWith('0x40')) return undefined
      const envelope = Transaction.deserialize(raw)
      if (Transaction.hash(envelope).toLowerCase() !== tx.hash.toLowerCase())
        return undefined
      return envelope
    } catch {
      // Missing debug support or a dropped transaction leaves the intent unknown.
      return undefined
    }
  }
  const [before, after] = await Promise.all([
    canonical(replaced),
    canonical(replacement),
  ])
  return classify(replacement, before, after)
}

export function classify(
  replacement: Candidate,
  before: Transaction.Envelope | undefined,
  after: Transaction.Envelope | undefined,
): 'repriced' | 'replaced' | 'cancelled' {
  const intent = (tx: Transaction.Envelope) =>
    Transaction.serialize({
      ...tx,
      features: tx.features.filter(
        ([key]) => !['0x02', '0x06', '0x07'].includes(key),
      ),
    })
  if (before && after && intent(before) === intent(after)) return 'repriced'
  if (after) {
    const features = new Map(after.features)
    const calls = features.has('0x08')
      ? features.get('0x08')
      : [features.get('0x03')]
    if (Array.isArray(calls) && calls.length === 1 && Array.isArray(calls[0])) {
      const call = new Map(calls[0] as readonly Transaction.Feature[])
      if (
        [...features.keys()].every((key) =>
          ['0x01', '0x02', '0x03', '0x04', '0x06', '0x07', '0x08'].includes(
            key,
          ),
        ) &&
        typeof call.get('0x01') === 'string' &&
        (call.get('0x01') as string).toLowerCase() ===
          replacement.from.toLowerCase() &&
        call.get('0x02') === '0x' &&
        call.get('0x03') === '0x' &&
        !features.has('0x05')
      )
        return 'cancelled'
    }
  } else if ((replacement as Candidate).type !== 'monad') {
    const tx = replacement as EthereumTransaction
    if (
      tx.to?.toLowerCase() === tx.from.toLowerCase() &&
      tx.value === 0n &&
      tx.input === '0x'
    )
      return 'cancelled'
  }
  return 'replaced'
}
