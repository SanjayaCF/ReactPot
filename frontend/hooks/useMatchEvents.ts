'use client';

import { useWatchContractEvent } from 'wagmi';
import { REFLEX_ABI } from '@/constants/abi';
import type { FinishedData, TapResult } from '@/types';

const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS as `0x${string}`;

interface UseMatchEventsParams {
  matchId: bigint;
  onMatchStarted?: (goTimestampMs: bigint) => void;
  onTapSubmitted?: (result: TapResult) => void;
  onMatchFinished?: (data: FinishedData) => void;
  onMatchJoined?: () => void;
  onMatchLocked?: () => void;
}

export function useMatchEvents({
  matchId,
  onMatchStarted,
  onTapSubmitted,
  onMatchFinished,
  onMatchJoined,
  onMatchLocked,
}: UseMatchEventsParams) {
  useWatchContractEvent({
    address: CONTRACT_ADDRESS,
    abi: REFLEX_ABI,
    eventName: 'MatchStarted',
    args: { matchId },
    pollingInterval: 2000,
    onLogs(logs) {
      for (const log of logs) {
        const args = log.args as { goTimestampMs: bigint };
        onMatchStarted?.(args.goTimestampMs);
      }
    },
  });

  useWatchContractEvent({
    address: CONTRACT_ADDRESS,
    abi: REFLEX_ABI,
    eventName: 'TapSubmitted',
    args: { matchId },
    pollingInterval: 2000,
    onLogs(logs) {
      for (const log of logs) {
        const args = log.args as { player: `0x${string}`; reactionMs: bigint };
        onTapSubmitted?.({ player: args.player, reactionMs: args.reactionMs });
      }
    },
  });

  useWatchContractEvent({
    address: CONTRACT_ADDRESS,
    abi: REFLEX_ABI,
    eventName: 'MatchFinished',
    args: { matchId },
    pollingInterval: 2000,
    onLogs(logs) {
      for (const log of logs) {
        const args = log.args as {
          topPlayers: readonly [`0x${string}`, `0x${string}`, `0x${string}`];
          topReactionMs: readonly [bigint, bigint, bigint];
          prizes: readonly [bigint, bigint, bigint];
          winnersCount: number;
          fee: bigint;
        };
        onMatchFinished?.({
          topPlayers: args.topPlayers,
          topReactionMs: args.topReactionMs,
          prizes: args.prizes,
          winnersCount: args.winnersCount,
          fee: args.fee,
        });
      }
    },
  });

  useWatchContractEvent({
    address: CONTRACT_ADDRESS,
    abi: REFLEX_ABI,
    eventName: 'MatchJoined',
    args: { matchId },
    pollingInterval: 2000,
    onLogs() {
      onMatchJoined?.();
    },
  });

  useWatchContractEvent({
    address: CONTRACT_ADDRESS,
    abi: REFLEX_ABI,
    eventName: 'MatchLocked',
    args: { matchId },
    pollingInterval: 2000,
    onLogs() {
      onMatchLocked?.();
    },
  });
}
