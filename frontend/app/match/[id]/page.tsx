'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAccount, useConnect, useWriteContract, useSwitchChain } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { waitForTransactionReceipt } from 'wagmi/actions';
import { monadTestnet } from '@/constants/chain';
import { formatEther } from 'viem';
import clsx from 'clsx';
import { ArrowLeft, Users, Play, Zap, Clock, AlertCircle, StopCircle, TimerReset } from 'lucide-react';
import Link from 'next/link';

import { useMatch, useIsPlayer, isValidMatch } from '@/hooks/useMatch';
import { useMatchEvents } from '@/hooks/useMatchEvents';
import { getOrCreateBurner, getBurner, submitTapWithBurner } from '@/lib/burnerWallet';
import { REFLEX_ABI } from '@/constants/abi';
import { wagmiConfig } from '@/lib/wagmiConfig';
import { MatchState, type TapResult, type FinishedData } from '@/types';
import { Header } from '@/components/Header';
import { PlayerList } from '@/components/PlayerList';
import { Leaderboard } from '@/components/Leaderboard';
import { QRShare } from '@/components/QRShare';
import { TapButton } from '@/components/TapButton';

const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS as `0x${string}`;
const FORCE_SETTLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

type HostFlow = 'idle' | 'locking' | 'starting';

function Spinner({ className }: { className?: string }) {
  return (
    <svg className={clsx('animate-spin', className)} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function MatchPage() {
  const params = useParams();
  const router = useRouter();
  const { address, isConnected, chainId } = useAccount();
  const { connect } = useConnect();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  async function ensureMonadChain() {
    if (chainId !== monadTestnet.id) {
      await switchChainAsync({ chainId: monadTestnet.id });
    }
  }

  const matchId = BigInt(params.id as string);
  const { match, refetch } = useMatch(matchId);
  const isPlayer = useIsPlayer(matchId);

  // ── Real-time state from events ──────────────────────────────────────────
  const [goTimestampMs, setGoTimestampMs] = useState<bigint | null>(null);
  const [tapResults, setTapResults] = useState<TapResult[]>([]);
  const [finishedData, setFinishedData] = useState<FinishedData | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const rafRef = useRef<number>();

  // ── Tap state ────────────────────────────────────────────────────────────
  const hasTappedRef = useRef(false);
  const [hasTapped, setHasTapped] = useState(false);
  const [myReactionMs, setMyReactionMs] = useState<number | null>(null);

  // ── Pre-GO countdown (3…2…1…GO!) ────────────────────────────────────────
  const [countdownSec, setCountdownSec] = useState<number | null>(null);
  const [goFired, setGoFired] = useState(false);

  // ── Host flow ────────────────────────────────────────────────────────────
  const [hostFlow, setHostFlow] = useState<HostFlow>('idle');
  const [txError, setTxError] = useState('');

  // ── Force settle countdown ───────────────────────────────────────────────
  const [forceSettleReady, setForceSettleReady] = useState(false);

  // Derived
  const effectiveState: MatchState = (() => {
    if (finishedData) return MatchState.Finished;
    if (goTimestampMs !== null) return MatchState.Active;
    return match?.state ?? MatchState.Open;
  })();

  const isHost = address && match ? address.toLowerCase() === match.host.toLowerCase() : false;
  const displayedGoMs = goTimestampMs ?? match?.goTimestampMs ?? 0n;

  // ── Events ───────────────────────────────────────────────────────────────
  useMatchEvents({
    matchId,
    onMatchStarted: (ts) => setGoTimestampMs(ts),
    onTapSubmitted: (result) => {
      setTapResults((prev) => {
        if (prev.find((r) => r.player.toLowerCase() === result.player.toLowerCase())) return prev;
        return [...prev, result];
      });
    },
    onMatchFinished: (data) => {
      setFinishedData(data);
      refetch();
    },
    onMatchJoined: refetch,
    onMatchLocked: refetch,
  });

  // ── Pre-GO countdown + elapsed timer ─────────────────────────────────────
  useEffect(() => {
    if (effectiveState !== MatchState.Active) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }
    const goMs = Number(displayedGoMs);
    function tick() {
      const now = Date.now();
      const remaining = goMs - now;
      if (remaining > 0) {
        setCountdownSec(Math.ceil(remaining / 1000));
        setGoFired(false);
      } else {
        setCountdownSec(null);
        setGoFired(true);
        if (!hasTapped) setElapsedMs(now - goMs);
      }
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [effectiveState, hasTapped, displayedGoMs]);

  // ── Restore state on refresh ─────────────────────────────────────────────
  useEffect(() => {
    if (!match) return;
    if (match.state === MatchState.Active && match.goTimestampMs > 0n && goTimestampMs === null) {
      setGoTimestampMs(match.goTimestampMs);
    }
    // Derive finishedData from contract when page loaded after match ended
    if (match.state === MatchState.Finished && finishedData === null) {
      const pot = match.stakePerPlayer * BigInt(match.playerCount);
      const fee = (pot * 200n) / 10000n;
      const net = pot - fee;
      const t = match.tappedCount;
      let prizes: readonly [bigint, bigint, bigint];
      let winnersCount: number;
      if (t === 0) {
        prizes = [0n, 0n, 0n]; winnersCount = 0;
      } else if (t <= 4) {
        prizes = [net, 0n, 0n]; winnersCount = 1;
      } else if (t <= 10) {
        prizes = [(net * 65n) / 100n, (net * 35n) / 100n, 0n]; winnersCount = 2;
      } else {
        prizes = [(net * 60n) / 100n, (net * 30n) / 100n, (net * 10n) / 100n]; winnersCount = 3;
      }
      setFinishedData({ topPlayers: match.topPlayers, topReactionMs: match.topReactionMs, prizes, winnersCount, fee });
    }
  }, [match]);

  // ── Force settle eligibility timer ───────────────────────────────────────
  useEffect(() => {
    if (!match || match.state !== MatchState.Active || match.startedAt === 0n) return;
    const readyAt = Number(match.startedAt) * 1000 + FORCE_SETTLE_TIMEOUT_MS;
    const remaining = readyAt - Date.now();
    if (remaining <= 0) { setForceSettleReady(true); return; }
    const t = setTimeout(() => setForceSettleReady(true), remaining);
    return () => clearTimeout(t);
  }, [match?.state, match?.startedAt]);

  // ── Actions ──────────────────────────────────────────────────────────────
  async function handleJoin() {
    if (!isConnected) { connect({ connector: injected() }); return; }
    if (!match) return;
    setTxError('');
    try {
      await ensureMonadChain();
      const burner = getOrCreateBurner(matchId);
      const GAS_DELEGATE = 2_000_000_000_000_000n; // 0.002 MON
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: REFLEX_ABI,
        functionName: 'joinMatch',
        args: [matchId, burner.address],
        value: match.stakePerPlayer + GAS_DELEGATE,
      });
      await waitForTransactionReceipt(wagmiConfig, { hash });
      refetch();
    } catch (err: unknown) {
      const e = err as { shortMessage?: string; message?: string };
      setTxError(e.shortMessage ?? e.message ?? 'Transaction failed');
    }
  }

  async function handleStartGame() {
    if (!match) return;
    setTxError('');
    try {
      await ensureMonadChain();
      if (match.state === MatchState.Open) {
        setHostFlow('locking');
        const lockHash = await writeContractAsync({
          address: CONTRACT_ADDRESS,
          abi: REFLEX_ABI,
          functionName: 'lockMatch',
          args: [matchId],
        });
        await waitForTransactionReceipt(wagmiConfig, { hash: lockHash });
        refetch();
      }

      setHostFlow('starting');
      const startHash = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: REFLEX_ABI,
        functionName: 'startMatch',
        args: [matchId],
      });
      await waitForTransactionReceipt(wagmiConfig, { hash: startHash });
      setHostFlow('idle');
      refetch();
    } catch (err: unknown) {
      const e = err as { shortMessage?: string; message?: string };
      setTxError(e.shortMessage ?? e.message ?? 'Transaction failed');
      setHostFlow('idle');
    }
  }

  async function handleEndMatch() {
    setTxError('');
    try {
      await ensureMonadChain();
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: REFLEX_ABI,
        functionName: 'endMatch',
        args: [matchId],
      });
      await waitForTransactionReceipt(wagmiConfig, { hash });
      refetch();
    } catch (err: unknown) {
      const e = err as { shortMessage?: string; message?: string };
      setTxError(e.shortMessage ?? e.message ?? 'Transaction failed');
    }
  }

  async function handleForceSettle() {
    setTxError('');
    try {
      await ensureMonadChain();
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: REFLEX_ABI,
        functionName: 'forceSettle',
        args: [matchId],
      });
      await waitForTransactionReceipt(wagmiConfig, { hash });
      refetch();
    } catch (err: unknown) {
      const e = err as { shortMessage?: string; message?: string };
      setTxError(e.shortMessage ?? e.message ?? 'Transaction failed');
    }
  }

  const handleTap = useCallback(async () => {
    if (hasTappedRef.current || effectiveState !== MatchState.Active || !goFired) return;
    hasTappedRef.current = true;

    const clientTimestampMs = BigInt(Date.now());
    const reactionMs = Number(clientTimestampMs - displayedGoMs);
    setHasTapped(true);
    setMyReactionMs(reactionMs);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (navigator.vibrate) navigator.vibrate(60);

    setTxError('');
    try {
      const burner = getBurner(matchId);
      if (burner && address) {
        // Instant tap — no MetaMask popup
        await submitTapWithBurner(matchId, address, clientTimestampMs);
      } else {
        // Fallback to MetaMask
        await ensureMonadChain();
        await writeContractAsync({
          address: CONTRACT_ADDRESS,
          abi: REFLEX_ABI,
          functionName: 'submitTap',
          args: [matchId, clientTimestampMs],
        });
      }
    } catch (err: unknown) {
      const e = err as { shortMessage?: string; message?: string };
      setTxError(e.shortMessage ?? e.message ?? 'Tap failed');
    }
  }, [effectiveState, goFired, displayedGoMs, matchId, address, writeContractAsync]);

  // ── Loading ──────────────────────────────────────────────────────────────
  if (!match) {
    return (
      <div className="flex min-h-[100dvh] flex-col bg-bg">
        <Header />
        <div className="flex flex-1 items-center justify-center">
          <Spinner className="h-8 w-8 text-primary" />
        </div>
      </div>
    );
  }

  if (!isValidMatch(match)) {
    return (
      <div className="flex min-h-[100dvh] flex-col bg-bg">
        <Header />
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center">
          <AlertCircle size={40} className="text-text-muted" />
          <p className="text-lg font-bold text-text-primary">Match not found</p>
          <Link href="/" className="text-sm text-primary hover:underline">Back to lobby</Link>
        </div>
      </div>
    );
  }

  // ── Active — fullscreen ───────────────────────────────────────────────────
  if (effectiveState === MatchState.Active) {
    const bgColor = countdownSec !== null ? '#1a1a2e' : '#00e676';
    return (
      <div className="fixed inset-0 flex flex-col transition-colors duration-300" style={{ backgroundColor: bgColor, touchAction: 'none' }}>
        <div className="flex items-center justify-between px-5 pt-safe pt-4 pb-2">
          <span className="font-mono text-sm font-bold" style={{ color: countdownSec !== null ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.5)' }}>
            Match #{matchId.toString()}
          </span>
          {!hasTapped && goFired && (
            <div className="flex items-center gap-1.5 font-mono text-sm font-black text-black">
              <Clock size={14} />
              <span>{elapsedMs.toLocaleString()}ms</span>
            </div>
          )}
        </div>

        {/* Countdown overlay */}
        {countdownSec !== null && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4">
            <p className="text-sm font-semibold uppercase tracking-widest text-white/40">Get ready…</p>
            <span className="text-[10rem] font-black leading-none text-white tabular-nums">
              {countdownSec}
            </span>
          </div>
        )}

        {/* GO! — tap zone */}
        {countdownSec === null && (
          <TapButton
            onTap={handleTap}
            tapped={hasTapped}
            reactionMs={myReactionMs ?? undefined}
            disabled={hasTapped}
          />
        )}

        {/* Host controls during active */}
        {isHost && goFired && (
          <div className="px-5 pb-safe pb-6 flex gap-3">
            <button
              onClick={handleEndMatch}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-black/20 py-3 text-sm font-bold text-black/70 active:scale-95"
            >
              <StopCircle size={15} />
              End match
            </button>
          </div>
        )}

        {forceSettleReady && !isHost && (
          <div className="px-5 pb-safe pb-6">
            <button
              onClick={handleForceSettle}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-black/20 py-3 text-sm font-bold text-black/70 active:scale-95"
            >
              <TimerReset size={15} />
              Force settle (5 min passed)
            </button>
          </div>
        )}

        {txError && (
          <p className="px-6 pb-6 text-center text-sm text-black/70">{txError}</p>
        )}
      </div>
    );
  }

  // ── Finished ──────────────────────────────────────────────────────────────
  if (effectiveState === MatchState.Finished && finishedData) {
    return (
      <div className="flex min-h-[100dvh] flex-col bg-bg">
        <Header />
        <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 py-6">
          <h1 className="text-xl font-black text-text-primary">Results</h1>

          <Leaderboard
            finished={finishedData}
            tapResults={tapResults}
            currentUser={address}
          />

          <div className="mt-2 flex gap-3">
            <button
              onClick={() => router.push('/create')}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary py-3.5 text-sm font-bold text-white transition-all hover:bg-primary-dim active:scale-95"
            >
              <Play size={15} />
              New match
            </button>
            <Link
              href="/"
              className="flex flex-1 items-center justify-center rounded-xl border border-white/[0.08] bg-surface py-3.5 text-sm font-medium text-text-secondary"
            >
              Lobby
            </Link>
          </div>
        </main>
      </div>
    );
  }

  // ── Lobby (Open / Locked) ─────────────────────────────────────────────────
  const pot = match.stakePerPlayer * BigInt(match.playerCount);
  const canJoin = isConnected && !isPlayer && match.state === MatchState.Open;
  const hostCanStart =
    isHost &&
    (match.state === MatchState.Open || match.state === MatchState.Locked) &&
    match.playerCount >= 2 &&
    hostFlow === 'idle';

  const statusLabel: Record<MatchState, string> = {
    [MatchState.Open]: 'Open',
    [MatchState.Locked]: 'Locked',
    [MatchState.Active]: 'Live',
    [MatchState.Finished]: 'Finished',
  };
  const statusColor: Record<MatchState, string> = {
    [MatchState.Open]: 'bg-emerald-500/20 text-emerald-400',
    [MatchState.Locked]: 'bg-yellow-500/20 text-yellow-400',
    [MatchState.Active]: 'bg-tap/20 text-tap',
    [MatchState.Finished]: 'bg-white/10 text-text-muted',
  };

  return (
    <div className="flex min-h-[100dvh] flex-col bg-bg">
      <Header />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-4 py-6">
        <Link href="/" className="flex w-fit items-center gap-1.5 text-sm text-text-muted hover:text-text-secondary">
          <ArrowLeft size={16} />
          Lobby
        </Link>

        {/* Match header */}
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-text-muted">
              Match #{matchId.toString()}
            </p>
            <div className="mt-1 flex items-center gap-3">
              <span className={clsx('rounded-full px-2.5 py-0.5 text-xs font-bold', statusColor[effectiveState])}>
                {statusLabel[effectiveState]}
              </span>
              <span className="flex items-center gap-1 text-sm font-medium text-text-secondary">
                <Users size={13} />
                {match.playerCount} joined
              </span>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-text-muted">Pot</p>
            <p className="text-xl font-black text-text-primary">
              {formatEther(pot)}
              <span className="ml-1 text-sm font-semibold text-text-secondary">MON</span>
            </p>
          </div>
        </div>

        {/* Stake info */}
        <div className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-surface px-4 py-3">
          <Zap size={14} className="text-primary" />
          <span className="text-sm text-text-secondary">
            Stake:{' '}
            <span className="font-semibold text-text-primary">
              {formatEther(match.stakePerPlayer)} MON
            </span>{' '}
            per player · Auto-scale winners
          </span>
        </div>

        {/* GET READY banner */}
        {effectiveState === MatchState.Locked && (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-yellow-500/20 bg-yellow-500/10 py-6">
            <div className="animate-breathe">
              <p className="text-2xl font-black text-yellow-400">GET READY</p>
            </div>
            {isHost && hostFlow === 'starting' && (
              <p className="flex items-center gap-2 text-sm text-yellow-400/70">
                <Spinner className="h-4 w-4" />
                Starting…
              </p>
            )}
            {!isHost && (
              <p className="text-sm text-yellow-400/70">Waiting for host to start</p>
            )}
          </div>
        )}

        {/* QR share */}
        {match.state === MatchState.Open && <QRShare matchId={matchId.toString()} />}

        {/* Players */}
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-text-muted">
            Players ({match.playerCount})
          </p>
          <PlayerList
            playerCount={match.playerCount}
            host={match.host}
            currentUser={address}
            tappedCount={match.tappedCount}
          />
        </div>

        {/* Error */}
        {txError && (
          <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {txError}
          </p>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-3 pb-6">
          {!isConnected && match.state === MatchState.Open && (
            <button
              onClick={() => connect({ connector: injected() })}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-4 text-base font-bold text-white transition-all hover:bg-primary-dim active:scale-[0.98]"
            >
              Connect to join
            </button>
          )}

          {canJoin && (
            <button
              onClick={handleJoin}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-4 text-base font-bold text-white shadow-lg shadow-primary/20 transition-all hover:bg-primary-dim active:scale-[0.98]"
            >
              Join · {formatEther(match.stakePerPlayer)} MON
            </button>
          )}

          {hostCanStart && (
            <button
              onClick={handleStartGame}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-tap py-4 text-base font-bold text-black transition-all hover:bg-tap-dim active:scale-[0.98]"
            >
              <Play size={18} strokeWidth={2.5} />
              {match.playerCount < 2 ? `Need ${2 - match.playerCount} more player` : 'Start Game'}
            </button>
          )}

          {isHost && hostFlow !== 'idle' && (
            <div className="flex items-center justify-center gap-2 rounded-2xl border border-white/[0.08] bg-surface py-4 text-sm text-text-secondary">
              <Spinner className="h-4 w-4" />
              {hostFlow === 'locking' ? 'Locking match…' : 'Starting game…'}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
