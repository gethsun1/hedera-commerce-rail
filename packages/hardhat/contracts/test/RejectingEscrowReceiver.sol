// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev Receiver whose fallback rejects HBAR settlement.
contract RejectingEscrowReceiver {
    receive() external payable {
        revert("reject payment");
    }
}
