// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {EpisodeRegistryV2} from "../src/EpisodeRegistryV2.sol";

/// forge script script/DeployRegistryV2.s.sol --rpc-url $RPC_URL --broadcast --gas-estimate-multiplier 150 --private-key $PRIVATE_KEY
contract DeployRegistryV2 is Script {
    function run() external returns (address registry) {
        vm.startBroadcast();
        registry = address(new EpisodeRegistryV2());
        vm.stopBroadcast();
        console2.log("EpisodeRegistryV2", registry);
        vm.writeJson(vm.toString(registry), string.concat("./deployments/", vm.toString(block.chainid), ".json"), ".episodeRegistryV2");
    }
}
