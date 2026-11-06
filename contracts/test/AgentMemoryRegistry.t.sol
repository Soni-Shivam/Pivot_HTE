// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {AgentMemoryRegistry, IIdentityOwner} from "../src/AgentMemoryRegistry.sol";

/// Mimics the ERC-8004 Identity Registry's ERC-721 ownerOf (reverts for unknown ids, like the live one).
contract MockIdentity is IIdentityOwner {
    mapping(uint256 => address) public owners;
    error ERC721NonexistentToken(uint256 tokenId);

    function set(uint256 id, address o) external {
        owners[id] = o;
    }

    function ownerOf(uint256 id) external view returns (address o) {
        o = owners[id];
        if (o == address(0)) revert ERC721NonexistentToken(id);
    }
}

contract AgentMemoryRegistryTest is Test {
    MockIdentity idr;
    AgentMemoryRegistry r;
    bytes32 constant MODEL = keccak256("idm-follower");
    bytes32 constant PUB = keccak256("pub");
    bytes32 constant SEAL = keccak256("seal");
    bytes32 constant SEAL2 = keccak256("seal2");
    bytes32 constant CLAIMS = keccak256("claims");
    address constant OWNER = address(0xA11CE);
    address constant MALLORY = address(0xBEEF);

    event MemoryAnchored(
        uint256 indexed agentId, bytes32 indexed modelId, uint64 indexed seq, string version, bytes32 publicRoot,
        bytes32 sealedRoot, bytes32 prevRoot, bytes32 claimsRoot, address owner
    );

    function setUp() public {
        idr = new MockIdentity();
        r = new AgentMemoryRegistry(idr);
        idr.set(579, OWNER);
        vm.warp(1_800_000_000);
        vm.roll(1000);
    }

    function test_firstAnchorStoresAndEmits() public {
        vm.expectEmit(true, true, true, true);
        emit MemoryAnchored(579, MODEL, 1, "1.0", PUB, SEAL, bytes32(0), CLAIMS, OWNER);
        vm.prank(OWNER);
        uint64 seq = r.anchor(579, MODEL, "1.0", PUB, SEAL, bytes32(0), CLAIMS);
        assertEq(seq, 1);
        assertEq(r.latestSeq(579, MODEL), 1);
        AgentMemoryRegistry.Anchor memory a = r.getAnchor(579, MODEL, 1);
        assertEq(a.publicRoot, PUB);
        assertEq(a.sealedRoot, SEAL);
        assertEq(a.claimsRoot, CLAIMS);
        assertEq(a.owner, OWNER);
        assertEq(a.blockNumber, 1000);
        assertEq(a.timestamp, 1_800_000_000);
        assertEq(a.version, "1.0");
    }

    function test_chainRequiresPrevSealedRoot() public {
        vm.startPrank(OWNER);
        r.anchor(579, MODEL, "1.0", PUB, SEAL, bytes32(0), CLAIMS);
        vm.expectRevert(abi.encodeWithSelector(AgentMemoryRegistry.BadPrevRoot.selector, SEAL));
        r.anchor(579, MODEL, "1.1", PUB, SEAL2, bytes32(0), CLAIMS);
        vm.expectRevert(abi.encodeWithSelector(AgentMemoryRegistry.BadPrevRoot.selector, SEAL));
        r.anchor(579, MODEL, "1.1", PUB, SEAL2, PUB, CLAIMS);
        assertEq(r.anchor(579, MODEL, "1.1", PUB, SEAL2, SEAL, CLAIMS), 2);
        assertEq(r.getAnchor(579, MODEL, 2).prevRoot, SEAL);
        vm.stopPrank();
    }

    function test_firstAnchorMustHaveZeroPrev() public {
        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(AgentMemoryRegistry.BadPrevRoot.selector, bytes32(0)));
        r.anchor(579, MODEL, "1.0", PUB, SEAL, SEAL, CLAIMS);
    }

    function test_onlyCurrentOwner() public {
        vm.prank(MALLORY);
        vm.expectRevert(AgentMemoryRegistry.NotAgentOwner.selector);
        r.anchor(579, MODEL, "1.0", PUB, SEAL, bytes32(0), CLAIMS);
        idr.set(579, MALLORY); // NFT transferred: the new owner anchors, the old one cannot
        vm.prank(OWNER);
        vm.expectRevert(AgentMemoryRegistry.NotAgentOwner.selector);
        r.anchor(579, MODEL, "1.0", PUB, SEAL, bytes32(0), CLAIMS);
        vm.prank(MALLORY);
        r.anchor(579, MODEL, "1.0", PUB, SEAL, bytes32(0), CLAIMS);
    }

    function test_unknownAgentReverts() public {
        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(MockIdentity.ERC721NonexistentToken.selector, 7));
        r.anchor(7, MODEL, "1.0", PUB, SEAL, bytes32(0), CLAIMS);
    }

    function test_zeroRootsRevert() public {
        vm.startPrank(OWNER);
        vm.expectRevert(AgentMemoryRegistry.ZeroRoot.selector);
        r.anchor(579, MODEL, "1.0", bytes32(0), SEAL, bytes32(0), CLAIMS);
        vm.expectRevert(AgentMemoryRegistry.ZeroRoot.selector);
        r.anchor(579, MODEL, "1.0", PUB, bytes32(0), bytes32(0), CLAIMS);
        vm.expectRevert(AgentMemoryRegistry.ZeroRoot.selector);
        r.anchor(579, MODEL, "1.0", PUB, SEAL, bytes32(0), bytes32(0));
        vm.stopPrank();
    }

    function test_seqIsPerAgentAndModel() public {
        idr.set(580, OWNER);
        vm.startPrank(OWNER);
        r.anchor(579, MODEL, "1.0", PUB, SEAL, bytes32(0), CLAIMS);
        assertEq(r.anchor(579, keccak256("pdm-lite-lidar"), "1.0", PUB, SEAL, bytes32(0), CLAIMS), 1);
        assertEq(r.anchor(580, MODEL, "1.0", PUB, SEAL, bytes32(0), CLAIMS), 1);
        vm.stopPrank();
        assertEq(r.latestSeq(579, MODEL), 1);
    }
}
