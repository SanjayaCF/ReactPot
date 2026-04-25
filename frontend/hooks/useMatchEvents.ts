'use client';

// Event watching disabled — all state derived from getMatch polling
// to avoid RPC rate limits (429). useMatch polls every 4s which is sufficient.

export function useMatchEvents(_params: {
  matchId: bigint;
  onMatchStarted?: (goTimestampMs: bigint) => void;
  onTapSubmitted?: (result: { player: `0x${string}`; reactionMs: bigint }) => void;
  onMatchFinished?: (data: any) => void;
  onMatchJoined?: () => void;
  onMatchLocked?: () => void;
}) {
  // no-op: state is derived from useMatch polling in the match page
}
