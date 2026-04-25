'use client';

import { useReadContract } from 'wagmi';
import { useAccount } from 'wagmi';
import { REFLEX_ABI } from '@/constants/abi';
import { MatchState, type MatchData } from '@/types';

const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS as `0x${string}`;
const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

export function useMatch(matchId: bigint | undefined) {
  const { data: raw, refetch } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: REFLEX_ABI,
    functionName: 'getMatch',
    args: matchId !== undefined ? [matchId] : undefined,
    query: {
      enabled: matchId !== undefined,
      refetchInterval: 3000,
    },
  });

  const match: MatchData | undefined = raw
    ? {
        host: raw.host,
        state: raw.state as MatchState,
        playerCount: raw.playerCount,
        tappedCount: raw.tappedCount,
        stakePerPlayer: raw.stakePerPlayer,
        startedAt: raw.startedAt,
        goTimestampMs: raw.goTimestampMs,
        topPlayers: raw.topPlayers as readonly [`0x${string}`, `0x${string}`, `0x${string}`],
        topReactionMs: raw.topReactionMs as readonly [bigint, bigint, bigint],
      }
    : undefined;

  return { match, refetch };
}

export function useIsPlayer(matchId: bigint | undefined) {
  const { address } = useAccount();
  const { data } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: REFLEX_ABI,
    functionName: 'isPlayer',
    args: matchId !== undefined && address ? [matchId, address] : undefined,
    query: {
      enabled: matchId !== undefined && !!address,
      refetchInterval: 2000,
    },
  });
  return data as boolean | undefined;
}

export function useHasTapped(matchId: bigint | undefined) {
  const { address } = useAccount();
  const { data } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: REFLEX_ABI,
    functionName: 'hasTapped',
    args: matchId !== undefined && address ? [matchId, address] : undefined,
    query: {
      enabled: matchId !== undefined && !!address,
      refetchInterval: 1000,
    },
  });
  return data as boolean | undefined;
}

export function useMatchCounter() {
  const { data } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: REFLEX_ABI,
    functionName: 'matchCounter',
    query: { refetchInterval: 3000 },
  });
  return data as bigint | undefined;
}

export function isValidMatch(match: MatchData | undefined): match is MatchData {
  return !!match && match.host !== ZERO_ADDR;
}

export function getWinners(match: MatchData): Array<{ player: `0x${string}`; reactionMs: bigint }> {
  return match.topPlayers
    .map((player, i) => ({ player, reactionMs: match.topReactionMs[i] }))
    .filter((w) => w.player !== ZERO_ADDR);
}
