import { createPublicClient, createWalletClient, defineChain, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  estimateGas,
  getTransaction,
  waitForTransactionReceipt,
} from 'viem/actions'
import { monad } from 'viem/chains'
import {
  chainConfig,
  type Formatters,
  Submission,
  Transaction,
} from 'viem/monad'
import { expectTypeOf, test } from 'vitest'

const chain = defineChain({ ...monad, ...chainConfig })
const account = privateKeyToAccount(`0x${'1'.repeat(64)}`)
const wallet = createWalletClient({ account, chain, transport: http() })
const client = createPublicClient({ chain, transport: http() })

test('prepared baseline requests compose with signing and sending', async () => {
  const prepared = await wallet.prepareTransactionRequest({
    type: 'monad',
    to: account.address,
  })
  expectTypeOf(prepared.type).toEqualTypeOf<'monad'>()
  expectTypeOf(prepared.nonce).toEqualTypeOf<bigint>()
  expectTypeOf(prepared.gas).toEqualTypeOf<bigint>()
  const canonical = await wallet.signTransaction(prepared)
  const submitted = Submission.serialize(Transaction.deserialize(canonical))
  await wallet.sendRawTransaction({ serializedTransaction: submitted })
  await wallet.sendTransaction({
    type: 'monad',
    to: account.address,
    nonce: 0n,
  })
  await wallet.sendTransactionSync(prepared)
  await wallet.sendTransaction({
    type: 'eip1559',
    to: account.address,
    nonce: 0,
  })
  // @ts-expect-error Baseline requests require bigint nonces.
  await wallet.sendTransaction({ type: 'monad', nonce: 0 })
  const batch = {
    type: 'monad',
    calls: [{ to: account.address, value: 1n }],
  } satisfies Formatters.TransactionRequestMonad
  const preparedBatch = await wallet.prepareTransactionRequest(batch)
  expectTypeOf(preparedBatch.calls![0]!.value).toEqualTypeOf<
    bigint | undefined
  >()
  await wallet.signTransaction(preparedBatch)
  await wallet.sendTransaction(batch)
  await wallet.sendTransactionSync(batch)
  await client.call(batch)
  await client.estimateGas(batch)
  // @ts-expect-error Scalar call fields cannot accompany a batch.
  const mixed: Formatters.TransactionRequestMonad = {
    type: 'monad',
    calls: [],
    to: account.address,
  }
  expectTypeOf(mixed).not.toBeAny()
})

test('read and simulation actions retain the custom type and full-width values', async () => {
  await client.estimateGas({
    type: 'monad',
    nonce: 2n ** 63n,
    account: account.address,
  })
  await client.call({ type: 'monad', to: account.address, nonce: 1n })
  const transaction = await client.getTransaction({ hash: '0x' })
  if (transaction.type === 'monad') {
    expectTypeOf(transaction.nonce).toEqualTypeOf<bigint>()
    expectTypeOf(transaction.authorizationList).toEqualTypeOf<
      readonly Formatters.Authorization[] | undefined
    >()
  }
  const block = await client.getBlock({ includeTransactions: true })
  for (const transaction of block.transactions)
    if (transaction.type === 'monad')
      expectTypeOf(transaction.nonce).toEqualTypeOf<bigint>()
  expectTypeOf(
    await client.waitForTransactionReceipt({ hash: '0x' }),
  ).not.toBeAny()
})

test('chain overrides retain custom request types through estimation and sending', async () => {
  const wallet = createWalletClient({
    account,
    chain: monad,
    transport: http(),
  })
  const client = createPublicClient({ chain: monad, transport: http() })
  const request = { type: 'monad', nonce: 2n ** 63n, chain } as const
  expectTypeOf(await estimateGas(client, request)).toEqualTypeOf<bigint>()
  expectTypeOf(await client.estimateGas(request)).toEqualTypeOf<bigint>()
  const prepared = await wallet.prepareTransactionRequest(request)
  expectTypeOf(prepared.nonce).toEqualTypeOf<bigint>()
  await wallet.sendTransaction(prepared)
  await wallet.sendTransactionSync(prepared)
  // @ts-expect-error The override still requires bigint Monad nonces.
  await client.estimateGas({ chain, type: 'monad', nonce: 0 })
})

test('sender/nonce lookup and dropped-transaction recovery accept bigint nonces', async () => {
  const transaction = await getTransaction(client, {
    sender: account.address,
    nonce: 2n ** 64n - 1n,
  })
  if (transaction.type === 'monad')
    expectTypeOf(transaction.nonce).toEqualTypeOf<bigint>()
  await client.getTransaction({ sender: account.address, nonce: 7 })
  const parameters = {
    hash: '0x',
    replacement: { from: account.address, nonce: 2n ** 64n - 1n },
  } as const
  expectTypeOf(await client.waitForTransactionReceipt(parameters)).not.toBeAny()
  expectTypeOf(
    await waitForTransactionReceipt(client, parameters),
  ).not.toBeAny()
  await client.waitForTransactionReceipt({
    ...parameters,
    onReplaced({ replacedTransaction, transaction }) {
      expectTypeOf(replacedTransaction.nonce).toEqualTypeOf<number | bigint>()
      if (transaction.type === 'monad')
        expectTypeOf(transaction.nonce).toEqualTypeOf<bigint>()
      else expectTypeOf(transaction.nonce).toEqualTypeOf<number>()
    },
  })
  const ethereum = createPublicClient({ chain: monad, transport: http() })
  await ethereum.waitForTransactionReceipt({
    hash: '0x',
    onReplaced({ replacedTransaction, transaction }) {
      expectTypeOf(replacedTransaction.nonce).toEqualTypeOf<number>()
      expectTypeOf(transaction.nonce).toEqualTypeOf<number>()
    },
  })
})

test('native batch simulation preserves request types and per-entry outcomes', async () => {
  const request = {
    type: 'monad',
    calls: [{ to: account.address, data: '0x1234' }],
  } as const
  const result = await client.simulateBlocks({
    blocks: [{ calls: [request] }],
    validation: true,
  })
  expectTypeOf(result[0]!.calls[0].calls![0]!.status).toEqualTypeOf<
    'success' | 'failure' | null
  >()
  await client.createAccessList(request)
  const filled = await client.fillTransaction(request)
  const canonical = Transaction.deserialize(filled.raw)
  await Transaction.sign({ account, transaction: canonical })
  const transaction = await client.getTransaction({ hash: '0x' })
  if (transaction.type === 'monad' && transaction.calls) {
    Transaction.from({
      chainId: 143,
      nonce: 1n,
      gas: 21000n,
      maxFeePerGas: 1n,
      maxPriorityFeePerGas: 0n,
      // @ts-expect-error Executed calls are not complete signing requests.
      calls: transaction.calls,
    })
  }
})
