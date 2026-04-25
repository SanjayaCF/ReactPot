// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IReflex {
    // =========================================================================
    // Enums
    // =========================================================================

    enum MatchState {
        Open,
        Locked,
        Active,
        Finished
    }

    // =========================================================================
    // Structs
    // =========================================================================

    struct Match {
        address host;
        MatchState state;
        uint32 playerCount;
        uint32 tappedCount;
        uint256 stakePerPlayer;
        uint256 startedAt;
        uint256 goTimestampMs;
        address[3] topPlayers;
        uint256[3] topReactionMs;
    }

    // =========================================================================
    // Events
    // =========================================================================

    event MatchCreated(uint256 indexed matchId, address indexed host, uint256 stakePerPlayer);
    event MatchJoined(uint256 indexed matchId, address indexed player, uint32 currentCount);
    event MatchLocked(uint256 indexed matchId, uint32 totalPlayers);
    event MatchStarted(uint256 indexed matchId, uint256 startedAt, uint256 goTimestampMs, uint256 countdownMs);
    event TapSubmitted(uint256 indexed matchId, address indexed player, uint256 reactionMs);
    event MatchFinished(
        uint256 indexed matchId,
        address[3] topPlayers,
        uint256[3] topReactionMs,
        uint256[3] prizes,
        uint8 winnersCount,
        uint256 platformFee
    );
    event MatchForceSettled(uint256 indexed matchId);
    event FeesWithdrawn(address indexed to, uint256 amount);

    // =========================================================================
    // Errors
    // =========================================================================

    error StakeRequired();
    error MatchNotJoinable(uint256 matchId, MatchState state);
    error StakeMismatch(uint256 sent, uint256 required);
    error AlreadyJoined(uint256 matchId, address player);
    error OnlyHost(address caller, address host);
    error OnlyOwner(address caller);
    error MatchNotOpen(uint256 matchId, MatchState state);
    error NotEnoughPlayers(uint32 current, uint8 required);
    error MatchNotLocked(uint256 matchId, MatchState state);
    error MatchNotActive(uint256 matchId, MatchState state);
    error AlreadyTapped(uint256 matchId, address player);
    error NotAPlayer(uint256 matchId, address caller);
    error NotDelegate(uint256 matchId, address caller, address player);
    error TappedTooEarly(uint256 clientTs, uint256 goTs);
    error ForceSettleNotReady(uint256 currentTime, uint256 readyAt);
    error PayoutFailed(address recipient, uint256 amount);
    error InvalidMatchId(uint256 matchId);
    error NoFeesToWithdraw();
    error GasForwardFailed(address delegate);

    // =========================================================================
    // External Functions
    // =========================================================================

    /// @notice Create new match. tapDelegate = burner wallet address for 1-click tap.
    ///         If tapDelegate != address(0), msg.value must include GAS_DELEGATE_AMOUNT extra.
    function createMatch(address tapDelegate) external payable returns (uint256 matchId);

    /// @notice Join a match. tapDelegate = burner wallet for instant tap (no MetaMask popup).
    ///         If tapDelegate != address(0), msg.value = stakePerPlayer + GAS_DELEGATE_AMOUNT.
    function joinMatch(uint256 matchId, address tapDelegate) external payable;

    function lockMatch(uint256 matchId) external;
    function startMatch(uint256 matchId) external;

    /// @notice Submit tap directly (with MetaMask).
    function submitTap(uint256 matchId, uint256 clientTimestampMs) external;

    /// @notice Submit tap via burner delegate wallet (no MetaMask popup for player).
    function submitTapFor(uint256 matchId, address player, uint256 clientTimestampMs) external;

    function endMatch(uint256 matchId) external;
    function forceSettle(uint256 matchId) external;
    function withdrawFees() external;

    // =========================================================================
    // View Functions
    // =========================================================================

    function getMatch(uint256 matchId) external view returns (Match memory);
    function isPlayer(uint256 matchId, address player) external view returns (bool);
    function hasTapped(uint256 matchId, address player) external view returns (bool);
    function getDelegate(uint256 matchId, address player) external view returns (address);
    function GAS_DELEGATE_AMOUNT() external view returns (uint256);
}
