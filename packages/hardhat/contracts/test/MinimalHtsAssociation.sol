// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev Minimal HIP-719 call site for isolating contract self-association.
interface IHRC719Association {
    function associate() external returns (uint256 responseCode);
    function isAssociated() external view returns (bool associated);
}

contract MinimalHtsAssociation {
    function associate(address token) external returns (uint256 responseCode) {
        return IHRC719Association(token).associate();
    }

    function isAssociated(address token) external view returns (bool) {
        return IHRC719Association(token).isAssociated();
    }
}
