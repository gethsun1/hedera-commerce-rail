// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title PaymentEscrow
/// @notice Holds native HBAR for one payer/payee agreement until release or refund.
/// @dev Amounts use the Hedera EVM denomination exposed to Solidity (tinybars).
contract PaymentEscrow is ReentrancyGuard {
    /// @notice Lifecycle state; Released and Refunded are terminal.
    enum State {
        Created,
        Funded,
        Released,
        Refunded
    }

    /// @notice Full state for an agreement. `asset` is address(0) for native HBAR.
    struct Payment {
        address payer;
        address payee;
        address arbiter;
        uint256 amount;
        address asset;
        uint64 createdAt;
        uint64 deadline;
        State state;
    }

    /// @notice Identifier to assign to the next created payment.
    uint256 public nextPaymentId = 1;
    /// @notice Sum of amounts held for payments currently in Funded state.
    uint256 public totalEscrowed;
    /// @dev Private mapping with reads exposed through `getPayment`.
    mapping(uint256 paymentId => Payment payment) private payments;

    /// @notice Emitted after an agreement is created, before any funds are deposited.
    event PaymentCreated(
        uint256 indexed paymentId,
        address indexed payer,
        address indexed payee,
        address arbiter,
        uint256 amount,
        address asset,
        uint64 createdAt,
        uint64 deadline
    );
    /// @notice Emitted when the payer funds an agreement with its exact amount.
    event PaymentFunded(uint256 indexed paymentId, address indexed payer, uint256 amount, address asset);
    /// @notice Emitted after escrowed HBAR is successfully transferred to the payee.
    event PaymentReleased(
        uint256 indexed paymentId,
        address indexed caller,
        address indexed payee,
        uint256 amount,
        address asset
    );
    /// @notice Emitted after escrowed HBAR is successfully returned to the payer.
    event PaymentRefunded(
        uint256 indexed paymentId,
        address indexed caller,
        address indexed payer,
        uint256 amount,
        address asset
    );

    error InvalidPayment(uint256 paymentId);
    error InvalidAddress();
    error InvalidAmount();
    error InvalidDeadline();
    error DeadlineExpired(uint256 deadline);
    error Unauthorized(address caller);
    error InvalidState(uint256 paymentId, State currentState);
    error IncorrectFunding(uint256 expected, uint256 received);
    error DeadlineNotReached(uint256 deadline);
    error TransferFailed(address recipient, uint256 amount);
    error DirectFundingDisabled();

    /// @notice Prevent HBAR from being deposited without payment accounting.
    receive() external payable {
        revert DirectFundingDisabled();
    }

    /// @notice Create an unfunded native HBAR escrow agreement.
    /// @param payee Account that receives funds when released.
    /// @param arbiter Optional dispute resolver; zero address disables arbitration.
    /// @param amount Exact amount to fund, denominated in Hedera EVM tinybars.
    /// @param deadline Unix timestamp after which the payer may refund.
    /// @return paymentId Monotonically increasing identifier for this agreement.
    function createPayment(
        address payee,
        address arbiter,
        uint256 amount,
        uint64 deadline
    ) external returns (uint256 paymentId) {
        if (payee == address(0) || payee == msg.sender) revert InvalidAddress();
        if (arbiter != address(0) && (arbiter == msg.sender || arbiter == payee)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();
        if (deadline <= block.timestamp) revert InvalidDeadline();

        paymentId = nextPaymentId++;
        payments[paymentId] = Payment({
            payer: msg.sender,
            payee: payee,
            arbiter: arbiter,
            amount: amount,
            asset: address(0),
            createdAt: uint64(block.timestamp),
            deadline: deadline,
            state: State.Created
        });
        emit PaymentCreated(
            paymentId,
            msg.sender,
            payee,
            arbiter,
            amount,
            address(0),
            uint64(block.timestamp),
            deadline
        );
    }

    /// @notice Fund a created agreement with exactly its agreed amount.
    /// @dev Hedera EVM `msg.value` is measured in tinybars. Ethers transactions encode
    ///      this value using weibars; see the deployment docs for the conversion.
    function fundPayment(uint256 paymentId) external payable {
        Payment storage payment = _payment(paymentId);
        if (payment.payer != msg.sender) revert Unauthorized(msg.sender);
        if (payment.state != State.Created) revert InvalidState(paymentId, payment.state);
        if (block.timestamp >= payment.deadline) revert DeadlineExpired(payment.deadline);
        if (msg.value == 0 || msg.value != payment.amount) revert IncorrectFunding(payment.amount, msg.value);

        payment.state = State.Funded;
        totalEscrowed += msg.value;
        emit PaymentFunded(paymentId, msg.sender, msg.value, payment.asset);
    }

    /// @notice Release funded HBAR to the payee. The payer or configured arbiter may call.
    function releasePayment(uint256 paymentId) external nonReentrant {
        Payment storage payment = _payment(paymentId);
        if (msg.sender != payment.payer && msg.sender != payment.arbiter) revert Unauthorized(msg.sender);
        if (payment.state != State.Funded) revert InvalidState(paymentId, payment.state);

        payment.state = State.Released;
        totalEscrowed -= payment.amount;
        _send(payment.payee, payment.amount);
        emit PaymentReleased(paymentId, msg.sender, payment.payee, payment.amount, payment.asset);
    }

    /// @notice Refund funded HBAR to the payer after the deadline, or immediately by the arbiter.
    function refundPayment(uint256 paymentId) external nonReentrant {
        Payment storage payment = _payment(paymentId);
        if (msg.sender != payment.payer && msg.sender != payment.arbiter) revert Unauthorized(msg.sender);
        if (payment.state != State.Funded) revert InvalidState(paymentId, payment.state);
        if (msg.sender != payment.arbiter && block.timestamp <= payment.deadline) {
            revert DeadlineNotReached(payment.deadline);
        }

        payment.state = State.Refunded;
        totalEscrowed -= payment.amount;
        _send(payment.payer, payment.amount);
        emit PaymentRefunded(paymentId, msg.sender, payment.payer, payment.amount, payment.asset);
    }

    /// @notice Return agreement and settlement details.
    function getPayment(uint256 paymentId) external view returns (Payment memory) {
        return _payment(paymentId);
    }

    function _payment(uint256 paymentId) private view returns (Payment storage payment) {
        payment = payments[paymentId];
        if (payment.payer == address(0)) revert InvalidPayment(paymentId);
    }

    function _send(address recipient, uint256 amount) private {
        (bool success, ) = payable(recipient).call{ value: amount }("");
        if (!success) revert TransferFailed(recipient, amount);
    }
}
