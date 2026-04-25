// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import {Reflex} from "../src/Reflex.sol";
import {ReflexLeaderboard} from "../src/ReflexLeaderboard.sol";
import {IReflex} from "../src/interfaces/IReflex.sol";

contract ReflexTest is Test {
    receive() external payable {}

    Reflex internal reflex;
    ReflexLeaderboard internal leaderboard;

    address internal host = makeAddr("host");
    address internal p1 = makeAddr("p1");
    address internal p2 = makeAddr("p2");
    address internal p3 = makeAddr("p3");
    address internal p4 = makeAddr("p4");

    uint256 internal constant STAKE = 0.01 ether;

    function setUp() public {
        leaderboard = new ReflexLeaderboard();
        reflex = new Reflex(address(leaderboard));
        leaderboard.setGameContract(address(reflex));

        vm.deal(host, 10 ether);
        vm.deal(p1, 10 ether);
        vm.deal(p2, 10 ether);
        vm.deal(p3, 10 ether);
        vm.deal(p4, 10 ether);
    }

    // =========================================================================
    // Helper
    // =========================================================================

    /// @dev Buat match, join N players, lock, start. Return goTimestampMs.
    function _setupActiveMatch(
        address[] memory players
    ) internal returns (uint256 matchId, uint256 goTs) {
        vm.prank(host);
        matchId = reflex.createMatch{value: STAKE}(address(0));

        for (uint256 i = 0; i < players.length; i++) {
            vm.prank(players[i]);
            reflex.joinMatch{value: STAKE}(matchId, address(0));
        }

        vm.prank(host);
        reflex.lockMatch(matchId);

        vm.warp(1_000);
        vm.prank(host);
        reflex.startMatch(matchId);

        goTs = reflex.getMatch(matchId).goTimestampMs;
    }

    // =========================================================================
    // createMatch
    // =========================================================================

    function test_CreateMatch_Success() public {
        vm.prank(host);
        uint256 id = reflex.createMatch{value: STAKE}(address(0));

        assertEq(id, 1);
        IReflex.Match memory m = reflex.getMatch(1);
        assertEq(m.host, host);
        assertEq(m.stakePerPlayer, STAKE);
        assertEq(m.playerCount, 1);
        assertEq(uint8(m.state), uint8(IReflex.MatchState.Open));
        assertTrue(reflex.isPlayer(1, host));
    }

    function test_CreateMatch_RevertIf_ZeroStake() public {
        vm.prank(host);
        vm.expectRevert(IReflex.StakeRequired.selector);
        reflex.createMatch{value: 0}(address(0));
    }

    // =========================================================================
    // joinMatch
    // =========================================================================

    function test_JoinMatch_Success() public {
        vm.prank(host);
        reflex.createMatch{value: STAKE}(address(0));

        vm.prank(p1);
        reflex.joinMatch{value: STAKE}(1, address(0));

        assertEq(reflex.getMatch(1).playerCount, 2);
        assertTrue(reflex.isPlayer(1, p1));
    }

    function test_JoinMatch_RevertIf_WrongStake() public {
        vm.prank(host);
        reflex.createMatch{value: STAKE}(address(0));

        vm.prank(p1);
        vm.expectRevert(
            abi.encodeWithSelector(IReflex.StakeMismatch.selector, STAKE / 2, STAKE)
        );
        reflex.joinMatch{value: STAKE / 2}(1, address(0));
    }

    function test_JoinMatch_RevertIf_AlreadyJoined() public {
        vm.prank(host);
        reflex.createMatch{value: STAKE}(address(0));

        vm.prank(p1);
        reflex.joinMatch{value: STAKE}(1, address(0));

        vm.prank(p1);
        vm.expectRevert(abi.encodeWithSelector(IReflex.AlreadyJoined.selector, 1, p1));
        reflex.joinMatch{value: STAKE}(1, address(0));
    }

    // =========================================================================
    // startMatch — countdown on-chain
    // =========================================================================

    function test_StartMatch_SetsGoTimestampMs() public {
        vm.prank(host);
        reflex.createMatch{value: STAKE}(address(0));
        vm.prank(p1);
        reflex.joinMatch{value: STAKE}(1, address(0));
        vm.prank(host);
        reflex.lockMatch(1);

        uint256 ts = 2_000; // block.timestamp = 2000 detik
        vm.warp(ts);
        vm.prank(host);
        reflex.startMatch(1);

        IReflex.Match memory m = reflex.getMatch(1);
        // goTimestampMs = 2000 * 1000 + 3000 = 2_003_000 ms
        assertEq(m.goTimestampMs, ts * 1_000 + 3_000);
        assertEq(m.startedAt, ts);
    }

    function test_SubmitTap_RevertIf_BeforeGo() public {
        address[] memory players = new address[](1);
        players[0] = p1;
        (uint256 id, uint256 goTs) = _setupActiveMatch(players);

        vm.prank(p1);
        vm.expectRevert(
            abi.encodeWithSelector(IReflex.TappedTooEarly.selector, goTs - 1, goTs)
        );
        reflex.submitTap(id, goTs - 1);
    }

    // =========================================================================
    // Auto-scale winners — 1 pemenang (1-4 tap)
    // =========================================================================

    function test_Winner1_SingleTapper() public {
        address[] memory players = new address[](1);
        players[0] = p1;
        (uint256 id, uint256 goTs) = _setupActiveMatch(players);

        uint256 balanceBefore = p1.balance;

        vm.prank(p1);
        reflex.submitTap(id, goTs + 200);

        // host juga tap
        vm.prank(host);
        reflex.submitTap(id, goTs + 500);

        // 2 tap → 1 pemenang, tapi kita cek endMatch karena host mungkin tidak tap
        // sebenarnya auto-settle saat tappedCount == playerCount

        IReflex.Match memory m = reflex.getMatch(id);
        assertEq(uint8(m.state), uint8(IReflex.MatchState.Finished));
        assertEq(m.topPlayers[0], p1); // p1 lebih cepat
        assertEq(m.topReactionMs[0], 200);
    }

    function test_Winner1_Payout_Is100Percent() public {
        // 2 pemain total, 2 yang tap → 1 pemenang
        address[] memory players = new address[](1);
        players[0] = p1;
        (uint256 id, uint256 goTs) = _setupActiveMatch(players);

        vm.prank(host);
        reflex.submitTap(id, goTs + 500);
        vm.prank(p1);
        reflex.submitTap(id, goTs + 200); // auto-settle

        uint256 pot = STAKE * 2;
        uint256 fee = (pot * 200) / 10_000; // 2%
        uint256 netPot = pot - fee;

        // p1 juara 1 → dapat 100% net pot
        assertEq(p1.balance, 10 ether - STAKE + netPot);
    }

    // =========================================================================
    // Auto-scale winners — 2 pemenang (5-10 tap)
    // =========================================================================

    function test_Winner2_FiveToTen() public {
        // Setup: host + 5 players = 6 total, semua tap
        address[] memory extra = new address[](5);
        for (uint256 i = 0; i < 5; i++) {
            extra[i] = makeAddr(string(abi.encodePacked("extra", i)));
            vm.deal(extra[i], 1 ether);
        }

        vm.prank(host);
        uint256 id = reflex.createMatch{value: STAKE}(address(0));
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(extra[i]);
            reflex.joinMatch{value: STAKE}(id, address(0));
        }
        vm.prank(host);
        reflex.lockMatch(id);

        vm.warp(1_000);
        vm.prank(host);
        reflex.startMatch(id);

        uint256 goTs = reflex.getMatch(id).goTimestampMs;

        // Host paling cepat, extra[0] kedua
        vm.prank(host);
        reflex.submitTap(id, goTs + 100);
        vm.prank(extra[0]);
        reflex.submitTap(id, goTs + 200);
        for (uint256 i = 1; i < 5; i++) {
            vm.prank(extra[i]);
            reflex.submitTap(id, goTs + 300 + i * 50);
        }

        IReflex.Match memory m = reflex.getMatch(id);
        assertEq(uint8(m.state), uint8(IReflex.MatchState.Finished));
        assertEq(m.topPlayers[0], host);    // juara 1
        assertEq(m.topPlayers[1], extra[0]); // juara 2
        // 6 tap → 2 pemenang
        assertEq(m.topPlayers[2], extra[1]); // slot 3 tetap diisi tapi tidak dapat hadiah
    }

    // =========================================================================
    // endMatch — host close kapanpun
    // =========================================================================

    function test_EndMatch_ByHost_OnlyOneTapped() public {
        address[] memory players = new address[](3);
        players[0] = p1;
        players[1] = p2;
        players[2] = p3;
        (uint256 id, uint256 goTs) = _setupActiveMatch(players);

        // Hanya p1 yang tap
        vm.prank(p1);
        reflex.submitTap(id, goTs + 150);

        // Host close game (p2, p3 diskualifikasi)
        vm.prank(host);
        reflex.endMatch(id);

        IReflex.Match memory m = reflex.getMatch(id);
        assertEq(uint8(m.state), uint8(IReflex.MatchState.Finished));
        // Hanya 1 yang tap (p1), 1 pemenang
        assertEq(m.topPlayers[0], p1);
    }

    function test_EndMatch_RevertIf_NotHost() public {
        address[] memory players = new address[](1);
        players[0] = p1;
        (uint256 id, uint256 goTs) = _setupActiveMatch(players);

        vm.prank(p1);
        reflex.submitTap(id, goTs + 100);

        vm.prank(p1); // p1 bukan host
        vm.expectRevert(abi.encodeWithSelector(IReflex.OnlyHost.selector, p1, host));
        reflex.endMatch(id);
    }

    // =========================================================================
    // forceSettle — safety net setelah 5 menit
    // =========================================================================

    function test_ForceSettle_AfterTimeout() public {
        address[] memory players = new address[](1);
        players[0] = p1;
        (uint256 id, uint256 goTs) = _setupActiveMatch(players);

        vm.prank(p1);
        reflex.submitTap(id, goTs + 100);

        // Warp 5 menit + 1 detik
        vm.warp(1_000 + 5 minutes + 1);

        vm.prank(p2); // siapapun bisa panggil
        reflex.forceSettle(id);

        assertEq(
            uint8(reflex.getMatch(id).state),
            uint8(IReflex.MatchState.Finished)
        );
    }

    function test_ForceSettle_RevertIf_TooEarly() public {
        address[] memory players = new address[](1);
        players[0] = p1;
        (uint256 id,) = _setupActiveMatch(players);

        vm.warp(1_000 + 1 minutes); // baru 1 menit, belum 5 menit

        vm.prank(p2);
        vm.expectRevert(
            abi.encodeWithSelector(
                IReflex.ForceSettleNotReady.selector,
                1_000 + 1 minutes,
                1_000 + 5 minutes
            )
        );
        reflex.forceSettle(id);
    }

    // =========================================================================
    // 0 tap — pot ke platform
    // =========================================================================

    function test_ZeroTap_PotGoesToPlatform() public {
        address[] memory players = new address[](1);
        players[0] = p1;
        (uint256 id,) = _setupActiveMatch(players);

        // Tidak ada yang tap, host langsung close
        vm.prank(host);
        reflex.endMatch(id);

        IReflex.Match memory m = reflex.getMatch(id);
        assertEq(uint8(m.state), uint8(IReflex.MatchState.Finished));

        // Seluruh pot masuk accumulatedFees
        uint256 pot = STAKE * 2;
        assertEq(reflex.accumulatedFees(), pot);
    }

    // =========================================================================
    // Platform fee
    // =========================================================================

    function test_PlatformFee_2Percent() public {
        address[] memory players = new address[](1);
        players[0] = p1;
        (uint256 id, uint256 goTs) = _setupActiveMatch(players);

        vm.prank(host);
        reflex.submitTap(id, goTs + 300);
        vm.prank(p1);
        reflex.submitTap(id, goTs + 100); // auto-settle

        uint256 pot = STAKE * 2;
        uint256 expectedFee = (pot * 200) / 10_000; // 2%
        assertEq(reflex.accumulatedFees(), expectedFee);
    }

    function test_WithdrawFees_OnlyOwner() public {
        address[] memory players = new address[](1);
        players[0] = p1;
        (uint256 id, uint256 goTs) = _setupActiveMatch(players);

        vm.prank(p1);
        reflex.submitTap(id, goTs + 100);
        vm.prank(host);
        reflex.submitTap(id, goTs + 200);

        uint256 fees = reflex.accumulatedFees();
        assertGt(fees, 0);

        address contractOwner = reflex.owner();
        uint256 ownerBalBefore = contractOwner.balance;

        vm.prank(contractOwner);
        reflex.withdrawFees();

        assertEq(contractOwner.balance, ownerBalBefore + fees);
        assertEq(reflex.accumulatedFees(), 0);
    }

    // =========================================================================
    // Fuzz Tests
    // =========================================================================

    function testFuzz_Winner_IsAlwaysFastest(uint256 r1, uint256 r2) public {
        vm.assume(r1 > 0 && r1 < 4_000);
        vm.assume(r2 > 0 && r2 < 4_000);
        vm.assume(r1 != r2);

        address[] memory players = new address[](1);
        players[0] = p1;
        (uint256 id, uint256 goTs) = _setupActiveMatch(players);

        address faster = r1 < r2 ? host : p1;

        vm.prank(host);
        reflex.submitTap(id, goTs + r1);
        vm.prank(p1);
        reflex.submitTap(id, goTs + r2);

        assertEq(reflex.getMatch(id).topPlayers[0], faster);
        assertEq(
            reflex.getMatch(id).topReactionMs[0],
            r1 < r2 ? r1 : r2
        );
    }
}
