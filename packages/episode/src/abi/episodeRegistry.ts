// ABI of contracts/src/EpisodeRegistry.sol (v1, read-only now: demo-002 / cutin-001); address from contracts/deployments/16602.json (deploy tx in
// docs/evidence/faultline-registry-deploy.log).
import { parseAbi } from 'viem'

export const EPISODE_REGISTRY = '0x23edb2e37F9a2a2b1DAaF0514b58E278f2FFF46A' as const
export const episodeRegistryAbi = parseAbi([
  'struct Episode { address evaluator; bytes32 scenarioCommitment; bytes32 publicRoot; bytes32 sealedRoot; bytes32 resultCommitment; uint8 status; bool collision; uint64 committedAt; uint64 finalizedAt; }',
  'function commitScenario(bytes32 episodeId, bytes32 scenarioCommitment)',
  'function finalizeEpisode(bytes32 episodeId, bytes32 publicRoot, bytes32 sealedRoot, bytes32 resultCommitment, uint8 status, bool collision)',
  'function getEpisode(bytes32 episodeId) view returns (Episode)',
  'event ScenarioCommitted(bytes32 indexed episodeId, address indexed evaluator, bytes32 scenarioCommitment)',
  'event EpisodeFinalized(bytes32 indexed episodeId, bytes32 publicRoot, bytes32 sealedRoot, bytes32 resultCommitment, uint8 status, bool collision)',
])

// ABI of contracts/src/EpisodeRegistryV2.sol (episodes keyed by evaluator, per-evaluator stats, configHash, commitBlock);
// address from contracts/deployments/16602.json `episodeRegistryV2` (docs/evidence/faultline-registry-v2-deploy.log).
export const EPISODE_REGISTRY_V2 = '0xeE2260cE4835059F0e0f1FB9C9948Ca5a7d4b5A4' as const
export const episodeRegistryV2Abi = parseAbi([
  'struct Episode { bytes32 scenarioCommitment; bytes32 configHash; bytes32 publicRoot; bytes32 sealedRoot; bytes32 resultCommitment; uint64 seq; uint64 commitBlock; uint64 committedAt; uint64 finalizedAt; uint8 status; bool collision; }',
  'struct Stats { uint64 committed; uint64 completed; uint64 interrupted; uint64 aborted; }',
  'function commitScenario(bytes32 episodeId, bytes32 scenarioCommitment, bytes32 configHash) returns (uint64 seq)',
  'function finalizeEpisode(bytes32 episodeId, bytes32 publicRoot, bytes32 sealedRoot, bytes32 resultCommitment, uint8 status, bool collision)',
  'function getEpisode(address evaluator, bytes32 episodeId) view returns (Episode)',
  'function stats(address evaluator) view returns (Stats)',
  'function episodeBySeq(address evaluator, uint64 seq) view returns (bytes32)',
  'event ScenarioCommitted(address indexed evaluator, bytes32 indexed episodeId, uint64 indexed seq, bytes32 scenarioCommitment, bytes32 configHash)',
  'event EpisodeFinalized(address indexed evaluator, bytes32 indexed episodeId, uint64 indexed seq, bytes32 publicRoot, bytes32 sealedRoot, bytes32 resultCommitment, uint8 status, bool collision)',
])
