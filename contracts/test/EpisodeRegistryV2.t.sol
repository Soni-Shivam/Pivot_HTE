// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {EpisodeRegistryV2} from "../src/EpisodeRegistryV2.sol";

contract EpisodeRegistryV2Test is Test {
    EpisodeRegistryV2 r;
    bytes32 constant ID = keccak256("ep");
    bytes32 constant ID2 = keccak256("ep2");
    bytes32 constant SC = keccak256("scenario");
    bytes32 constant CFG = keccak256("config");
    bytes32 constant PUB = keccak256("pub");
    bytes32 constant SEAL = keccak256("seal");
    bytes32 constant RES = keccak256("res");
    address constant MALLORY = address(0xBEEF);

    function setUp() public {
        r = new EpisodeRegistryV2();
        vm.warp(1_800_000_000);
        vm.roll(1000);
    }

    function test_commitStoresSeqBlockConfig() public {
        uint64 seq = r.commitScenario(ID, SC, CFG);
        EpisodeRegistryV2.Episode memory e = r.getEpisode(address(this), ID);
        assertEq(seq, 1);
        assertEq(e.seq, 1);
        assertEq(e.scenarioCommitment, SC);
        assertEq(e.configHash, CFG);
        assertEq(e.commitBlock, 1000);
        assertEq(e.committedAt, 1_800_000_000);
        assertEq(e.status, 0);
        assertEq(r.episodeBySeq(address(this), 1), ID);
    }

    function test_frontRunCannotGriefAnotherEvaluator() public {
        vm.prank(MALLORY);
        r.commitScenario(ID, SC, CFG); // Mallory copies our id from the mempool
        r.commitScenario(ID, SC, CFG); // ours still works: keyed by (evaluator, id)
        assertEq(r.getEpisode(address(this), ID).seq, 1);
        assertEq(r.getEpisode(MALLORY, ID).seq, 1);
    }

    function test_secondCommitSameEvaluatorReverts() public {
        r.commitScenario(ID, SC, CFG);
        vm.expectRevert(EpisodeRegistryV2.AlreadyCommitted.selector);
        r.commitScenario(ID, SC, CFG);
    }

    function test_zeroCommitmentReverts() public {
        vm.expectRevert(EpisodeRegistryV2.ZeroCommitment.selector);
        r.commitScenario(ID, bytes32(0), CFG);
        vm.expectRevert(EpisodeRegistryV2.ZeroCommitment.selector);
        r.commitScenario(ID, SC, bytes32(0));
    }

    function test_finalizeOnlyOwnEpisode() public {
        r.commitScenario(ID, SC, CFG);
        vm.prank(MALLORY);
        vm.expectRevert(EpisodeRegistryV2.NotCommitted.selector);
        r.finalizeEpisode(ID, PUB, SEAL, RES, 1, false);
    }

    function test_finalizeOnceAndBadStatus() public {
        r.commitScenario(ID, SC, CFG);
        vm.expectRevert(EpisodeRegistryV2.BadStatus.selector);
        r.finalizeEpisode(ID, PUB, SEAL, RES, 0, false);
        vm.expectRevert(EpisodeRegistryV2.BadStatus.selector);
        r.finalizeEpisode(ID, PUB, SEAL, RES, 4, false);
        vm.warp(1_800_000_100);
        r.finalizeEpisode(ID, PUB, SEAL, RES, 2, true);
        EpisodeRegistryV2.Episode memory e = r.getEpisode(address(this), ID);
        assertEq(e.publicRoot, PUB);
        assertEq(e.status, 2);
        assertTrue(e.collision);
        assertEq(e.finalizedAt, 1_800_000_100);
        vm.expectRevert(EpisodeRegistryV2.AlreadyFinalized.selector);
        r.finalizeEpisode(ID, PUB, SEAL, RES, 1, false);
    }

    function test_statsExposeRerunsAndAborts() public {
        r.commitScenario(ID, SC, CFG);
        r.commitScenario(ID2, SC, CFG);
        r.commitScenario(keccak256("ep3"), SC, CFG); // started, never finalized: visible as committed - finalized
        r.finalizeEpisode(ID, bytes32(0), bytes32(0), bytes32(0), 3, false);
        r.finalizeEpisode(ID2, PUB, SEAL, RES, 1, false);
        EpisodeRegistryV2.Stats memory s = r.stats(address(this));
        assertEq(s.committed, 3);
        assertEq(s.completed, 1);
        assertEq(s.interrupted, 0);
        assertEq(s.aborted, 1);
        assertEq(r.episodeBySeq(address(this), 3), keccak256("ep3"));
        assertEq(r.getEpisode(address(this), keccak256("ep3")).status, 0);
    }
}
