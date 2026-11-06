// ABI of contracts/src/EpisodeRegistry.sol; address from contracts/deployments/16602.json (deploy tx in
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
