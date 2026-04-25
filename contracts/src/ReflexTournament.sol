// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {IReflex} from "./interfaces/IReflex.sol";

/// @title ReflexTournament
/// @notice Tournament mode that orchestrates multiple Reflex matches.
///         Players pay a fixed entry fee → tournament runs N rounds →
///         points tallied (1st=3pts, 2nd=2pts, 3rd=1pt) → top 3 share prize pool.
/// @dev Extension contract; relies on the core Reflex contract for individual matches.
///      Prize split: 60% / 30% / 10% for 1st / 2nd / 3rd place.
contract ReflexTournament {
    // =========================================================================
    // Constants
    // =========================================================================

    uint256 public constant FIRST_PLACE_BPS = 6_000;
    uint256 public constant SECOND_PLACE_BPS = 3_000;
    uint256 public constant THIRD_PLACE_BPS = 1_000;
    uint256 public constant MAX_ROUNDS = 10;
    uint8 public constant MIN_PLAYERS = 3;
    uint8 public constant MAX_PLAYERS = 20;

    // =========================================================================
    // Enums
    // =========================================================================

    enum TournamentState {
        Registration,
        Active,
        Finished
    }

    // =========================================================================
    // Structs
    // =========================================================================

    struct Tournament {
        address host;
        uint256 entryFee;
        uint8 maxPlayers;
        uint8 roundsTotal;
        uint8 roundsCurrent;
        TournamentState state;
        uint256 prizePool;
    }

    struct PlayerScore {
        address player;
        uint256 points;
        uint256 bestReactionMs;
    }

    // =========================================================================
    // Events
    // =========================================================================

    event TournamentCreated(
        uint256 indexed tournamentId,
        address indexed host,
        uint256 entryFee,
        uint8 rounds,
        uint8 maxPlayers
    );
    event PlayerRegistered(uint256 indexed tournamentId, address indexed player, uint8 totalRegistered);
    event RoundStarted(uint256 indexed tournamentId, uint8 round, uint256 reflexMatchId);
    event RoundFinished(uint256 indexed tournamentId, uint8 round);
    event TournamentFinished(
        uint256 indexed tournamentId,
        address first,
        address second,
        address third,
        uint256 prizePool
    );

    // =========================================================================
    // Errors
    // =========================================================================

    error InvalidRoundCount(uint8 rounds, uint8 max);
    error InvalidPlayerCount(uint8 provided, uint8 min, uint8 max);
    error StakeMismatch(uint256 sent, uint256 required);
    error TournamentNotInRegistration(uint256 tournamentId);
    error TournamentNotActive(uint256 tournamentId);
    error AlreadyRegistered(uint256 tournamentId, address player);
    error RegistrationFull(uint256 tournamentId);
    error OnlyHost(address caller, address host);
    error NotEnoughPlayers(uint8 current, uint8 required);
    error PayoutFailed(address recipient, uint256 amount);
    error InvalidTournamentId(uint256 tournamentId);

    // =========================================================================
    // State Variables
    // =========================================================================

    address public immutable owner;
    IReflex public immutable reflexGame;

    uint256 public tournamentCounter;

    mapping(uint256 tournamentId => Tournament) private _tournaments;
    mapping(uint256 tournamentId => address[]) private _registeredPlayers;
    mapping(uint256 tournamentId => mapping(address player => uint256)) private _points;
    mapping(uint256 tournamentId => mapping(address player => uint256)) private _bestReaction;
    mapping(uint256 tournamentId => uint256[]) private _roundMatchIds;

    // =========================================================================
    // Modifiers
    // =========================================================================

    modifier onlyHost(uint256 tournamentId) {
        if (msg.sender != _tournaments[tournamentId].host) {
            revert OnlyHost(msg.sender, _tournaments[tournamentId].host);
        }
        _;
    }

    modifier validTournament(uint256 tournamentId) {
        if (tournamentId == 0 || tournamentId > tournamentCounter) {
            revert InvalidTournamentId(tournamentId);
        }
        _;
    }

    // =========================================================================
    // Constructor
    // =========================================================================

    /// @param _reflexGame Address of the deployed Reflex game contract
    constructor(address _reflexGame) {
        owner = msg.sender;
        reflexGame = IReflex(_reflexGame);
    }

    // =========================================================================
    // External Functions
    // =========================================================================

    /// @notice Create a new tournament. Caller becomes host.
    /// @param entryFee   Stake per player per round in wei
    /// @param rounds     Number of rounds to play (1–10)
    /// @param maxPlayers Maximum participants (3–20)
    /// @return tournamentId The ID of the newly created tournament
    function createTournament(
        uint256 entryFee,
        uint8 rounds,
        uint8 maxPlayers
    ) external returns (uint256 tournamentId) {
        if (rounds == 0 || rounds > MAX_ROUNDS) revert InvalidRoundCount(rounds, uint8(MAX_ROUNDS));
        if (maxPlayers < MIN_PLAYERS || maxPlayers > MAX_PLAYERS) {
            revert InvalidPlayerCount(maxPlayers, MIN_PLAYERS, MAX_PLAYERS);
        }

        tournamentCounter++;
        tournamentId = tournamentCounter;

        Tournament storage t = _tournaments[tournamentId];
        t.host = msg.sender;
        t.entryFee = entryFee;
        t.maxPlayers = maxPlayers;
        t.roundsTotal = rounds;
        t.state = TournamentState.Registration;

        emit TournamentCreated(tournamentId, msg.sender, entryFee, rounds, maxPlayers);
    }

    /// @notice Register for a tournament by paying the entry fee × number of rounds.
    /// @param tournamentId The tournament to join
    function register(uint256 tournamentId) external payable validTournament(tournamentId) {
        Tournament storage t = _tournaments[tournamentId];

        if (t.state != TournamentState.Registration) {
            revert TournamentNotInRegistration(tournamentId);
        }

        uint256 totalRequired = t.entryFee * t.roundsTotal;
        if (msg.value != totalRequired) revert StakeMismatch(msg.value, totalRequired);

        address[] storage players = _registeredPlayers[tournamentId];
        if (players.length >= t.maxPlayers) revert RegistrationFull(tournamentId);

        uint256 len = players.length;
        for (uint256 i = 0; i < len; i++) {
            if (players[i] == msg.sender) revert AlreadyRegistered(tournamentId, msg.sender);
        }

        players.push(msg.sender);
        t.prizePool += msg.value;

        emit PlayerRegistered(tournamentId, msg.sender, uint8(players.length));
    }

    /// @notice Host starts the tournament (closes registration, begins round 1).
    /// @param tournamentId The tournament to start
    function startTournament(
        uint256 tournamentId
    ) external validTournament(tournamentId) onlyHost(tournamentId) {
        Tournament storage t = _tournaments[tournamentId];
        if (t.state != TournamentState.Registration) {
            revert TournamentNotInRegistration(tournamentId);
        }

        uint8 count = uint8(_registeredPlayers[tournamentId].length);
        if (count < MIN_PLAYERS) revert NotEnoughPlayers(count, MIN_PLAYERS);

        t.state = TournamentState.Active;
        t.roundsCurrent = 1;

        uint256 matchId = _createRoundMatch(tournamentId);
        emit RoundStarted(tournamentId, 1, matchId);
    }

    /// @notice After a round's Reflex match finishes, host records the result and
    ///         awards tournament points. Advances to next round or finalizes tournament.
    /// @param tournamentId  The tournament
    /// @param matchId       The finished Reflex match ID for this round
    /// @param first         Address of 1st place (winner)
    /// @param second        Address of 2nd place
    /// @param third         Address of 3rd place
    function recordRoundResult(
        uint256 tournamentId,
        uint256 matchId,
        address first,
        address second,
        address third
    ) external validTournament(tournamentId) onlyHost(tournamentId) {
        Tournament storage t = _tournaments[tournamentId];
        if (t.state != TournamentState.Active) revert TournamentNotActive(tournamentId);

        // Award points
        if (first != address(0)) _points[tournamentId][first] += 3;
        if (second != address(0)) _points[tournamentId][second] += 2;
        if (third != address(0)) _points[tournamentId][third] += 1;

        emit RoundFinished(tournamentId, t.roundsCurrent);

        if (t.roundsCurrent >= t.roundsTotal) {
            _finalizeTournament(tournamentId);
        } else {
            t.roundsCurrent++;
            uint256 nextMatchId = _createRoundMatch(tournamentId);
            emit RoundStarted(tournamentId, t.roundsCurrent, nextMatchId);
        }
    }

    // =========================================================================
    // External View Functions
    // =========================================================================

    /// @notice Get tournament details
    function getTournament(
        uint256 tournamentId
    ) external view validTournament(tournamentId) returns (Tournament memory) {
        return _tournaments[tournamentId];
    }

    /// @notice Get registered players for a tournament
    function getPlayers(
        uint256 tournamentId
    ) external view validTournament(tournamentId) returns (address[] memory) {
        return _registeredPlayers[tournamentId];
    }

    /// @notice Get current leaderboard sorted by points descending
    /// @return Sorted array of PlayerScore structs
    function getLeaderboard(
        uint256 tournamentId
    ) external view validTournament(tournamentId) returns (PlayerScore[] memory) {
        address[] storage players = _registeredPlayers[tournamentId];
        uint256 len = players.length;
        PlayerScore[] memory scores = new PlayerScore[](len);

        for (uint256 i = 0; i < len; i++) {
            scores[i] = PlayerScore({
                player: players[i],
                points: _points[tournamentId][players[i]],
                bestReactionMs: _bestReaction[tournamentId][players[i]]
            });
        }

        // Insertion sort descending by points
        for (uint256 i = 1; i < len; i++) {
            PlayerScore memory key = scores[i];
            uint256 j = i;
            while (j > 0 && scores[j - 1].points < key.points) {
                scores[j] = scores[j - 1];
                j--;
            }
            scores[j] = key;
        }

        return scores;
    }

    // =========================================================================
    // Internal Functions
    // =========================================================================

    /// @dev Create a Reflex match for the current round. Each player stakes entryFee.
    ///      The match stake comes from the prize pool already collected at registration.
    function _createRoundMatch(uint256 tournamentId) internal returns (uint256 matchId) {
        Tournament storage t = _tournaments[tournamentId];
        address[] storage players = _registeredPlayers[tournamentId];

        matchId = reflexGame.createMatch{value: t.entryFee}(address(0));
        _roundMatchIds[tournamentId].push(matchId);
    }

    /// @dev Finalize tournament: distribute prize pool 60/30/10 to top 3 by points.
    function _finalizeTournament(uint256 tournamentId) internal {
        Tournament storage t = _tournaments[tournamentId];
        t.state = TournamentState.Finished;

        PlayerScore[] memory scores = this.getLeaderboard(tournamentId);
        uint256 prize = t.prizePool;

        address first = scores.length > 0 ? scores[0].player : address(0);
        address second = scores.length > 1 ? scores[1].player : address(0);
        address third = scores.length > 2 ? scores[2].player : address(0);

        _payout(first, (prize * FIRST_PLACE_BPS) / 10_000);
        _payout(second, (prize * SECOND_PLACE_BPS) / 10_000);
        _payout(third, (prize * THIRD_PLACE_BPS) / 10_000);

        emit TournamentFinished(tournamentId, first, second, third, prize);
    }

    /// @dev Safe ETH transfer; reverts on failure.
    function _payout(address recipient, uint256 amount) internal {
        if (recipient == address(0) || amount == 0) return;
        (bool sent,) = recipient.call{value: amount}("");
        if (!sent) revert PayoutFailed(recipient, amount);
    }
}
