// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IHederaTokenService } from "./interfaces/IHederaTokenService.sol";

/// @dev ERC-20 facade exposed by fungible HTS tokens on Hedera.
interface IHtsFungibleToken {
    function decimals() external view returns (uint8);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @dev HIP-719 token facade association entry point.
interface IHtsTokenAssociation {
    function associate() external returns (uint256 responseCode);
    function isAssociated() external view returns (bool associated);
}

/// @title TokenPaymentEscrow
/// @notice Escrows fungible HTS tokens using Hedera's ERC-20-compatible token facade.
/// @dev Token amounts are integer smallest units. Payments are independent of native HBAR PaymentEscrow.
contract TokenPaymentEscrow is ReentrancyGuard {
    address private constant HTS = 0x0000000000000000000000000000000000000167;
    uint256 private constant MAX_HTS_AMOUNT = 9_223_372_036_854_775_807;
    int64 private constant HTS_SUCCESS = 22;

    enum State {
        Created,
        Funded,
        Released,
        Refunded
    }

    struct Payment {
        address payer;
        address payee;
        address arbiter;
        address token;
        uint256 amount;
        uint64 createdAt;
        uint64 deadline;
        State state;
    }

    uint256 public nextPaymentId = 1;
    mapping(address token => uint256 amount) public totalEscrowed;
    mapping(uint256 paymentId => Payment payment) private payments;

    event TokenPaymentCreated(
        uint256 indexed paymentId,
        address indexed token,
        address indexed payer,
        address payee,
        address arbiter,
        uint256 amount,
        uint64 createdAt,
        uint64 deadline
    );
    event TokenPaymentFunded(uint256 indexed paymentId, address indexed token, address indexed payer, uint256 amount);
    event TokenPaymentReleased(
        uint256 indexed paymentId,
        address indexed token,
        address indexed payee,
        address caller,
        uint256 amount
    );
    event TokenPaymentRefunded(
        uint256 indexed paymentId,
        address indexed token,
        address indexed payer,
        address caller,
        uint256 amount
    );
    event EscrowTokenAssociated(address indexed token);

    error InvalidPayment(uint256 paymentId);
    error InvalidAddress();
    error InvalidAmount();
    error InvalidDeadline();
    error InvalidToken(address token);
    error InvalidTokenResponse(address token, uint256 responseCode);
    error DeadlineExpired(uint256 deadline);
    error DeadlineNotReached(uint256 deadline);
    error Unauthorized(address caller);
    error InvalidState(uint256 paymentId, State currentState);
    error IncorrectTokenReceived(uint256 expected, uint256 received);
    error TokenTransferFailed(address token, address recipient, uint256 amount);

    /// @notice Have this escrow contract associate itself with a fungible HTS token (HIP-719).
    /// @dev The token holder and payee still need their own token associations.
    function associateToken(address token) external nonReentrant {
        _validateToken(token);
        if (IHtsTokenAssociation(token).isAssociated()) {
            emit EscrowTokenAssociated(token);
            return;
        }
        uint256 responseCode = IHtsTokenAssociation(token).associate();
        if (responseCode != uint256(uint64(HTS_SUCCESS))) revert InvalidTokenResponse(token, responseCode);
        emit EscrowTokenAssociated(token);
    }

    /// @notice Create a token-backed agreement. Amount uses the token's smallest unit.
    function createPayment(
        address token,
        address payee,
        address arbiter,
        uint256 amount,
        uint64 deadline
    ) external returns (uint256 paymentId) {
        _validateToken(token);
        if (payee == address(0) || payee == msg.sender || payee == address(this)) revert InvalidAddress();
        if (arbiter != address(0) && (arbiter == msg.sender || arbiter == payee || arbiter == address(this))) {
            revert InvalidAddress();
        }
        if (amount == 0 || amount > MAX_HTS_AMOUNT) revert InvalidAmount();
        if (deadline <= block.timestamp) revert InvalidDeadline();

        paymentId = nextPaymentId++;
        payments[paymentId] = Payment({
            payer: msg.sender,
            payee: payee,
            arbiter: arbiter,
            token: token,
            amount: amount,
            createdAt: uint64(block.timestamp),
            deadline: deadline,
            state: State.Created
        });
        emit TokenPaymentCreated(
            paymentId,
            token,
            msg.sender,
            payee,
            arbiter,
            amount,
            uint64(block.timestamp),
            deadline
        );
    }

    /// @notice Fund with the exact agreed token amount; payer must approve this escrow first.
    function fundPayment(uint256 paymentId) external nonReentrant {
        Payment storage payment = _payment(paymentId);
        if (payment.payer != msg.sender) revert Unauthorized(msg.sender);
        if (payment.state != State.Created) revert InvalidState(paymentId, payment.state);
        if (block.timestamp >= payment.deadline) revert DeadlineExpired(payment.deadline);

        uint256 beforeBalance = IHtsFungibleToken(payment.token).balanceOf(address(this));
        _safeTransferFrom(payment.token, msg.sender, address(this), payment.amount);
        uint256 received = IHtsFungibleToken(payment.token).balanceOf(address(this)) - beforeBalance;
        if (received != payment.amount) revert IncorrectTokenReceived(payment.amount, received);

        payment.state = State.Funded;
        totalEscrowed[payment.token] += payment.amount;
        emit TokenPaymentFunded(paymentId, payment.token, msg.sender, payment.amount);
    }

    /// @notice Release funded tokens to the payee. The payer or arbiter may call.
    function releasePayment(uint256 paymentId) external nonReentrant {
        Payment storage payment = _payment(paymentId);
        if (msg.sender != payment.payer && msg.sender != payment.arbiter) revert Unauthorized(msg.sender);
        if (payment.state != State.Funded) revert InvalidState(paymentId, payment.state);

        payment.state = State.Released;
        totalEscrowed[payment.token] -= payment.amount;
        _safeTransfer(payment.token, payment.payee, payment.amount);
        emit TokenPaymentReleased(paymentId, payment.token, payment.payee, msg.sender, payment.amount);
    }

    /// @notice Refund funded tokens after deadline, or immediately by the configured arbiter.
    function refundPayment(uint256 paymentId) external nonReentrant {
        Payment storage payment = _payment(paymentId);
        if (msg.sender != payment.payer && msg.sender != payment.arbiter) revert Unauthorized(msg.sender);
        if (payment.state != State.Funded) revert InvalidState(paymentId, payment.state);
        if (msg.sender != payment.arbiter && block.timestamp <= payment.deadline) {
            revert DeadlineNotReached(payment.deadline);
        }

        payment.state = State.Refunded;
        totalEscrowed[payment.token] -= payment.amount;
        _safeTransfer(payment.token, payment.payer, payment.amount);
        emit TokenPaymentRefunded(paymentId, payment.token, payment.payer, msg.sender, payment.amount);
    }

    function getPayment(uint256 paymentId) external view returns (Payment memory) {
        return _payment(paymentId);
    }

    function _validateToken(address token) internal view virtual {
        if (token == address(0) || token.code.length == 0) revert InvalidToken(token);
        // getTokenType is a system-contract query; it is not part of the token facade.
        try IHederaTokenService(HTS).getTokenType(token) returns (int64 responseCode, int32 tokenType) {
            if (responseCode != HTS_SUCCESS || tokenType != 0) revert InvalidToken(token);
        } catch {
            revert InvalidToken(token);
        }
        try IHtsFungibleToken(token).decimals() returns (uint8) {} catch {
            revert InvalidToken(token);
        }
    }

    function _payment(uint256 paymentId) private view returns (Payment storage payment) {
        payment = payments[paymentId];
        if (payment.payer == address(0)) revert InvalidPayment(paymentId);
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) private {
        try IHtsFungibleToken(token).transferFrom(from, to, amount) returns (bool success) {
            if (!success) revert TokenTransferFailed(token, to, amount);
        } catch {
            revert TokenTransferFailed(token, to, amount);
        }
    }

    function _safeTransfer(address token, address to, uint256 amount) private {
        uint256 beforeBalance = IHtsFungibleToken(token).balanceOf(to);
        try IHtsFungibleToken(token).transfer(to, amount) returns (bool success) {
            if (!success) revert TokenTransferFailed(token, to, amount);
        } catch {
            revert TokenTransferFailed(token, to, amount);
        }
        uint256 received = IHtsFungibleToken(token).balanceOf(to) - beforeBalance;
        if (received != amount) revert IncorrectTokenReceived(amount, received);
    }
}
