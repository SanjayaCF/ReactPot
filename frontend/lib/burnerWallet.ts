'use client';

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, http, encodeFunctionData } from 'viem';
import { monadTestnet } from '@/constants/chain';
import { REFLEX_ABI } from '@/constants/abi';

const RPC = process.env.NEXT_PUBLIC_RPC_URL || 'https://testnet-rpc.monad.xyz';
const CONTRACT = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS as `0x${string}`;

const storageKey = (matchId: bigint) => `reflex_burner_${matchId}`;

export function getOrCreateBurner(matchId: bigint): { address: `0x${string}`; privateKey: `0x${string}` } {
  const key = storageKey(matchId);
  const existing = sessionStorage.getItem(key);
  if (existing) {
    const parsed = JSON.parse(existing);
    return parsed;
  }
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const data = { address: account.address, privateKey };
  sessionStorage.setItem(key, JSON.stringify(data));
  return data;
}

export function getBurner(matchId: bigint): { address: `0x${string}`; privateKey: `0x${string}` } | null {
  try {
    const existing = sessionStorage.getItem(storageKey(matchId));
    return existing ? JSON.parse(existing) : null;
  } catch {
    return null;
  }
}

export async function submitTapWithBurner(
  matchId: bigint,
  player: `0x${string}`,
  clientTimestampMs: bigint,
): Promise<`0x${string}` | null> {
  const burner = getBurner(matchId);
  if (!burner) return null;

  const account = privateKeyToAccount(burner.privateKey);
  const client = createWalletClient({
    account,
    chain: monadTestnet,
    transport: http(RPC),
  });

  const data = encodeFunctionData({
    abi: REFLEX_ABI,
    functionName: 'submitTapFor',
    args: [matchId, player, clientTimestampMs],
  });

  const hash = await client.sendTransaction({
    to: CONTRACT,
    data,
    gas: 200_000n,
  });

  return hash;
}
