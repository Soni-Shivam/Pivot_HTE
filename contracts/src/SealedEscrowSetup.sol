// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ERC8183} from "erc8183/ERC8183.sol";
import {MockUSDC} from "erc8183/mocks/MockUSDC.sol";

/// @notice One-transaction deployment of the unchanged ERC-8183 reference escrow (PLAN §6, review R15):
///         the proxy is initialized in its constructor (atomic), the test token is allowed, fees stay 0,
///         and this contract then renounces both admin roles, so no account ever holds pause, emergencyWithdraw,
///         fee, hook-whitelist or upgrade authority. The contract keeps no state and has no functions.
///         We deploy the base ERC8183, not ERC8183WithAuthorization: the latter's runtime is 27,574 bytes, over the
///         EIP-170 24,576-byte limit 0G Galileo enforces, so the worker sends its own provider transactions.
contract SealedEscrowSetup {
    ERC8183 public immutable escrow;
    MockUSDC public immutable token;

    constructor(address treasury) {
        ERC8183 impl = new ERC8183();
        escrow = ERC8183(address(new ERC1967Proxy(address(impl), abi.encodeCall(ERC8183.initialize, (treasury, address(this))))));
        token = new MockUSDC();
        escrow.setPaymentTokenAllowed(address(token), true);
        escrow.renounceRole(escrow.ADMIN_ROLE(), address(this));
        escrow.renounceRole(escrow.DEFAULT_ADMIN_ROLE(), address(this));
    }
}
