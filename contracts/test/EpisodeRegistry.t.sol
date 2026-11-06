// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {EpisodeRegistry} from "../src/EpisodeRegistry.sol";

contract EpisodeRegistryTest is Test {
    EpisodeRegistry r;
    bytes32 constant ID = keccak256("ep");
    bytes32 constant SC = keccak256("scenario");
    bytes32 constant PUB = keccak256("pub");
    bytes32 constant SEAL = keccak256("seal");
    bytes32 constant RES = keccak256("res");

    event ScenarioCommitted(bytes32 indexed episodeId, address indexed evaluator, bytes32 scenarioCommitment);
    event EpisodeFinalized(bytes32 indexed episodeId, bytes32 publicRoot, bytes32 sealedRoot, bytes32 resultCommitment, uint8 status, bool collision);

    function setUp() public {
        r = new EpisodeRegistry();
        vm.warp(1_800_000_000);
    }

    function test_commitEmitsAndStoresTimestamp() public {
        vm.expectEmit(true, true, false, true);
        emit ScenarioCommitted(ID, address(this), SC);
        r.commitScenario(ID, SC);
        EpisodeRegistry.Episode memory e = r.getEpisode(ID);
        assertEq(e.evaluator, address(this));
        assertEq(e.scenarioCommitment, SC);
        assertEq(e.committedAt, 1_800_000_000);
    }

    function test_secondCommitReverts() public {
        r.commitScenario(ID, SC);
        vm.prank(address(0xBEEF));
        vm.expectRevert(EpisodeRegistry.AlreadyCommitted.selector);
        r.commitScenario(ID, SC);
    }

    function test_finalizeByOtherReverts() public {
        r.commitScenario(ID, SC);
        vm.prank(address(0xBEEF));
        vm.expectRevert(EpisodeRegistry.NotEvaluator.selector);
        r.finalizeEpisode(ID, PUB, SEAL, RES, 1, false);
    }

    function test_finalizeBeforeCommitReverts() public {
        vm.expectRevert(EpisodeRegistry.NotCommitted.selector);
        r.finalizeEpisode(ID, PUB, SEAL, RES, 1, false);
    }

    function test_finalizeTwiceReverts() public {
        r.commitScenario(ID, SC);
        r.finalizeEpisode(ID, PUB, SEAL, RES, 1, false);
        vm.expectRevert(EpisodeRegistry.AlreadyFinalized.selector);
        r.finalizeEpisode(ID, PUB, SEAL, RES, 2, true);
    }

    function test_badStatusReverts() public {
        r.commitScenario(ID, SC);
        vm.expectRevert(EpisodeRegistry.BadStatus.selector);
        r.finalizeEpisode(ID, PUB, SEAL, RES, 3, false);
        vm.expectRevert(EpisodeRegistry.BadStatus.selector);
        r.finalizeEpisode(ID, PUB, SEAL, RES, 0, false);
    }

    function test_happyPathStoresAllFieldsAndEmits() public {
        r.commitScenario(ID, SC);
        vm.warp(1_800_000_060);
        vm.expectEmit(true, false, false, true);
        emit EpisodeFinalized(ID, PUB, SEAL, RES, 2, true);
        r.finalizeEpisode(ID, PUB, SEAL, RES, 2, true);
        EpisodeRegistry.Episode memory e = r.getEpisode(ID);
        assertEq(e.publicRoot, PUB);
        assertEq(e.sealedRoot, SEAL);
        assertEq(e.resultCommitment, RES);
        assertEq(e.status, 2);
        assertTrue(e.collision);
        assertEq(e.committedAt, 1_800_000_000);
        assertEq(e.finalizedAt, 1_800_000_060);
    }
}
