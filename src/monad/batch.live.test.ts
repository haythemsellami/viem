import { createPublicClient, createWalletClient, defineChain, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { monad } from 'viem/chains'
import { chainConfig, Submission, Transaction } from 'viem/monad'
import { expect, test } from 'vitest'

// Run against the paired node build with a funded test account.
test.runIf(Boolean(process.env.MONAD_BATCH_RPC_URL))(
  'native batch actions against the running node',
  async () => {
    const account = privateKeyToAccount(`0x${'0'.repeat(63)}1`)
    const transport = http(process.env.MONAD_BATCH_RPC_URL)
    const chain = defineChain({ ...monad, ...chainConfig, id: 20143 })
    const client = createPublicClient({ chain, transport })
    const wallet = createWalletClient({ account, chain, transport })
    const target = '0x000000000000000000000000000000000000ba7c'
    const nonce = BigInt(
      await client.getTransactionCount({ address: account.address }),
    )
    const request = {
      type: 'monad',
      account,
      calls: [
        { to: target, value: 1n },
        { to: target, value: 2n },
      ],
    } as const
    const gas = await client.estimateGas(request)
    expect(gas).toBeGreaterThanOrEqual(42_000n)
    expect(gas).toBeLessThanOrEqual(43_000n)
    expect(await client.call(request)).toMatchObject({ data: undefined })
    expect(await client.createAccessList(request)).toHaveProperty('accessList')
    const simulation = await client.simulateBlocks({
      blocks: [
        {
          calls: [
            {
              ...request,
              maxFeePerGas: 200_000_000_000n,
              maxPriorityFeePerGas: 0n,
            },
          ],
        },
      ],
    })
    expect(simulation[0]!.calls[0].calls).toEqual([
      { data: '0x', status: 'success' },
      { data: '0x', status: 'success' },
    ])
    const filled = await client.fillTransaction(request)
    const signed = await Transaction.sign({
      account,
      transaction: Transaction.deserialize(filled.raw),
    })
    const envelope = Transaction.deserialize(signed)
    const before = await client.getBalance({ address: target })
    const hash = await wallet.sendRawTransaction({
      serializedTransaction: Submission.serialize(envelope),
    })
    expect(hash).toBe(Transaction.hash(envelope))
    const receipt = await client.waitForTransactionReceipt({ hash })
    expect(receipt).toMatchObject({
      type: 'monad',
      status: 'success',
      to: null,
      gasUsed: filled.transaction.gas,
    })
    const transaction = await client.getTransaction({ hash })
    expect(transaction).toMatchObject({
      type: 'monad',
      nonce,
      to: null,
      value: 0n,
      input: '0x',
      calls: [{ value: 1n }, { value: 2n }],
    })
    const block = await client.getBlock({
      blockHash: receipt.blockHash,
      includeTransactions: true,
    })
    expect(block.transactions.find((tx) => tx.hash === hash)).toMatchObject({
      calls: [{ value: 1n }, { value: 2n }],
    })
    const second = await wallet.sendTransactionSync({
      ...request,
      gas,
      nonce: nonce + 1n,
    })
    expect(second).toMatchObject({
      type: 'monad',
      status: 'success',
      gasUsed: gas,
    })
    const thirdHash = await wallet.sendTransaction({
      ...request,
      gas,
      nonce: nonce + 2n,
    })
    expect(
      await client.waitForTransactionReceipt({ hash: thirdHash }),
    ).toMatchObject({ type: 'monad', status: 'success', gasUsed: gas })
    // Latest state can lag the optimistic receipt.
    await expect
      .poll(() => client.getBalance({ address: target }), { timeout: 30_000 })
      .toBe(before + 9n)
  },
)
