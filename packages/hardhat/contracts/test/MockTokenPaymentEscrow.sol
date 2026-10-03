// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { TokenPaymentEscrow } from "../TokenPaymentEscrow.sol";

/// @dev Uses ERC-20 test doubles for lifecycle unit tests; never use for deployment.
contract MockTokenPaymentEscrow is TokenPaymentEscrow {
    function _validateToken(address token) internal view override {
        if (token == address(0) || token.code.length == 0) revert InvalidToken(token);
        try IERC20TestDouble(token).decimals() returns (uint8) {} catch {
            revert InvalidToken(token);
        }
    }
}

interface IERC20TestDouble {
    function decimals() external view returns (uint8);
}
