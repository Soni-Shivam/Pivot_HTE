// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// ERC-721 `ownerOf` of the ERC-8004 Identity Registry. Confirmed on Galileo 0x8004A818BFB912233c491871b3d84c89A494BD9e
/// by live reads (2026-11-07): supportsInterface(0x80ac58cd) = true, ownerOf(579) = the agent owner, ownerOf(unknown)
/// reverts ERC721NonexistentToken (docs/evidence/faultline-memory.md).
interface IIdentityOwner {
    function ownerOf(uint256 agentId) external view returns (address);
}

/// @title AgentMemoryRegistry: owner-anchored, hash-linked safety-memory snapshots per (ERC-8004 agent, model).
/// Only the agent NFT's current owner can anchor. Each anchor names the 0G Storage roots of the public summary and the
/// sealed snapshot, the claims Merkle root, and `prevRoot`, which must equal the previous anchor's sealedRoot for the
/// same (agent, model) (bytes32(0) for the first), so the history is an append-only chain with a per-model sequence.
/// No payments, roles or upgradeability.
contract AgentMemoryRegistry {
    struct Anchor {
        bytes32 publicRoot;
        bytes32 sealedRoot;
        bytes32 prevRoot;
        bytes32 claimsRoot;
        address owner;
        uint64 blockNumber;
        uint64 timestamp;
        string version;
    }

    IIdentityOwner public immutable identity;
    mapping(uint256 => mapping(bytes32 => uint64)) public latestSeq;
    mapping(uint256 => mapping(bytes32 => mapping(uint64 => Anchor))) private anchors;

    error NotAgentOwner();
    error ZeroRoot();
    error BadPrevRoot(bytes32 expected);

    event MemoryAnchored(
        uint256 indexed agentId,
        bytes32 indexed modelId,
        uint64 indexed seq,
        string version,
        bytes32 publicRoot,
        bytes32 sealedRoot,
        bytes32 prevRoot,
        bytes32 claimsRoot,
        address owner
    );

    constructor(IIdentityOwner identity_) {
        identity = identity_;
    }

    /// modelId = keccak256(bytes(model_id)), e.g. keccak256("idm-follower"); version e.g. "1.1".
    function anchor(
        uint256 agentId,
        bytes32 modelId,
        string calldata version,
        bytes32 publicRoot,
        bytes32 sealedRoot,
        bytes32 prevRoot,
        bytes32 claimsRoot
    ) external returns (uint64 seq) {
        if (identity.ownerOf(agentId) != msg.sender) revert NotAgentOwner();
        if (publicRoot == bytes32(0) || sealedRoot == bytes32(0) || claimsRoot == bytes32(0)) revert ZeroRoot();
        uint64 last = latestSeq[agentId][modelId];
        bytes32 expected = last == 0 ? bytes32(0) : anchors[agentId][modelId][last].sealedRoot;
        if (prevRoot != expected) revert BadPrevRoot(expected);
        seq = last + 1;
        latestSeq[agentId][modelId] = seq;
        anchors[agentId][modelId][seq] = Anchor(
            publicRoot, sealedRoot, prevRoot, claimsRoot, msg.sender, uint64(block.number), uint64(block.timestamp), version
        );
        emit MemoryAnchored(agentId, modelId, seq, version, publicRoot, sealedRoot, prevRoot, claimsRoot, msg.sender);
    }

    function getAnchor(uint256 agentId, bytes32 modelId, uint64 seq) external view returns (Anchor memory) {
        return anchors[agentId][modelId][seq];
    }
}
