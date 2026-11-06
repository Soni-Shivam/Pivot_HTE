// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {SealedEscrowSetup} from "../src/SealedEscrowSetup.sol";
import {ERC8183} from "erc8183/ERC8183.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

/// After deployment nobody holds any admin power over escrowed funds (review R15). AccessControl isn't
/// enumerable, so the holder set is reconstructed from RoleGranted / RoleRevoked events.
contract RenounceTest is Test {
    ERC8183 escrow;
    SealedEscrowSetup setup;
    address deployer = makeAddr("deployer");
    bytes32 ADMIN;
    bytes32 DEFAULT_ADMIN;
    mapping(bytes32 => mapping(address => int256)) net;
    address[] seen;

    function setUp() public {
        vm.recordLogs();
        vm.prank(deployer);
        setup = new SealedEscrowSetup(address(0xdEaD));
        escrow = setup.escrow();
        ADMIN = escrow.ADMIN_ROLE();
        DEFAULT_ADMIN = escrow.DEFAULT_ADMIN_ROLE();
    }

    function test_NoAdminAfterDeploy() public {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 granted = keccak256("RoleGranted(bytes32,address,address)");
        bytes32 revoked = keccak256("RoleRevoked(bytes32,address,address)");
        uint256 grants;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter != address(escrow)) continue;
            bytes32 t = logs[i].topics[0];
            if (t != granted && t != revoked) continue;
            bytes32 role = logs[i].topics[1];
            address account = address(uint160(uint256(logs[i].topics[2])));
            net[role][account] += t == granted ? int256(1) : int256(-1);
            if (t == granted) { grants++; seen.push(account); }
        }
        assertEq(grants, 2, "exactly two grants at init (both to the setup contract)");
        for (uint256 i; i < seen.length; i++) {
            assertEq(net[ADMIN][seen[i]], 0);
            assertEq(net[DEFAULT_ADMIN][seen[i]], 0);
            assertFalse(escrow.hasRole(ADMIN, seen[i]));
            assertFalse(escrow.hasRole(DEFAULT_ADMIN, seen[i]));
        }
        assertFalse(escrow.hasRole(DEFAULT_ADMIN, deployer));
        assertFalse(escrow.hasRole(ADMIN, deployer));
    }

    function test_GrantReverts() public {
        vm.prank(deployer);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, deployer, DEFAULT_ADMIN));
        escrow.grantRole(ADMIN, deployer);
        vm.prank(address(setup));
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, address(setup), DEFAULT_ADMIN));
        escrow.grantRole(ADMIN, address(setup));
    }

    function test_PauseReverts() public {
        vm.prank(address(setup));
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, address(setup), ADMIN));
        escrow.pause();
    }

    function test_EmergencyWithdrawReverts() public {
        address tok = address(setup.token()); // read first: an external call would consume the prank
        vm.prank(deployer);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, deployer, ADMIN));
        escrow.emergencyWithdraw(tok, deployer, 1);
    }

    function test_FeeChangeReverts() public {
        vm.prank(deployer);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, deployer, ADMIN));
        escrow.setEvaluatorFee(100);
    }

    function test_UpgradeReverts() public {
        address newImpl = address(new ERC8183());
        vm.prank(address(setup));
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, address(setup), DEFAULT_ADMIN));
        escrow.upgradeToAndCall(newImpl, "");
    }

    function test_NotPaused() public view {
        assertFalse(escrow.paused());
    }

    function test_TokenAllowedAndFeesZero() public view {
        assertTrue(escrow.allowedPaymentTokens(address(setup.token())));
        assertEq(escrow.platformFeeBP(), 0);
        assertEq(escrow.evaluatorFeeBP(), 0);
    }
}
