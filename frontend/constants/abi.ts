export const REFLEX_ABI = [
  // ── Events ──────────────────────────────────────────────────────────────
  {
    type: 'event',
    name: 'MatchCreated',
    inputs: [
      { name: 'matchId', type: 'uint256', indexed: true },
      { name: 'host', type: 'address', indexed: true },
      { name: 'stakePerPlayer', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'MatchJoined',
    inputs: [
      { name: 'matchId', type: 'uint256', indexed: true },
      { name: 'player', type: 'address', indexed: true },
      { name: 'playerCount', type: 'uint32', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'MatchLocked',
    inputs: [
      { name: 'matchId', type: 'uint256', indexed: true },
      { name: 'playerCount', type: 'uint32', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'MatchStarted',
    inputs: [
      { name: 'matchId', type: 'uint256', indexed: true },
      { name: 'startedAt', type: 'uint256', indexed: false },
      { name: 'goTimestampMs', type: 'uint256', indexed: false },
      { name: 'countdownMs', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'TapSubmitted',
    inputs: [
      { name: 'matchId', type: 'uint256', indexed: true },
      { name: 'player', type: 'address', indexed: true },
      { name: 'reactionMs', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'MatchFinished',
    inputs: [
      { name: 'matchId', type: 'uint256', indexed: true },
      { name: 'topPlayers', type: 'address[3]', indexed: false },
      { name: 'topReactionMs', type: 'uint256[3]', indexed: false },
      { name: 'prizes', type: 'uint256[3]', indexed: false },
      { name: 'winnersCount', type: 'uint8', indexed: false },
      { name: 'fee', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'MatchForceSettled',
    inputs: [
      { name: 'matchId', type: 'uint256', indexed: true },
    ],
  },
  // ── Write Functions ──────────────────────────────────────────────────────
  {
    type: 'function',
    name: 'createMatch',
    stateMutability: 'payable',
    inputs: [{ name: 'tapDelegate', type: 'address' }],
    outputs: [{ name: 'matchId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'joinMatch',
    stateMutability: 'payable',
    inputs: [
      { name: 'matchId', type: 'uint256' },
      { name: 'tapDelegate', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'submitTapFor',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'matchId', type: 'uint256' },
      { name: 'player', type: 'address' },
      { name: 'clientTimestampMs', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'GAS_DELEGATE_AMOUNT',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'lockMatch',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'matchId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'startMatch',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'matchId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'submitTap',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'matchId', type: 'uint256' },
      { name: 'clientTimestampMs', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'endMatch',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'matchId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'forceSettle',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'matchId', type: 'uint256' }],
    outputs: [],
  },
  // ── Read Functions ───────────────────────────────────────────────────────
  {
    type: 'function',
    name: 'getMatch',
    stateMutability: 'view',
    inputs: [{ name: 'matchId', type: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'host', type: 'address' },
          { name: 'state', type: 'uint8' },
          { name: 'playerCount', type: 'uint32' },
          { name: 'tappedCount', type: 'uint32' },
          { name: 'stakePerPlayer', type: 'uint256' },
          { name: 'startedAt', type: 'uint256' },
          { name: 'goTimestampMs', type: 'uint256' },
          { name: 'topPlayers', type: 'address[3]' },
          { name: 'topReactionMs', type: 'uint256[3]' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'isPlayer',
    stateMutability: 'view',
    inputs: [
      { name: 'matchId', type: 'uint256' },
      { name: 'player', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'hasTapped',
    stateMutability: 'view',
    inputs: [
      { name: 'matchId', type: 'uint256' },
      { name: 'player', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'matchCounter',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'accumulatedFees',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;
