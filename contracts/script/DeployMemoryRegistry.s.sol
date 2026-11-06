// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {AgentMemoryRegistry, IIdentityOwner} from "../src/AgentMemoryRegistry.sol";

/// forge script script/DeployMemoryRegistry.s.sol --rpc-url $RPC_URL --broadcast --gas-estimate-multiplier 150 --private-key $PRIVATE_KEY
/// Identity = ERC-8004 Identity Registry on Galileo (.claude/skills/sealedai-stack/SKILL.md).
contract DeployMemoryRegistry is Script {
    address constant IDENTITY = 0x8004A818BFB912233c491871b3d84c89A494BD9e;

    function run() external returns (address registry) {
        vm.startBroadcast();
        registry = address(new AgentMemoryRegistry(IIdentityOwner(IDENTITY)));
        vm.stopBroadcast();
        console2.log("AgentMemoryRegistry", registry);
        vm.writeJson(vm.toString(registry), string.concat("./deployments/", vm.toString(block.chainid), ".json"), ".agentMemoryRegistry");
    }
}
