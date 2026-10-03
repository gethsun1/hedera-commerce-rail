// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IPaymentEscrowRelease {
    function releasePayment(uint256 paymentId) external;
}

/// @dev Adversarial receiver used to verify that release callbacks cannot settle twice.
contract ReentrantEscrowReceiver {
    IPaymentEscrowRelease public immutable escrow;
    uint256 public paymentId;
    bool public nestedCallSucceeded;

    constructor(address escrowAddress) {
        escrow = IPaymentEscrowRelease(escrowAddress);
    }

    function release(uint256 id) external {
        paymentId = id;
        escrow.releasePayment(id);
    }

    function setPaymentId(uint256 id) external {
        paymentId = id;
    }

    receive() external payable {
        (nestedCallSucceeded, ) = address(escrow).call(
            abi.encodeCall(IPaymentEscrowRelease.releasePayment, (paymentId))
        );
    }
}
