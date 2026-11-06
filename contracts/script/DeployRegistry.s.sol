// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {EpisodeRegistry} from "../src/EpisodeRegistry.sol";

/// forge script script/DeployRegistry.s.sol --rpc-url $RPC_URL --broadcast --gas-estimate-multiplier 150 --private-key $PRIVATE_KEY
contract DeployRegistry is Script {
    function run() external returns (address registry) {
        vm.startBroadcast();
        registry = address(new EpisodeRegistry());
        vm.stopBroadcast();
        console2.log("EpisodeRegistry", registry);
        vm.writeJson(vm.toString(registry), string.concat("./deployments/", vm.toString(block.chainid), ".json"), ".episodeRegistry");
    }
}
