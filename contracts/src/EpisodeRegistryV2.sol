// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title EpisodeRegistryV2: commit-before / finalize-after with per-evaluator accounting (Faultline audit C2).
/// Changes from v1:
/// - Episodes are keyed by (evaluator, episodeId), so nobody can front-run or grief another evaluator's id.
/// - Every commit gets a per-evaluator sequence number; `stats` shows how many runs an evaluator started and how many it
///   finalized, so a rerun-until-good evaluator is visible: any unfinalized or aborted sequence number is public.
/// - `configHash` (public, unsalted: prompt hash, model, code commit, scenario family) fixes the protocol before the run.
/// - `commitBlock` is stored so a verifier can read blockhash(commitBlock): an unpredictable nonce that the evaluator
///   puts into every 0G prompt, proving each signed request was made after the commit (audit A3, C1).
/// - Status 3 = aborted (crash before publish), so honest accounting does not need fake roots.
/// No payments, roles or upgradeability.
contract EpisodeRegistryV2 {
    struct Episode {
        bytes32 scenarioCommitment; // keccak256(salt, sha256(scenario.json))
        bytes32 configHash;
        bytes32 publicRoot;
        bytes32 sealedRoot;
        bytes32 resultCommitment;
        uint64 seq; // 1-based, per evaluator
        uint64 commitBlock;
        uint64 committedAt;
        uint64 finalizedAt;
        uint8 status; // 0 open, 1 completed, 2 interrupted (safe halt), 3 aborted
        bool collision;
    }

    struct Stats {
        uint64 committed;
        uint64 completed;
        uint64 interrupted;
        uint64 aborted;
    }

    mapping(address => mapping(bytes32 => Episode)) private episodes;
    mapping(address => mapping(uint64 => bytes32)) public episodeBySeq;
    mapping(address => Stats) private stats_;

    error AlreadyCommitted();
    error NotCommitted();
    error AlreadyFinalized();
    error BadStatus();
    error ZeroCommitment();

    event ScenarioCommitted(
        address indexed evaluator, bytes32 indexed episodeId, uint64 indexed seq, bytes32 scenarioCommitment, bytes32 configHash
    );
    event EpisodeFinalized(
        address indexed evaluator,
        bytes32 indexed episodeId,
        uint64 indexed seq,
        bytes32 publicRoot,
        bytes32 sealedRoot,
        bytes32 resultCommitment,
        uint8 status,
        bool collision
    );

    function commitScenario(bytes32 episodeId, bytes32 scenarioCommitment, bytes32 configHash) external returns (uint64 seq) {
        if (scenarioCommitment == bytes32(0) || configHash == bytes32(0)) revert ZeroCommitment();
        Episode storage e = episodes[msg.sender][episodeId];
        if (e.seq != 0) revert AlreadyCommitted();
        seq = ++stats_[msg.sender].committed;
        e.seq = seq;
        e.scenarioCommitment = scenarioCommitment;
        e.configHash = configHash;
        e.commitBlock = uint64(block.number);
        e.committedAt = uint64(block.timestamp);
        episodeBySeq[msg.sender][seq] = episodeId;
        emit ScenarioCommitted(msg.sender, episodeId, seq, scenarioCommitment, configHash);
    }

    function finalizeEpisode(
        bytes32 episodeId,
        bytes32 publicRoot,
        bytes32 sealedRoot,
        bytes32 resultCommitment,
        uint8 status,
        bool collision
    ) external {
        Episode storage e = episodes[msg.sender][episodeId];
        if (e.seq == 0) revert NotCommitted();
        if (e.status != 0) revert AlreadyFinalized();
        Stats storage s = stats_[msg.sender];
        if (status == 1) s.completed++;
        else if (status == 2) s.interrupted++;
        else if (status == 3) s.aborted++;
        else revert BadStatus();
        (e.publicRoot, e.sealedRoot, e.resultCommitment, e.status, e.collision) =
            (publicRoot, sealedRoot, resultCommitment, status, collision);
        e.finalizedAt = uint64(block.timestamp);
        emit EpisodeFinalized(msg.sender, episodeId, e.seq, publicRoot, sealedRoot, resultCommitment, status, collision);
    }

    function getEpisode(address evaluator, bytes32 episodeId) external view returns (Episode memory) {
        return episodes[evaluator][episodeId];
    }

    function stats(address evaluator) external view returns (Stats memory) {
        return stats_[evaluator];
    }
}
