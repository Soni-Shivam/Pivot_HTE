// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title EpisodeRegistry: commit a salted scenario before the first inference, finalize roots and result after.
/// No payments, roles or upgradeability (Faultline spec §7).
contract EpisodeRegistry {
    struct Episode {
        address evaluator;
        bytes32 scenarioCommitment;
        bytes32 publicRoot;
        bytes32 sealedRoot;
        bytes32 resultCommitment;
        uint8 status; // 1 completed, 2 interrupted
        bool collision;
        uint64 committedAt;
        uint64 finalizedAt;
    }

    mapping(bytes32 => Episode) private episodes;

    error AlreadyCommitted();
    error NotEvaluator();
    error NotCommitted();
    error AlreadyFinalized();
    error BadStatus();

    event ScenarioCommitted(bytes32 indexed episodeId, address indexed evaluator, bytes32 scenarioCommitment);
    event EpisodeFinalized(
        bytes32 indexed episodeId, bytes32 publicRoot, bytes32 sealedRoot, bytes32 resultCommitment, uint8 status, bool collision
    );

    function commitScenario(bytes32 episodeId, bytes32 scenarioCommitment) external {
        Episode storage e = episodes[episodeId];
        if (e.evaluator != address(0)) revert AlreadyCommitted();
        e.evaluator = msg.sender;
        e.scenarioCommitment = scenarioCommitment;
        e.committedAt = uint64(block.timestamp);
        emit ScenarioCommitted(episodeId, msg.sender, scenarioCommitment);
    }

    function finalizeEpisode(
        bytes32 episodeId,
        bytes32 publicRoot,
        bytes32 sealedRoot,
        bytes32 resultCommitment,
        uint8 status,
        bool collision
    ) external {
        Episode storage e = episodes[episodeId];
        if (e.evaluator == address(0)) revert NotCommitted();
        if (e.evaluator != msg.sender) revert NotEvaluator();
        if (e.finalizedAt != 0) revert AlreadyFinalized();
        if (status != 1 && status != 2) revert BadStatus();
        (e.publicRoot, e.sealedRoot, e.resultCommitment, e.status, e.collision) =
            (publicRoot, sealedRoot, resultCommitment, status, collision);
        e.finalizedAt = uint64(block.timestamp);
        emit EpisodeFinalized(episodeId, publicRoot, sealedRoot, resultCommitment, status, collision);
    }

    function getEpisode(bytes32 episodeId) external view returns (Episode memory) {
        return episodes[episodeId];
    }
}
