// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {SealedEscrowSetup} from "../src/SealedEscrowSetup.sol";

/// forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast --private-key $PRIVATE_KEY
contract Deploy is Script {
    address constant TREASURY = 0x000000000000000000000000000000000000dEaD; // fees are 0 and can never be changed

    function run() external returns (address escrow, address token, address setup) {
        vm.startBroadcast();
        SealedEscrowSetup s = new SealedEscrowSetup(TREASURY);
        vm.stopBroadcast();
        (escrow, token, setup) = (address(s.escrow()), address(s.token()), address(s));
        console2.log("escrow proxy", escrow);
        console2.log("MockUSDC", token);
        console2.log("setup", setup);
        vm.writeJson(
            string.concat('{"escrow":"', vm.toString(escrow), '","token":"', vm.toString(token), '","setup":"', vm.toString(setup), '","chainId":', vm.toString(block.chainid), "}"),
            string.concat("./deployments/", vm.toString(block.chainid), ".json")
        );
    }
}
