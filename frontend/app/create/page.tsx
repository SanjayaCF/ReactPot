'use client';

export const dynamic = 'force-dynamic';

import { useState } from 'react';
import { useAccount, useConnect, useWriteContract } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { parseEventLogs, parseEther } from 'viem';
import { getOrCreateBurner } from '@/lib/burnerWallet';
import { waitForTransactionReceipt } from 'wagmi/actions';
import { REFLEX_ABI } from '@/constants/abi';
import { Header } from '@/components/Header';
import { ArrowLeft, Coins, Zap } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { wagmiConfig } from '@/lib/wagmiConfig';
import clsx from 'clsx';

const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS as `0x${string}`;

const STAKE_OPTIONS = [
  { label: '0.001', display: '0.001 MON' },
  { label: '0.01', display: '0.01 MON' },
  { label: '0.1', display: '0.1 MON' },
];

function Spinner() {
  return (
    <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

export default function CreatePage() {
  const { isConnected } = useAccount();
  const { connect } = useConnect();
  const router = useRouter();
  const { writeContractAsync } = useWriteContract();

  const [stakeOption, setStakeOption] = useState('0.01');
  const [isPending, setIsPending] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  async function handleCreate() {
    if (!isConnected) {
      connect({ connector: injected() });
      return;
    }

    setIsPending(true);
    setErrorMsg('');

    try {
      // Generate burner wallet — matchId not known yet, use temp key 'pending'
      // We'll move it after we get matchId from the event
      const tempKey = `reflex_burner_pending_${Date.now()}`;
      let burnerAddress: `0x${string}` = '0x0000000000000000000000000000000000000000';
      let burnerKey: `0x${string}` | null = null;
      try {
        const { generatePrivateKey, privateKeyToAccount } = await import('viem/accounts');
        burnerKey = generatePrivateKey();
        burnerAddress = privateKeyToAccount(burnerKey).address;
        sessionStorage.setItem(tempKey, JSON.stringify({ address: burnerAddress, privateKey: burnerKey }));
      } catch { /* fallback: no delegate */ }

      const GAS_DELEGATE = parseEther('0.002');
      const stakeValue = parseEther(stakeOption);
      const totalValue = burnerAddress !== '0x0000000000000000000000000000000000000000'
        ? stakeValue + GAS_DELEGATE
        : stakeValue;

      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: REFLEX_ABI,
        functionName: 'createMatch',
        args: [burnerAddress],
        value: totalValue,
      });

      const receipt = await waitForTransactionReceipt(wagmiConfig, { hash });

      const logs = parseEventLogs({
        abi: REFLEX_ABI,
        eventName: 'MatchCreated',
        logs: receipt.logs,
      });

      const matchId = logs[0]?.args?.matchId;
      if (matchId !== undefined) {
        // Move burner key to matchId-specific key
        if (burnerKey && tempKey) {
          sessionStorage.setItem(`reflex_burner_${matchId}`, JSON.stringify({ address: burnerAddress, privateKey: burnerKey }));
          sessionStorage.removeItem(tempKey);
        }
        router.push(`/match/${matchId}`);
      } else {
        throw new Error('Could not parse match ID from transaction');
      }
    } catch (err: unknown) {
      const e = err as { shortMessage?: string; message?: string };
      setErrorMsg(e.shortMessage ?? e.message ?? 'Transaction failed');
      setIsPending(false);
    }
  }

  return (
    <div className="flex min-h-[100dvh] flex-col bg-bg">
      <Header />

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-6">
        <Link
          href="/"
          className="flex w-fit items-center gap-1.5 text-sm text-text-muted transition-colors hover:text-text-secondary"
        >
          <ArrowLeft size={16} />
          Back
        </Link>

        <h1 className="text-2xl font-black text-text-primary">New Match</h1>

        {/* Stake */}
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-text-muted">
            <Coins size={13} />
            Stake per player
          </label>
          <div className="grid grid-cols-3 gap-2">
            {STAKE_OPTIONS.map((opt) => (
              <button
                key={opt.label}
                onClick={() => setStakeOption(opt.label)}
                className={clsx(
                  'rounded-xl border py-3.5 text-sm font-bold transition-all active:scale-95',
                  stakeOption === opt.label
                    ? 'border-primary bg-primary/20 text-primary shadow-sm shadow-primary/20'
                    : 'border-white/[0.08] bg-surface text-text-secondary hover:border-white/[0.16] hover:text-text-primary'
                )}
              >
                {opt.display}
              </button>
            ))}
          </div>
        </div>

        {/* Auto-scale info */}
        <div className="rounded-2xl border border-primary/25 bg-primary/10 p-5 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary/60">
            Auto-scale prizes
          </p>
          <div className="space-y-2 text-sm">
            {[
              ['1–4 tappers', '1 winner → 100%'],
              ['5–10 tappers', '2 winners → 65% / 35%'],
              ['11+ tappers', '3 winners → 60% / 30% / 10%'],
            ].map(([players, prize]) => (
              <div key={players} className="flex justify-between">
                <span className="text-text-muted">{players}</span>
                <span className="font-semibold text-text-primary">{prize}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-white/[0.06] pt-3 flex justify-between text-xs text-text-muted">
            <span>Platform fee</span>
            <span>2% of pot</span>
          </div>
        </div>

        {/* Unlimited players note */}
        <div className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-surface px-4 py-3">
          <Zap size={14} className="text-primary" />
          <span className="text-sm text-text-muted">
            No player cap — invite as many friends as you want.
          </span>
        </div>

        {/* Error */}
        {errorMsg && (
          <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {errorMsg}
          </p>
        )}

        {/* Create */}
        <button
          onClick={handleCreate}
          disabled={isPending}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-4 text-lg font-bold text-white shadow-lg shadow-primary/20 transition-all hover:bg-primary-dim disabled:opacity-60 active:scale-[0.98]"
        >
          {isPending ? (
            <>
              <Spinner />
              Creating match…
            </>
          ) : (
            `Create Match · ${stakeOption} MON`
          )}
        </button>

        <p className="text-center text-xs text-text-muted">
          You stake {stakeOption} MON · Others pay the same to join · Instant payout on Monad
        </p>
      </main>
    </div>
  );
}
