// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IReflex} from "./interfaces/IReflex.sol";
import {IReflexLeaderboard} from "./interfaces/IReflexLeaderboard.sol";

contract Reflex is IReflex {
    // =========================================================================
    // Constants
    // =========================================================================

    uint256 public constant COUNTDOWN_MS = 3_000;
    uint256 public constant FORCE_SETTLE_TIMEOUT = 5 minutes;
    uint256 public constant PLATFORM_FEE_BPS = 200;
    uint8 public constant MIN_PLAYERS = 2;
    /// @notice Extra MON forwarded to burner delegate to cover tap gas fees
    uint256 public constant GAS_DELEGATE_AMOUNT = 0.002 ether;

    // =========================================================================
    // State Variables
    // =========================================================================

    address public immutable owner;
    IReflexLeaderboard public immutable leaderboard;

    uint256 public matchCounter;
    uint256 public accumulatedFees;

    mapping(uint256 matchId => Match) private _matches;
    mapping(uint256 matchId => mapping(address player => bool)) private _isPlayerMap;
    mapping(uint256 matchId => mapping(address player => bool)) private _hasTappedMap;
    /// @notice burner wallet that can tap on behalf of player
    mapping(uint256 matchId => mapping(address player => address delegate)) private _tapDelegates;

    // =========================================================================
    // Modifiers
    // =========================================================================

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner(msg.sender);
        _;
    }

    modifier onlyHost(uint256 matchId) {
        if (msg.sender != _matches[matchId].host) {
            revert OnlyHost(msg.sender, _matches[matchId].host);
        }
        _;
    }

    modifier validMatch(uint256 matchId) {
        if (matchId == 0 || matchId > matchCounter) revert InvalidMatchId(matchId);
        _;
    }

    // =========================================================================
    // Constructor
    // =========================================================================

    constructor(address _leaderboard) {
        owner = msg.sender;
        leaderboard = IReflexLeaderboard(_leaderboard);
    }

    // =========================================================================
    // External Functions — Match Lifecycle
    // =========================================================================

    /// @notice Create a match. tapDelegate = burner wallet for 1-click tap.
    ///         If tapDelegate != address(0), send stakePerPlayer + GAS_DELEGATE_AMOUNT.
    ///         stakePerPlayer = msg.value - GAS_DELEGATE_AMOUNT (if delegate) else msg.value.
    function createMatch(address tapDelegate) external payable override returns (uint256 matchId) {
        uint256 stake = _resolveStake(tapDelegate);
        if (stake == 0) revert StakeRequired();

        matchCounter++;
        matchId = matchCounter;

        Match storage m = _matches[matchId];
        m.host = msg.sender;
        m.stakePerPlayer = stake;
        m.state = MatchState.Open;
        m.playerCount = 1;

        _isPlayerMap[matchId][msg.sender] = true;

        if (tapDelegate != address(0)) {
            _tapDelegates[matchId][msg.sender] = tapDelegate;
            _forwardGas(tapDelegate);
        }

        emit MatchCreated(matchId, msg.sender, stake);
        emit MatchJoined(matchId, msg.sender, 1);
    }

    /// @notice Join a match. tapDelegate = burner wallet for instant tap.
    ///         If tapDelegate != address(0), msg.value = stakePerPlayer + GAS_DELEGATE_AMOUNT.
    function joinMatch(uint256 matchId, address tapDelegate) external payable override validMatch(matchId) {
        Match storage m = _matches[matchId];

        if (m.state != MatchState.Open) revert MatchNotJoinable(matchId, m.state);
        if (_isPlayerMap[matchId][msg.sender]) revert AlreadyJoined(matchId, msg.sender);

        uint256 expectedValue = tapDelegate != address(0)
            ? m.stakePerPlayer + GAS_DELEGATE_AMOUNT
            : m.stakePerPlayer;
        if (msg.value != expectedValue) revert StakeMismatch(msg.value, expectedValue);

        _isPlayerMap[matchId][msg.sender] = true;
        m.playerCount++;

        if (tapDelegate != address(0)) {
            _tapDelegates[matchId][msg.sender] = tapDelegate;
            _forwardGas(tapDelegate);
        }

        emit MatchJoined(matchId, msg.sender, m.playerCount);
    }

    function lockMatch(uint256 matchId) external override validMatch(matchId) onlyHost(matchId) {
        Match storage m = _matches[matchId];
        if (m.state != MatchState.Open) revert MatchNotOpen(matchId, m.state);
        if (m.playerCount < MIN_PLAYERS) revert NotEnoughPlayers(m.playerCount, MIN_PLAYERS);
        m.state = MatchState.Locked;
        emit MatchLocked(matchId, m.playerCount);
    }

    function startMatch(uint256 matchId) external override validMatch(matchId) onlyHost(matchId) {
        Match storage m = _matches[matchId];
        if (m.state != MatchState.Locked) revert MatchNotLocked(matchId, m.state);

        uint256 startedAt = block.timestamp;
        uint256 goTimestampMs = startedAt * 1_000 + COUNTDOWN_MS;

        m.startedAt = startedAt;
        m.goTimestampMs = goTimestampMs;
        m.state = MatchState.Active;

        emit MatchStarted(matchId, startedAt, goTimestampMs, COUNTDOWN_MS);
    }

    /// @notice Direct tap by player (MetaMask).
    function submitTap(uint256 matchId, uint256 clientTimestampMs) external override validMatch(matchId) {
        _submitTapInternal(matchId, msg.sender, clientTimestampMs);
    }

    /// @notice Tap submitted by burner delegate on behalf of player (no MetaMask popup).
    function submitTapFor(
        uint256 matchId,
        address player,
        uint256 clientTimestampMs
    ) external override validMatch(matchId) {
        if (_tapDelegates[matchId][player] != msg.sender) {
            revert NotDelegate(matchId, msg.sender, player);
        }
        _submitTapInternal(matchId, player, clientTimestampMs);
    }

    function endMatch(uint256 matchId) external override validMatch(matchId) onlyHost(matchId) {
        Match storage m = _matches[matchId];
        if (m.state != MatchState.Active) revert MatchNotActive(matchId, m.state);
        _settle(matchId);
    }

    function forceSettle(uint256 matchId) external override validMatch(matchId) {
        Match storage m = _matches[matchId];
        if (m.state != MatchState.Active) revert MatchNotActive(matchId, m.state);
        uint256 readyAt = m.startedAt + FORCE_SETTLE_TIMEOUT;
        if (block.timestamp < readyAt) revert ForceSettleNotReady(block.timestamp, readyAt);
        emit MatchForceSettled(matchId);
        _settle(matchId);
    }

    function withdrawFees() external override onlyOwner {
        uint256 amount = accumulatedFees;
        if (amount == 0) revert NoFeesToWithdraw();
        accumulatedFees = 0;
        (bool sent,) = owner.call{value: amount}("");
        if (!sent) revert PayoutFailed(owner, amount);
        emit FeesWithdrawn(owner, amount);
    }

    // =========================================================================
    // View Functions
    // =========================================================================

    function getMatch(uint256 matchId) external view override validMatch(matchId) returns (Match memory) {
        return _matches[matchId];
    }

    function isPlayer(uint256 matchId, address player) external view override returns (bool) {
        return _isPlayerMap[matchId][player];
    }

    function hasTapped(uint256 matchId, address player) external view override returns (bool) {
        return _hasTappedMap[matchId][player];
    }

    function getDelegate(uint256 matchId, address player) external view override returns (address) {
        return _tapDelegates[matchId][player];
    }

    // =========================================================================
    // Internal Functions
    // =========================================================================

    function _resolveStake(address tapDelegate) internal view returns (uint256) {
        if (tapDelegate == address(0)) return msg.value;
        if (msg.value <= GAS_DELEGATE_AMOUNT) return 0;
        return msg.value - GAS_DELEGATE_AMOUNT;
    }

    function _forwardGas(address delegate) internal {
        (bool ok,) = delegate.call{value: GAS_DELEGATE_AMOUNT}("");
        if (!ok) revert GasForwardFailed(delegate);
    }

    function _submitTapInternal(uint256 matchId, address player, uint256 clientTimestampMs) internal {
        Match storage m = _matches[matchId];

        if (m.state != MatchState.Active) revert MatchNotActive(matchId, m.state);
        if (!_isPlayerMap[matchId][player]) revert NotAPlayer(matchId, player);
        if (_hasTappedMap[matchId][player]) revert AlreadyTapped(matchId, player);
        if (clientTimestampMs < m.goTimestampMs) revert TappedTooEarly(clientTimestampMs, m.goTimestampMs);

        uint256 reactionMs = clientTimestampMs - m.goTimestampMs;

        _hasTappedMap[matchId][player] = true;
        m.tappedCount++;

        _updateTopThree(m, player, reactionMs);

        emit TapSubmitted(matchId, player, reactionMs);

        if (m.tappedCount == m.playerCount) {
            _settle(matchId);
        }
    }

    function _settle(uint256 matchId) internal {
        Match storage m = _matches[matchId];
        m.state = MatchState.Finished;

        uint256 pot = m.stakePerPlayer * m.playerCount;
        uint256 fee = (pot * PLATFORM_FEE_BPS) / 10_000;
        uint256 netPot = pot - fee;
        accumulatedFees += fee;

        uint8 winnersCount = _winnersCount(m.tappedCount);
        uint256[3] memory prizes;

        if (winnersCount > 0) {
            prizes = _pay(m, netPot, winnersCount);
        } else {
            accumulatedFees += netPot;
        }

        emit MatchFinished(matchId, m.topPlayers, m.topReactionMs, prizes, winnersCount, fee);
        _recordLeaderboard(m, prizes, winnersCount);
    }

    function _winnersCount(uint32 tapped) internal pure returns (uint8) {
        if (tapped == 0) return 0;
        if (tapped >= 11) return 3;
        if (tapped >= 5) return 2;
        return 1;
    }

    function _pay(Match storage m, uint256 netPot, uint8 winnersCount) internal returns (uint256[3] memory prizes) {
        uint256[3] memory bps;
        if (winnersCount == 1) {
            bps[0] = 10_000;
        } else if (winnersCount == 2) {
            bps[0] = 6_500; bps[1] = 3_500;
        } else {
            bps[0] = 6_000; bps[1] = 3_000; bps[2] = 1_000;
        }
        for (uint8 i = 0; i < winnersCount; i++) {
            address recipient = m.topPlayers[i];
            if (recipient == address(0)) break;
            prizes[i] = (netPot * bps[i]) / 10_000;
            (bool sent,) = recipient.call{value: prizes[i]}("");
            if (!sent) revert PayoutFailed(recipient, prizes[i]);
        }
    }

    function _updateTopThree(Match storage m, address player, uint256 reactionMs) internal {
        uint8 insertAt = 3;
        for (uint8 i = 0; i < 3; i++) {
            if (m.topPlayers[i] == address(0) || reactionMs < m.topReactionMs[i]) {
                insertAt = i;
                break;
            }
        }
        if (insertAt == 3) return;
        for (uint8 j = 2; j > insertAt; j--) {
            m.topPlayers[j] = m.topPlayers[j - 1];
            m.topReactionMs[j] = m.topReactionMs[j - 1];
        }
        m.topPlayers[insertAt] = player;
        m.topReactionMs[insertAt] = reactionMs;
    }

    function _recordLeaderboard(Match storage m, uint256[3] memory prizes, uint8 winnersCount) internal {
        for (uint8 i = 0; i < winnersCount; i++) {
            address player = m.topPlayers[i];
            if (player == address(0)) break;
            try leaderboard.recordResult(player, m.topReactionMs[i], i == 0, prizes[i]) {} catch {}
        }
    }
}
