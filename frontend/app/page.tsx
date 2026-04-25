'use client';

export const dynamic = 'force-dynamic';

import { useAccount, useConnect } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { Header } from '@/components/Header';
import { useMatchCounter } from '@/hooks/useMatch';
import { Plus, ArrowRight, Zap } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function HomePage() {
  const { isConnected } = useAccount();
  const { connect } = useConnect();
  const counter = useMatchCounter();
  const router = useRouter();
  const [joinId, setJoinId] = useState('');

  function handleJoin() {
    const id = joinId.trim();
    if (id) router.push(`/match/${id}`);
  }

  return (
    <div className="flex min-h-[100dvh] flex-col bg-bg">
      <Header />

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-10">
        {/* Hero */}
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-primary/20">
            <Zap size={36} className="text-primary" strokeWidth={2.5} />
          </div>
          <h1 className="text-5xl font-black tracking-tight text-text-primary">Reflex</h1>
          <p className="max-w-xs text-base leading-relaxed text-text-secondary">
            Fastest tap wins the pot.
            <br />
            Real money. Monad speed.
          </p>
        </div>

        {/* Matches played */}
        {counter !== undefined && counter > 0n && (
          <div className="flex items-center justify-center gap-2 rounded-2xl border border-white/[0.06] bg-surface py-3">
            <span className="text-2xl font-black text-text-primary">{counter.toString()}</span>
            <span className="text-sm text-text-muted">matches played</span>
          </div>
        )}

        {/* Primary CTA */}
        {isConnected ? (
          <Link
            href="/create"
            className="flex items-center justify-center gap-3 rounded-2xl bg-primary px-6 py-4 text-lg font-bold text-white shadow-lg shadow-primary/20 transition-all hover:bg-primary-dim active:scale-[0.98]"
          >
            <Plus size={22} strokeWidth={2.5} />
            Create Match
          </Link>
        ) : (
          <button
            onClick={() => connect({ connector: injected() })}
            className="flex items-center justify-center gap-3 rounded-2xl bg-primary px-6 py-4 text-lg font-bold text-white shadow-lg shadow-primary/20 transition-all hover:bg-primary-dim active:scale-[0.98]"
          >
            Connect Wallet to Play
          </button>
        )}

        {/* Join by ID */}
        <div className="space-y-3">
          <p className="text-center text-xs font-semibold uppercase tracking-widest text-text-muted">
            or join with a match ID
          </p>
          <div className="flex gap-2">
            <input
              type="number"
              inputMode="numeric"
              placeholder="Match ID"
              value={joinId}
              onChange={(e) => setJoinId(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
              className="flex-1 rounded-xl border border-white/[0.08] bg-surface px-4 py-3 text-sm text-text-primary placeholder-text-muted outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
            />
            <button
              onClick={handleJoin}
              disabled={!joinId.trim()}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-raised text-text-secondary transition-colors hover:text-text-primary disabled:opacity-30 active:scale-95"
            >
              <ArrowRight size={20} />
            </button>
          </div>
        </div>

        {/* How it works */}
        <div className="rounded-2xl border border-white/[0.06] bg-surface p-5">
          <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-text-muted">
            How it works
          </p>
          <div className="space-y-4">
            {[
              ['Stake MON', 'Host creates a match and sets the buy-in amount'],
              ['3s Countdown', 'On-chain countdown — GO signal from blockchain'],
              ['Tap fastest', 'Tap immediately after GO — fastest wins the pot'],
              ['Instant payout', 'MON paid out on-chain in under 1 second on Monad'],
            ].map(([title, desc]) => (
              <div key={title} className="flex gap-3">
                <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary/60" />
                <div>
                  <p className="text-sm font-semibold text-text-primary">{title}</p>
                  <p className="text-xs leading-relaxed text-text-muted">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
