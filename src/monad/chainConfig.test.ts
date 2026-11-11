import { EventEmitter, once } from 'node:events'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  decodeRlp,
  Transaction as EthersTransaction,
  encodeRlp,
  keccak256,
  recoverAddress,
  toQuantity,
  zeroPadValue,
} from 'ethers'
import * as Secp256k1 from 'ox/Secp256k1'
import * as Signature from 'ox/Signature'
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  type Hex,
  http,
  nonceManager,
  parseTransaction,
  type RpcTransaction,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { monad } from 'viem/chains'
import {
  chainConfig,
  type Formatters,
  Submission,
  Transaction,
} from 'viem/monad'
import { expect, onTestFinished, test } from 'vitest'

const account = privateKeyToAccount(`0x${'1'.repeat(64)}`)
const destination = '0x0000000000000000000000000000000000000002'
const chain = defineChain({ ...monad, ...chainConfig })
const blockHash = `0x${'a'.repeat(64)}` as Hex
const fields = {
  type: 'monad',
  chainId: 143,
  nonce: 7n,
  gas: 24_576n,
  to: destination,
  maxFeePerGas: 20n,
  maxPriorityFeePerGas: 2n,
} as const

// An HTTP protocol fixture with independent RLP and signature verification.
// It exercises transport and client behavior, without implementing EVM execution or consensus.
async function setup(
  options: {
    fill?: boolean
    nonce?: bigint
    chainId?: number
    senderLookup?: boolean
    sync?: 'receipt' | 'timeout' | 'timeoutWithHash'
  } = {},
) {
  const transactions = new Map<
    Hex,
    Formatters.TransactionRpc | RpcTransaction
  >()
  const submissions = new Map<Hex, Hex>()
  const events = new EventEmitter()
  const outcomes = new Map<Hex, '0x0' | '0x1'>()
  const block = {
    hash: blockHash,
    number: '0x1',
    baseFeePerGas: '0xa',
    gasLimit: '0x100000',
    gasUsed: '0x6000',
    timestamp: '0x1',
    difficulty: '0x0',
    totalDifficulty: '0x0',
    size: '0x1',
    nonce: '0x0000000000000000',
    extraData: '0x',
    miner: account.address,
    parentHash: blockHash,
    sha3Uncles: blockHash,
    stateRoot: blockHash,
    transactionsRoot: blockHash,
    receiptsRoot: blockHash,
    logsBloom: `0x${'0'.repeat(512)}`,
    uncles: [],
  }
  const receipt = (
    transaction: Formatters.TransactionRpc | RpcTransaction,
  ) => ({
    type: transaction.type,
    status: outcomes.get(transaction.hash) ?? '0x1',
    transactionHash: transaction.hash,
    transactionIndex: '0x0',
    blockHash: transaction.blockHash,
    blockNumber: transaction.blockNumber,
    from: transaction.from,
    to: transaction.to,
    contractAddress: transaction.to ? null : destination,
    cumulativeGasUsed: '0x6000',
    gasUsed: '0x6000',
    effectiveGasPrice: '0xc',
    logs: [],
    logsBloom: block.logsBloom,
  })
  const validate = (request: Formatters.TransactionRequestRpc) => {
    if (request.type !== '0x40') throw new Error('Expected explicit type 0x40.')
    for (const key of Object.keys(request))
      if (
        ![
          'type',
          'chainId',
          'from',
          'to',
          'data',
          'nonce',
          'gas',
          'value',
          'maxFeePerGas',
          'maxPriorityFeePerGas',
          'accessList',
          'authorizationList',
        ].includes(key)
      )
        throw new Error(`Unexpected request field ${key}.`)
    if (request.data === '0xdead') throw new Error('execution reverted')
  }
  async function dispatch(
    method: string,
    params: readonly unknown[],
  ): Promise<unknown> {
    if (method === 'eth_chainId') return toQuantity(options.chainId ?? 143)
    if (method === 'eth_getTransactionCount')
      return toQuantity(options.nonce ?? 2n ** 53n + 1n)
    if (method === 'eth_blockNumber') return block.number
    if (method === 'eth_maxPriorityFeePerGas') return '0x2'
    if (method === 'eth_fillTransaction') {
      if (!options.fill) return undefined
      const request = params[0] as Formatters.TransactionRequestRpc
      validate(request)
      return {
        raw: '0x',
        tx: {
          ...request,
          chainId: '0x8f',
          nonce: request.nonce ?? '0x0',
          gas: '0x6000',
          maxFeePerGas: '0x14',
          maxPriorityFeePerGas: '0x2',
          input: request.data ?? '0x',
          value: request.value ?? '0x0',
        },
      }
    }
    if (method === 'eth_estimateGas' || method === 'eth_call') {
      validate(params[0] as Formatters.TransactionRequestRpc)
      return method === 'eth_call' ? '0x1234' : '0x6000'
    }
    if (method === 'eth_sendRawTransactionSync') {
      const hash = (await dispatch('eth_sendRawTransaction', params)) as Hex
      if (options.sync === 'timeout' || options.sync === 'timeoutWithHash')
        throw Object.assign(new Error('Transaction confirmation timeout'), {
          code: 4,
          data: options.sync === 'timeoutWithHash' ? hash : undefined,
        })
      return receipt(transactions.get(hash)!)
    }
    if (method === 'eth_sendRawTransaction') {
      const submitted = params[0] as Hex
      if (submitted.startsWith('0x02')) {
        const transaction = EthersTransaction.from(submitted)
        const hash = transaction.hash as Hex
        const quantity = (value: bigint | number) => toQuantity(value) as Hex
        transactions.set(hash, {
          type: '0x2',
          chainId: quantity(transaction.chainId),
          hash,
          from: transaction.from!,
          to: transaction.to,
          input: transaction.data,
          value: quantity(transaction.value),
          nonce: quantity(transaction.nonce),
          gas: quantity(transaction.gasLimit),
          maxFeePerGas: quantity(transaction.maxFeePerGas!),
          maxPriorityFeePerGas: quantity(transaction.maxPriorityFeePerGas!),
          accessList: transaction.accessList,
          r: transaction.signature!.r,
          s: transaction.signature!.s,
          yParity: quantity(transaction.signature!.yParity),
          v: quantity(transaction.signature!.yParity),
          blockHash,
          blockNumber: '0x1',
          transactionIndex: '0x0',
        } as RpcTransaction)
        submissions.set(hash, submitted)
        return hash
      }
      if (!submitted.startsWith('0x40'))
        throw new Error('Expected transaction type 0x40.')
      const decoded = decodeRlp(`0x${submitted.slice(4)}`)
      if (
        typeof decoded === 'string' ||
        decoded.length !== 3 ||
        !Array.isArray(decoded[2]) ||
        decoded[2].length !== 0
      )
        throw new Error('Expected three fields and empty auxiliary data.')
      const canonical = `0x40${encodeRlp(decoded.slice(0, 2)).slice(2)}` as Hex
      const features = decoded[1] as [string, string | string[]][]
      const feature = (key: string) => features.find(([k]) => k === key)![1]
      const call = feature('0x03') as unknown as [string, string][]
      const callField = (key: string) => call.find(([k]) => k === key)![1]
      const quantity = (value: string) =>
        toQuantity(value === '0x' ? 0n : BigInt(value)) as Hex
      const signature = feature('0x06') as string[]
      const payload = `0x40${encodeRlp([decoded[0], features.map(([key, value]) => [key, key === '0x06' ? [] : value])]).slice(2)}`
      const hash = keccak256(canonical) as Hex
      const from = recoverAddress(keccak256(payload), {
        r: zeroPadValue(signature[1]!, 32),
        s: zeroPadValue(signature[2]!, 32),
        yParity: Number(signature[0] === '0x' ? 0 : signature[0]) as 0 | 1,
      }) as Hex
      const fees = feature('0x07') as string[]
      const access = features.find(([key]) => key === '0x04')
      const authorization = features.find(([key]) => key === '0x05')
      const transaction = {
        type: '0x40',
        chainId: quantity(decoded[0] as string),
        hash,
        raw: canonical,
        from,
        to: callField('0x01') === '0x' ? null : callField('0x01'),
        input: callField('0x03'),
        value: quantity(callField('0x02')),
        nonce: quantity(feature('0x01') as string),
        gas: quantity(feature('0x02') as string),
        maxPriorityFeePerGas: quantity(fees[0]!),
        maxFeePerGas: quantity(fees[1]!),
        r: zeroPadValue(signature[1]!, 32),
        s: zeroPadValue(signature[2]!, 32),
        yParity: quantity(signature[0]!),
        v: quantity(signature[0]!),
        blockHash,
        blockNumber: '0x1',
        transactionIndex: '0x0',
        ...(access
          ? {
              accessList: (access[1] as unknown as [Hex, Hex[]][]).map(
                ([address, storageKeys]) => ({ address, storageKeys }),
              ),
            }
          : {}),
        ...(authorization
          ? {
              authorizationList: (
                authorization[1] as unknown as string[][]
              ).map(([chainId, address, nonce, yParity, r, s]) => ({
                chainId: quantity(chainId!),
                address,
                nonce: quantity(nonce!),
                yParity: quantity(yParity!),
                r: quantity(r!),
                s: quantity(s!),
              })),
            }
          : {}),
      } as Formatters.TransactionRpc
      transactions.set(hash, transaction)
      submissions.set(hash, submitted)
      return hash
    }
    if (method === 'eth_getTransactionByHash')
      return transactions.get(params[0] as Hex) ?? null
    if (method === 'eth_getTransactionBySenderAndNonce') {
      if (options.senderLookup === false) return undefined
      return (
        [...transactions.values()].find(
          (transaction) =>
            transaction.from.toLowerCase() ===
              String(params[0]).toLowerCase() &&
            BigInt(transaction.nonce) === BigInt(params[1] as Hex),
        ) ?? null
      )
    }
    if (method === 'eth_getTransactionReceipt') {
      const transaction = transactions.get(params[0] as Hex)
      return transaction?.blockNumber ? receipt(transaction) : null
    }
    if (method === 'eth_getBlockByNumber' || method === 'eth_getBlockByHash')
      return {
        ...block,
        transactions: [...transactions.values()]
          .filter((transaction) => transaction.blockNumber !== null)
          .map((transaction) => (params[1] ? transaction : transaction.hash)),
      }
    if (
      method === 'eth_getTransactionByBlockNumberAndIndex' ||
      method === 'eth_getTransactionByBlockHashAndIndex'
    )
      return [...transactions.values()][Number(params[1])] ?? null
    return undefined
  }
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    const {
      id,
      method,
      params = [],
    } = JSON.parse(body) as { id: number; method: string; params?: unknown[] }
    try {
      const result = await dispatch(method, params)
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify(
          result === undefined
            ? {
                id,
                jsonrpc: '2.0',
                error: { code: -32601, message: 'Method not found' },
              }
            : { id, jsonrpc: '2.0', result },
        ),
      )
      events.emit(method, result)
    } catch (error) {
      const { code = -32000, data } = error as Error & {
        code?: number
        data?: Hex
      }
      response.end(
        JSON.stringify({
          id,
          jsonrpc: '2.0',
          error: { code, data, message: String(error) },
        }),
      )
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  onTestFinished(
    () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections()
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  )
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const transport = http(url, { retryCount: 0 })
  return {
    block,
    events,
    outcomes,
    submissions,
    transactions,
    wallet: createWalletClient({
      account,
      chain,
      transport,
      pollingInterval: 10,
    }),
    client: createPublicClient({
      chain,
      transport,
      pollingInterval: 10,
      cacheTime: 0,
    }),
    transport,
  }
}

test('prepares, signs, submits, reads, and waits using canonical identity', async () => {
  const { wallet, client, submissions } = await setup()
  const request = await wallet.prepareTransactionRequest({
    type: 'monad',
    to: destination,
    value: 1n,
  })
  const canonical = await wallet.signTransaction(request)
  const transaction = Transaction.deserialize(canonical)
  const submitted = Submission.serialize(transaction)
  const hash = await wallet.sendRawTransaction({
    serializedTransaction: submitted,
  })

  expect(request).toMatchObject({
    type: 'monad',
    nonce: 2n ** 53n + 1n,
    gas: 24_576n,
    chainId: 143,
  })
  expect(hash).toBe(keccak256(canonical))
  expect(hash).not.toBe(keccak256(submitted))
  expect(submissions.get(hash)).toBe(submitted)
  const result = await client.getTransaction({ hash })
  expect(result).toMatchObject({
    type: 'monad',
    typeHex: '0x40',
    nonce: request.nonce,
    raw: canonical,
    from: account.address,
  })
  expect(
    (await client.getBlock({ includeTransactions: true })).transactions,
  ).toEqual([result])
  expect((await client.getBlock()).transactions).toEqual([hash])
  expect(await client.getTransaction({ blockNumber: 1n, index: 0 })).toEqual(
    result,
  )
  expect(await client.waitForTransactionReceipt({ hash })).toMatchObject({
    transactionHash: hash,
    type: 'monad',
    status: 'success',
  })
  await expect(
    wallet.sendRawTransaction({ serializedTransaction: canonical }),
  ).rejects.toThrow('three fields')
})

test('combined send and standalone sign produce identical canonical transactions', async () => {
  const { wallet, client, submissions } = await setup()
  const canonical = await wallet.signTransaction(fields)
  const hash = await wallet.sendTransaction(fields)

  expect(submissions.get(hash)).toBe(
    Submission.serialize(Transaction.deserialize(canonical)),
  )
  expect(await client.getTransaction({ hash })).toMatchObject({
    raw: canonical,
    nonce: 7n,
  })
  expect(canonical).toBe(
    await Transaction.sign({ account, transaction: Transaction.from(fields) }),
  )
})

test.each(['receipt', 'timeout', 'timeoutWithHash'] as const)(
  'synchronous sending preserves canonical identity: %s',
  async (sync) => {
    const { wallet, client, submissions } = await setup({ sync })
    const canonical = await wallet.signTransaction(fields)

    const receipt = await wallet.sendTransactionSync({
      ...fields,
      timeout: 2_000,
    })

    expect(receipt).toEqual(
      await client.getTransactionReceipt({ hash: keccak256(canonical) as Hex }),
    )
    expect(receipt.transactionHash).toBe(keccak256(canonical))
    expect(receipt.transactionHash).not.toBe(
      keccak256(submissions.get(receipt.transactionHash)!),
    )
    expect(submissions.get(receipt.transactionHash)).toBe(
      `0x40${encodeRlp([...decodeRlp(`0x${canonical.slice(4)}`), []]).slice(2)}`,
    )
  },
)

test('ordinary Ethereum synchronous timeout recovery retains its signed hash', async () => {
  const { wallet, submissions } = await setup({ sync: 'timeout' })
  const request = { ...fields, type: 'eip1559', nonce: 7 } as const
  const canonical = await wallet.signTransaction(request)

  const receipt = await wallet.sendTransactionSync({
    ...request,
    timeout: 2_000,
  })

  expect(receipt.transactionHash).toBe(keccak256(canonical))
  expect(receipt.type).toBe('eip1559')
  expect(submissions.get(receipt.transactionHash)).toBe(canonical)
})

test.each([undefined, null])(
  'ordinary and synchronous sending preserve creation with authorizations: to=%s',
  async (to) => {
    const { wallet, client } = await setup()
    const authority = privateKeyToAccount(`0x${'2'.repeat(64)}`)
    const authorization = await authority.signAuthorization({
      chainId: 143,
      nonce: 0,
      contractAddress: destination,
    })
    const { yParity } = authorization
    if (yParity !== 0 && yParity !== 1)
      throw new Error('Invalid recovery parity.')
    const request = {
      ...fields,
      ...(to === null ? { to } : { to: undefined }),
      data: '0x60006000',
      value: 1n,
      authorizationList: [
        { ...authorization, yParity, chainId: 143n, nonce: 0n },
      ],
    } as const
    const canonical = await wallet.signTransaction(request)

    const hash = await wallet.sendTransaction(request)
    const receipt = await wallet.sendTransactionSync(request)

    expect(hash).toBe(keccak256(canonical))
    expect(receipt.transactionHash).toBe(hash)
    expect(await client.getTransaction({ hash })).toMatchObject({
      to: null,
      value: 1n,
      input: request.data,
      raw: canonical,
    })
    expect(receipt.contractAddress).toBe(destination)
  },
)

test.each([false, true])(
  'chain overrides preserve type during preparation and sending: fill=%s',
  async (fill) => {
    const { transport, wallet, client } = await setup({ fill })
    const unconfigured = createWalletClient({
      account,
      chain: monad,
      transport,
    })
    const { gas: _, ...request } = fields
    const prepared = await unconfigured.prepareTransactionRequest({
      ...request,
      chain,
    })

    expect(prepared).toEqual(await wallet.prepareTransactionRequest(request))
    const canonical = await wallet.signTransaction(prepared)
    const hash = await unconfigured.sendTransaction({ ...request, chain })
    const receipt = await unconfigured.sendTransactionSync({
      ...request,
      chain,
    })

    expect(hash).toBe(keccak256(canonical))
    expect(receipt.transactionHash).toBe(hash)
    expect(await client.getTransaction({ hash })).toMatchObject({
      type: 'monad',
      gas: 24_576n,
      raw: canonical,
    })
  },
)

test('direct gas estimation honors chain overrides and block context', async () => {
  const { transport } = await setup({ fill: true })
  const client = createPublicClient({ chain: monad, transport })

  expect(
    await client.estimateGas({
      ...fields,
      account,
      chain,
      blockNumber: 1n,
    }),
  ).toBe(24_576n)
})

test.each([
  'sendTransaction',
  'sendTransactionSync',
  'signTransaction',
] as const)(
  'JSON-RPC accounts reject Monad signing through a chain override: %s',
  async (action) => {
    const { transport } = await setup()
    const wallet = createWalletClient({
      account: account.address,
      chain: monad,
      transport,
    })

    const request = { ...fields, chain }
    await expect(
      action === 'sendTransaction'
        ? wallet.sendTransaction(request)
        : action === 'sendTransactionSync'
          ? wallet.sendTransactionSync(request)
          : wallet.signTransaction(request),
    ).rejects.toThrow('local ECDSA account')
  },
)

test('supported fill preserves caller fields and bigint nonces', async () => {
  const { wallet } = await setup({ fill: true })
  const request = await wallet.prepareTransactionRequest({
    type: 'monad',
    to: destination,
    nonce: 2n ** 64n - 1n,
    maxFeePerGas: 30n,
    accessList: [],
  })

  expect(request).toMatchObject({
    type: 'monad',
    nonce: 2n ** 64n - 1n,
    gas: 24_576n,
    maxFeePerGas: 30n,
    accessList: [],
  })
  const canonical = await wallet.signTransaction(request)
  expect(
    Transaction.deserialize(canonical).features.find(([key]) => key === '0x04'),
  ).toEqual(['0x04', []])
})

test('simulation, creation, and authorizations retain standard fields and widths', async () => {
  const { wallet, client } = await setup()
  const authorizationList = [
    {
      address: destination,
      chainId: 2n ** 256n - 1n,
      nonce: 2n ** 64n - 1n,
      r: '0x01',
      s: '0x02',
      yParity: 0,
    },
  ] as const
  const request = {
    ...fields,
    to: null,
    data: '0x6000',
    authorizationList,
    accessList: [],
  } as const
  expect(await client.estimateGas({ ...request, account })).toBe(24_576n)
  expect(await client.call({ ...request, account })).toEqual({ data: '0x1234' })
  const hash = await wallet.sendTransaction(request)
  expect(await client.getTransaction({ hash })).toMatchObject({
    to: null,
    input: '0x6000',
    authorizationList: authorizationList.map((authorization) => ({
      ...authorization,
      r: '0x1',
      s: '0x2',
    })),
    accessList: [],
  })
  expect(await client.getTransactionReceipt({ hash })).toHaveProperty(
    'contractAddress',
    destination,
  )
  await expect(
    client.estimateGas({
      type: 'monad',
      account,
      to: destination,
      data: '0xdead',
    }),
  ).rejects.toThrow('execution reverted')
})

test('explicit nonce, chain overrides, and signer scope are enforced', async () => {
  const { transport, wallet } = await setup()
  await expect(
    wallet.prepareTransactionRequest({ type: 'monad', chainId: 1 }),
  ).rejects.toThrow('chainId')
  const managed = createWalletClient({
    account: privateKeyToAccount(`0x${'1'.repeat(64)}`, { nonceManager }),
    chain,
    transport,
  })
  await expect(
    managed.sendTransaction({ type: 'monad', to: destination }),
  ).rejects.toThrow('explicit bigint nonce')
  expect(await managed.sendTransaction(fields)).toMatch(/^0x[0-9a-f]{64}$/)
  const injected = createWalletClient({
    account: account.address,
    chain,
    transport,
  })
  await expect(injected.sendTransaction(fields)).rejects.toThrow(
    'local ECDSA account',
  )
  await expect(injected.signTransaction(fields)).rejects.toThrow(
    'local ECDSA account',
  )
  const unconfigured = createWalletClient({ account, chain: monad, transport })
  expect(await unconfigured.signTransaction({ ...fields, chain })).toBe(
    await wallet.signTransaction(fields),
  )
})

test('chain mismatches and out-of-range node nonces fail before signing', async () => {
  const wrongChain = await setup({ chainId: 1 })
  await expect(wrongChain.wallet.signTransaction(fields)).rejects.toThrow()
  const invalidNonce = await setup({ nonce: 2n ** 64n })
  await expect(
    invalidNonce.wallet.prepareTransactionRequest({ type: 'monad' }),
  ).rejects.toThrow('uint64')
})

test('adapter clears sender signatures, normalizes low-s, and checks recovery', async () => {
  const serializer = chainConfig.serializers.transaction
  const envelope = Transaction.from(fields)
  const raw = await account.sign({ hash: Transaction.getSignPayload(envelope) })
  const signature = Signature.fromHex(raw)
  const high = {
    ...signature,
    s: Secp256k1.noble.CURVE.n - signature.s,
    yParity: signature.yParity ^ 1,
  }
  const toViem = (signature: typeof high) => ({
    r: `0x${signature.r.toString(16)}` as Hex,
    s: `0x${signature.s.toString(16)}` as Hex,
    yParity: signature.yParity,
  })
  const request = { ...fields, account, r: '0x1', s: '0x2', yParity: 1 }

  expect(await serializer(request as never)).toBe(
    Transaction.serialize(envelope),
  )
  expect(await serializer(request as never, toViem(high))).toBe(
    await Transaction.sign({ account, transaction: envelope }),
  )
  expect(() =>
    serializer(
      { ...request, account: { ...account, address: destination } } as never,
      toViem(signature),
    ),
  ).toThrow('account address')
  expect(() => serializer({ type: 'monad' } as never)).toThrow(
    'required for signing',
  )
})

test('ordinary Ethereum serialization and envelope behavior remain unchanged', async () => {
  const { wallet } = await setup()
  const canonical = await wallet.signTransaction({
    ...fields,
    type: 'eip1559',
    nonce: 7,
  })

  expect(
    await wallet.prepareTransactionRequest({
      ...fields,
      type: 'eip1559',
      nonce: 7,
    }),
  ).toMatchObject({ type: 'eip1559', nonce: 7 })

  expect(parseTransaction(canonical)).toMatchObject({
    type: 'eip1559',
    nonce: 7,
    chainId: 143,
  })
  expect(
    await chainConfig.serializers.transactionEnvelope({
      serializedTransaction: canonical,
      transaction: { type: 'eip1559', chainId: 143 },
    }),
  ).toBe(canonical)
})

test('receipt replacement uses full-width nonces in block scans', async () => {
  const { wallet, client, transactions } = await setup()
  const request = { ...fields, nonce: 2n ** 63n }
  const original = await wallet.sendTransaction(request)
  const replacement = await wallet.sendTransaction({ ...request, value: 1n })
  transactions.set(original, {
    ...transactions.get(original)!,
    blockHash: null,
    blockNumber: null,
    transactionIndex: null,
  })

  const pending = await client.getTransaction({
    hash: original,
  })
  expect(pending).toMatchObject({
    nonce: 2n ** 63n,
    blockNumber: null,
    transactionIndex: null,
  })
  const receipt = await client.waitForTransactionReceipt({
    hash: original,
    timeout: 2_000,
    retryCount: 0,
  })
  expect(receipt.transactionHash).toBe(replacement)
})

test.each([
  { type: 'monad', nonce: 2n ** 64n - 1n, senderLookup: true },
  { type: 'monad', nonce: 2n ** 64n - 1n, senderLookup: false },
  { type: 'monad', nonce: 0n, senderLookup: true },
  { type: 'eip1559', nonce: 7, senderLookup: true },
  { type: 'eip1559', nonce: 7, senderLookup: false },
] as const)(
  'dropped transactions retain sender/nonce recovery: $type, lookup=$senderLookup',
  async (options) => {
    const { senderLookup, ...requestFields } = options
    const { type, nonce } = requestFields
    const { wallet, client, transactions, block } = await setup({
      senderLookup,
    })
    const request = { ...fields, ...requestFields }
    const original = await wallet.sendTransaction(request)
    const replacement = await wallet.sendTransaction({
      ...request,
      value: 1n,
    })
    transactions.delete(original)
    // A nonce-slot lookup can find replacements mined before waiting starts.
    if (senderLookup) block.number = '0x3'

    const replacements: unknown[] = []
    const receipt = await client.waitForTransactionReceipt({
      hash: original,
      replacement: { from: account.address, nonce, to: destination, value: 0n },
      timeout: 2_000,
      retryCount: 0,
      onReplaced: (replacement) => replacements.push(replacement),
    })

    expect(receipt).toEqual(
      await client.getTransactionReceipt({ hash: replacement }),
    )
    expect(receipt.transactionHash).toBe(replacement)
    expect(receipt.type).toBe(type)
    expect(replacements).toMatchObject([
      {
        reason: 'replaced',
        replacedTransaction: { hash: original, nonce },
        transaction: { hash: replacement, nonce },
        transactionReceipt: receipt,
      },
    ])
    if (senderLookup)
      expect(
        (await client.getTransaction({ sender: account.address, nonce })).hash,
      ).toBe(replacement)
  },
)

test('account serializer accepts legacy signature recovery IDs and optional sender context', async () => {
  const envelope = Transaction.from(fields)
  const canonical = await Transaction.sign({ account, transaction: envelope })
  const signature = Signature.fromHex(
    await account.sign({ hash: Transaction.getSignPayload(envelope) }),
  )
  const legacy = {
    r: `0x${signature.r.toString(16)}` as Hex,
    s: `0x${signature.s.toString(16)}` as Hex,
    v: BigInt(signature.yParity + 27),
  }
  const serializer = chainConfig.serializers.transaction

  expect(await serializer(fields as never, legacy)).toBe(canonical)
  expect(
    await serializer({ ...fields, from: account.address } as never, legacy),
  ).toBe(canonical)
  expect(
    await serializer(fields as never, {
      ...legacy,
      v: BigInt(signature.yParity),
    }),
  ).toBe(canonical)
  for (const v of [0n, 1n])
    expect(await serializer(fields as never, { ...legacy, v })).toBe(
      await serializer(fields as never, { ...legacy, v: v + 27n }),
    )
  for (const v of [-1n, 2n, 29n, 2n ** 100n])
    expect(() => serializer(fields as never, { ...legacy, v })).toThrow()
})

test('confirmation waiting refreshes canonical receipts after a reorg', async () => {
  const { wallet, client, transactions, events, block, outcomes } =
    await setup()
  const hash = await wallet.sendTransaction(fields)
  const initial = once(events, 'eth_getTransactionReceipt')
  const waiting = client.waitForTransactionReceipt({
    hash,
    confirmations: 2,
    timeout: 2_000,
  })
  await initial

  const nextHash = `0x${'b'.repeat(64)}` as Hex
  transactions.set(hash, {
    ...transactions.get(hash)!,
    blockHash: nextHash,
    blockNumber: '0x2',
  })
  outcomes.set(hash, '0x0')
  block.number = '0x3'

  expect(await waiting).toMatchObject({
    transactionHash: hash,
    type: 'monad',
    blockNumber: 2n,
    blockHash: nextHash,
    status: 'reverted',
  })
})
