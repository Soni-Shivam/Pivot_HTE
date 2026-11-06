// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {SealedEscrowSetup} from "../src/SealedEscrowSetup.sol";
import {ERC8183} from "erc8183/ERC8183.sol";
import {MockUSDC} from "erc8183/mocks/MockUSDC.sol";

/// Our payment design on the unchanged ERC-8183 reference (PLAN §6, ARCHITECTURE §9):
/// client = buyer, provider = sealed worker (sends its own txs), evaluator = seller, payoutReceiver = seller.
contract SealedFlowTest is Test {
    ERC8183 escrow;
    MockUSDC token;
    address worker = makeAddr("worker");
    address buyer = makeAddr("buyer");
    address seller = makeAddr("seller");
    address outsider = makeAddr("outsider");
    uint256 constant PRICE = 25e6; // 25 test USDC
    uint48 expiredAt;
    string constant DESC = "sealedai:v1:0x5eed000000000000000000000000000000000000000000000000000000000001";

    function setUp() public {
        vm.warp(1_800_000_000);
        SealedEscrowSetup s = new SealedEscrowSetup(address(0xdEaD));
        escrow = s.escrow();
        token = s.token();
        token.mint(buyer, 1_000e6);
        expiredAt = uint48(block.timestamp + 2 hours);
    }

    function _open() internal returns (uint256 jobId) {
        vm.prank(buyer);
        jobId = escrow.createJob(worker, seller, expiredAt, DESC, address(0), 0);
    }

    function _quote(uint256 jobId) internal {
        vm.startPrank(worker);
        escrow.setPayoutReceiver(jobId, seller);
        escrow.setBudget(jobId, address(token), PRICE, "");
        vm.stopPrank();
    }

    function _fund(uint256 jobId) internal {
        vm.startPrank(buyer);
        token.approve(address(escrow), PRICE);
        escrow.fund(jobId, address(token), PRICE, "");
        vm.stopPrank();
    }

    function _funded() internal returns (uint256 jobId) {
        jobId = _open();
        _quote(jobId);
        _fund(jobId);
    }

    function _submitted() internal returns (uint256 jobId) {
        jobId = _funded();
        vm.prank(worker);
        escrow.submit(jobId, keccak256("receipt-commitment"), "");
    }

    function test_BuyerSetBudgetReverts() public {
        uint256 jobId = _open();
        vm.prank(buyer);
        vm.expectRevert(ERC8183.Unauthorized.selector);
        escrow.setBudget(jobId, address(token), PRICE, "");
    }

    function test_OnlyWorkerActsAsProvider() public {
        uint256 jobId = _open();
        address[3] memory others = [buyer, seller, outsider];
        for (uint256 i; i < 3; i++) {
            vm.startPrank(others[i]);
            vm.expectRevert(ERC8183.Unauthorized.selector);
            escrow.setBudget(jobId, address(token), 1, "");
            vm.expectRevert(ERC8183.Unauthorized.selector);
            escrow.setPayoutReceiver(jobId, others[i]);
            vm.stopPrank();
        }
    }

    function test_WorkerSetsBudgetAndPayout() public {
        uint256 jobId = _open();
        _quote(jobId);
        ERC8183.Job memory j = escrow.getJob(jobId);
        assertEq(j.budget, PRICE);
        assertEq(j.paymentToken, address(token));
        assertEq(j.payoutReceiver, seller);
        assertEq(j.provider, worker);
        assertEq(j.evaluator, seller);
        assertEq(j.client, buyer);
    }

    function test_PayoutLockedAfterFunding() public {
        uint256 jobId = _funded();
        vm.prank(worker);
        vm.expectRevert(ERC8183.WrongStatus.selector);
        escrow.setPayoutReceiver(jobId, worker);
    }

    function test_FundWrongTokenOrBudgetReverts() public {
        uint256 jobId = _open();
        _quote(jobId);
        vm.startPrank(buyer);
        token.approve(address(escrow), PRICE * 2);
        vm.expectRevert(ERC8183.PaymentTokenMismatch.selector);
        escrow.fund(jobId, address(0xBEEF), PRICE, "");
        vm.expectRevert(ERC8183.BudgetMismatch.selector);
        escrow.fund(jobId, address(token), PRICE - 1, "");
        vm.stopPrank();
    }

    function test_ProviderCannotBeEvaluatorOrClient() public {
        vm.startPrank(buyer);
        vm.expectRevert(ERC8183.ProviderCannotBeEvaluator.selector);
        escrow.createJob(worker, worker, expiredAt, DESC, address(0), 0);
        vm.expectRevert(ERC8183.ClientCannotBeProvider.selector);
        escrow.createJob(buyer, seller, expiredAt, DESC, address(0), 0);
        vm.stopPrank();
    }

    function test_HappyPathPaysSeller() public {
        uint256 buyer0 = token.balanceOf(buyer);
        uint256 jobId = _submitted();
        assertEq(token.balanceOf(address(escrow)), PRICE);
        vm.prank(seller);
        escrow.complete(jobId, bytes32("accepted"), "");
        assertEq(token.balanceOf(seller), PRICE);
        assertEq(token.balanceOf(buyer), buyer0 - PRICE);
        assertEq(token.balanceOf(address(escrow)), 0);
        assertEq(token.balanceOf(worker), 0);
        assertEq(uint8(escrow.getJob(jobId).status), uint8(ERC8183.JobStatus.Completed));
    }

    function test_SellerCannotCompleteBeforeSubmit() public {
        uint256 jobId = _funded();
        vm.prank(seller);
        vm.expectRevert(ERC8183.WrongStatus.selector);
        escrow.complete(jobId, bytes32(0), "");
    }

    function test_BuyerCannotCompleteOrReject() public {
        uint256 jobId = _submitted();
        vm.startPrank(buyer);
        vm.expectRevert(ERC8183.Unauthorized.selector);
        escrow.complete(jobId, bytes32(0), "");
        vm.expectRevert(ERC8183.Unauthorized.selector);
        escrow.reject(jobId, bytes32(0), "");
        vm.stopPrank();
    }

    function test_SellerCannotSubmit() public {
        uint256 jobId = _funded();
        vm.prank(seller);
        vm.expectRevert(ERC8183.Unauthorized.selector);
        escrow.submit(jobId, keccak256("x"), "");
    }

    function test_FundedExpiryRefundByOutsider() public {
        uint256 jobId = _funded();
        uint256 buyer0 = token.balanceOf(buyer);
        vm.prank(outsider);
        vm.expectRevert(ERC8183.WrongStatus.selector);
        escrow.claimRefund(jobId);
        vm.warp(expiredAt);
        vm.prank(outsider);
        escrow.claimRefund(jobId);
        assertEq(token.balanceOf(buyer), buyer0 + PRICE);
        assertEq(token.balanceOf(outsider), 0);
        assertEq(uint8(escrow.getJob(jobId).status), uint8(ERC8183.JobStatus.Expired));
    }

    function test_SubmittedGraceBoundary() public {
        uint256 jobId = _submitted();
        uint256 buyer0 = token.balanceOf(buyer);
        vm.warp(uint256(expiredAt) + 1 hours - 1);
        vm.prank(outsider);
        vm.expectRevert(ERC8183.GracePeriodActive.selector);
        escrow.claimRefund(jobId);
        vm.warp(uint256(expiredAt) + 1 hours);
        vm.prank(outsider);
        escrow.claimRefund(jobId);
        assertEq(token.balanceOf(buyer), buyer0 + PRICE);
    }

    function test_SellerRejectFundedRefunds() public {
        uint256 jobId = _funded();
        uint256 buyer0 = token.balanceOf(buyer);
        vm.prank(seller);
        escrow.reject(jobId, bytes32("declined"), "");
        assertEq(token.balanceOf(buyer), buyer0 + PRICE);
    }

    function test_SellerRejectSubmittedRefunds() public {
        uint256 jobId = _submitted();
        uint256 buyer0 = token.balanceOf(buyer);
        vm.prank(seller);
        escrow.reject(jobId, bytes32("declined"), "");
        assertEq(token.balanceOf(buyer), buyer0 + PRICE);
        assertEq(token.balanceOf(seller), 0);
    }

    function test_NoSubmitAfterExpiry() public {
        uint256 jobId = _funded();
        vm.warp(expiredAt);
        vm.prank(worker);
        vm.expectRevert(ERC8183.WrongStatus.selector);
        escrow.submit(jobId, keccak256("late"), "");
    }

    function test_DoubleRefundImpossible() public {
        uint256 jobId = _funded();
        vm.warp(expiredAt);
        escrow.claimRefund(jobId);
        vm.expectRevert(ERC8183.WrongStatus.selector);
        escrow.claimRefund(jobId);
    }
}
