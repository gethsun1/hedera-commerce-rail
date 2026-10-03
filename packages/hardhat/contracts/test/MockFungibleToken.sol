// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev Small ERC-20/HIP-719 test double; not used by production deployments.
contract MockFungibleToken {
    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) private associated;

    error NotAssociated(address account);
    error InsufficientBalance();
    error InsufficientAllowance();

    constructor(uint256 supply) {
        balanceOf[msg.sender] = supply;
        associated[msg.sender] = true;
    }

    function getTokenType(address) external pure returns (int64 responseCode, int32 tokenType) {
        return (22, 0);
    }

    function isAssociated() external view returns (bool) {
        return associated[msg.sender];
    }

    function associate() external returns (uint256) {
        associated[msg.sender] = true;
        return 22;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 approved = allowance[from][msg.sender];
        if (approved < amount) revert InsufficientAllowance();
        allowance[from][msg.sender] = approved - amount;
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) private {
        if (!associated[to]) revert NotAssociated(to);
        if (balanceOf[from] < amount) revert InsufficientBalance();
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}
