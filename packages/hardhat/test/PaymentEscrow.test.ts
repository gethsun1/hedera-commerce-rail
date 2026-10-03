import { expect } from "chai";
import { ethers, network } from "hardhat";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";

describe("PaymentEscrow", function () {
  const AMOUNT = 100_000_000n;

  async function fixture() {
    const [payer, payee, arbiter, other] = await ethers.getSigners();
    const Escrow = await ethers.getContractFactory("PaymentEscrow");
    const escrow = await Escrow.deploy();
    await escrow.waitForDeployment();
    const block = await ethers.provider.getBlock("latest");
    const deadline = BigInt(block!.timestamp + 3600);
    await escrow.connect(payer).createPayment(payee.address, arbiter.address, AMOUNT, deadline);
    return { escrow, payer, payee, arbiter, other, deadline };
  }

  async function fund(
    escrow: Awaited<ReturnType<typeof fixture>>["escrow"],
    payer: Awaited<ReturnType<typeof fixture>>["payer"],
  ) {
    await escrow.connect(payer).fundPayment(1, { value: AMOUNT });
  }

  describe("creation", function () {
    it("creates an agreement with a stable ID, native asset, and indexed event data", async function () {
      const [payer, payee] = await ethers.getSigners();
      const escrow = await (await ethers.getContractFactory("PaymentEscrow")).deploy();
      await escrow.waitForDeployment();
      const latest = await ethers.provider.getBlock("latest");
      const deadline = BigInt(latest!.timestamp + 60);
      await expect(escrow.createPayment(payee.address, ethers.ZeroAddress, AMOUNT, deadline))
        .to.emit(escrow, "PaymentCreated")
        .withArgs(1, payer.address, payee.address, ethers.ZeroAddress, AMOUNT, ethers.ZeroAddress, anyValue, deadline);
      const payment = await escrow.getPayment(1);
      expect(payment.payer).to.equal(payer.address);
      expect(payment.state).to.equal(0);
      expect(payment.asset).to.equal(ethers.ZeroAddress);
    });

    it("rejects zero amount, invalid addresses, invalid deadline, and unknown IDs", async function () {
      const [payer, payee] = await ethers.getSigners();
      const escrow = await (await ethers.getContractFactory("PaymentEscrow")).deploy();
      await escrow.waitForDeployment();
      const latest = await ethers.provider.getBlock("latest");
      const deadline = BigInt(latest!.timestamp + 60);
      await expect(escrow.createPayment(payee.address, ethers.ZeroAddress, 0, deadline)).to.be.revertedWithCustomError(
        escrow,
        "InvalidAmount",
      );
      await expect(
        escrow.createPayment(ethers.ZeroAddress, ethers.ZeroAddress, AMOUNT, deadline),
      ).to.be.revertedWithCustomError(escrow, "InvalidAddress");
      await expect(
        escrow.createPayment(payer.address, ethers.ZeroAddress, AMOUNT, deadline),
      ).to.be.revertedWithCustomError(escrow, "InvalidAddress");
      await expect(escrow.createPayment(payee.address, payee.address, AMOUNT, deadline)).to.be.revertedWithCustomError(
        escrow,
        "InvalidAddress",
      );
      await expect(
        escrow.createPayment(payee.address, ethers.ZeroAddress, AMOUNT, BigInt(latest!.timestamp)),
      ).to.be.revertedWithCustomError(escrow, "InvalidDeadline");
      await expect(escrow.getPayment(1)).to.be.revertedWithCustomError(escrow, "InvalidPayment");
    });
  });

  describe("funding", function () {
    it("accepts only the payer and the exact agreed amount", async function () {
      const { escrow, payer, other } = await fixture();
      await expect(escrow.connect(other).fundPayment(1, { value: AMOUNT })).to.be.revertedWithCustomError(
        escrow,
        "Unauthorized",
      );
      await expect(escrow.connect(payer).fundPayment(1, { value: AMOUNT - 1n })).to.be.revertedWithCustomError(
        escrow,
        "IncorrectFunding",
      );
      await expect(escrow.connect(payer).fundPayment(1, { value: AMOUNT + 1n })).to.be.revertedWithCustomError(
        escrow,
        "IncorrectFunding",
      );
      await expect(escrow.connect(payer).fundPayment(1, { value: AMOUNT }))
        .to.emit(escrow, "PaymentFunded")
        .withArgs(1, payer.address, AMOUNT, ethers.ZeroAddress);
      expect((await escrow.getPayment(1)).state).to.equal(1);
      expect(await escrow.totalEscrowed()).to.equal(AMOUNT);
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(AMOUNT);
      await expect(escrow.connect(payer).fundPayment(1, { value: AMOUNT })).to.be.revertedWithCustomError(
        escrow,
        "InvalidState",
      );
      await expect(escrow.connect(payer).fundPayment(999, { value: AMOUNT })).to.be.revertedWithCustomError(
        escrow,
        "InvalidPayment",
      );
    });

    it("rejects unaccounted direct HBAR", async function () {
      const { escrow, payer } = await fixture();
      await expect(payer.sendTransaction({ to: await escrow.getAddress(), value: 1 })).to.be.revertedWithCustomError(
        escrow,
        "DirectFundingDisabled",
      );
    });

    it("does not accept funding at or after the deadline", async function () {
      const { escrow, payer, deadline } = await fixture();
      await network.provider.send("evm_setNextBlockTimestamp", [Number(deadline)]);
      await expect(escrow.connect(payer).fundPayment(1, { value: AMOUNT })).to.be.revertedWithCustomError(
        escrow,
        "DeadlineExpired",
      );
    });
  });

  describe("release", function () {
    it("releases once to payee and updates accounting before completion", async function () {
      const { escrow, payer, payee, arbiter, other } = await fixture();
      await fund(escrow, payer);
      const before = await ethers.provider.getBalance(payee.address);
      await expect(escrow.connect(other).releasePayment(1)).to.be.revertedWithCustomError(escrow, "Unauthorized");
      await expect(escrow.connect(arbiter).releasePayment(1))
        .to.emit(escrow, "PaymentReleased")
        .withArgs(1, arbiter.address, payee.address, AMOUNT, ethers.ZeroAddress);
      expect(await ethers.provider.getBalance(payee.address)).to.equal(before + AMOUNT);
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(0);
      expect(await escrow.totalEscrowed()).to.equal(0);
      expect((await escrow.getPayment(1)).state).to.equal(2);
      await expect(escrow.connect(payer).releasePayment(1)).to.be.revertedWithCustomError(escrow, "InvalidState");
      await expect(escrow.connect(payer).refundPayment(1)).to.be.revertedWithCustomError(escrow, "InvalidState");
      await expect(escrow.connect(payer).fundPayment(1, { value: AMOUNT })).to.be.revertedWithCustomError(
        escrow,
        "InvalidState",
      );
    });

    it("blocks callback reentrancy and does not release twice", async function () {
      const [payer] = await ethers.getSigners();
      const escrow = await (await ethers.getContractFactory("PaymentEscrow")).deploy();
      await escrow.waitForDeployment();
      const Receiver = await ethers.getContractFactory("ReentrantEscrowReceiver");
      const receiver = await Receiver.deploy(await escrow.getAddress());
      await receiver.waitForDeployment();
      const block = await ethers.provider.getBlock("latest");
      await escrow.createPayment(
        await receiver.getAddress(),
        ethers.ZeroAddress,
        AMOUNT,
        BigInt(block!.timestamp + 60),
      );
      await escrow.connect(payer).fundPayment(1, { value: AMOUNT });
      await receiver.setPaymentId(1);
      await expect(escrow.connect(payer).releasePayment(1)).to.emit(escrow, "PaymentReleased");
      expect(await receiver.nestedCallSucceeded()).to.equal(false);
      expect((await escrow.getPayment(1)).state).to.equal(2);
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(0);
    });

    it("keeps state and accounting funded if the payee rejects HBAR", async function () {
      const [payer] = await ethers.getSigners();
      const escrow = await (await ethers.getContractFactory("PaymentEscrow")).deploy();
      await escrow.waitForDeployment();
      const rejectingReceiver = await (await ethers.getContractFactory("RejectingEscrowReceiver")).deploy();
      await rejectingReceiver.waitForDeployment();
      const block = await ethers.provider.getBlock("latest");
      await escrow.createPayment(
        await rejectingReceiver.getAddress(),
        ethers.ZeroAddress,
        AMOUNT,
        BigInt(block!.timestamp + 60),
      );
      await escrow.connect(payer).fundPayment(1, { value: AMOUNT });
      await expect(escrow.connect(payer).releasePayment(1)).to.be.revertedWithCustomError(escrow, "TransferFailed");
      expect((await escrow.getPayment(1)).state).to.equal(1);
      expect(await escrow.totalEscrowed()).to.equal(AMOUNT);
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(AMOUNT);
    });
  });

  describe("refund", function () {
    it("allows payer refund only strictly after the deadline", async function () {
      const { escrow, payer, other, deadline } = await fixture();
      await fund(escrow, payer);
      await expect(escrow.connect(other).refundPayment(1)).to.be.revertedWithCustomError(escrow, "Unauthorized");
      await network.provider.send("evm_setNextBlockTimestamp", [Number(deadline)]);
      await expect(escrow.connect(payer).refundPayment(1)).to.be.revertedWithCustomError(escrow, "DeadlineNotReached");
      await network.provider.send("evm_setNextBlockTimestamp", [Number(deadline) + 1]);
      const before = await ethers.provider.getBalance(payer.address);
      const tx = await escrow.connect(payer).refundPayment(1);
      await expect(tx)
        .to.emit(escrow, "PaymentRefunded")
        .withArgs(1, payer.address, payer.address, AMOUNT, ethers.ZeroAddress);
      const receipt = await tx.wait();
      const after = await ethers.provider.getBalance(payer.address);
      expect(after).to.equal(before + AMOUNT - receipt!.fee);
      expect((await escrow.getPayment(1)).state).to.equal(3);
      expect(await escrow.totalEscrowed()).to.equal(0);
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(0);
      await expect(escrow.connect(payer).refundPayment(1)).to.be.revertedWithCustomError(escrow, "InvalidState");
      await expect(escrow.connect(payer).releasePayment(1)).to.be.revertedWithCustomError(escrow, "InvalidState");
      await expect(escrow.connect(payer).fundPayment(1, { value: AMOUNT })).to.be.revertedWithCustomError(
        escrow,
        "InvalidState",
      );
    });

    it("allows the arbiter to resolve a funded payment before the deadline", async function () {
      const { escrow, payer, arbiter } = await fixture();
      await fund(escrow, payer);
      await expect(escrow.connect(arbiter).refundPayment(1))
        .to.emit(escrow, "PaymentRefunded")
        .withArgs(1, arbiter.address, payer.address, AMOUNT, ethers.ZeroAddress);
      expect((await escrow.getPayment(1)).state).to.equal(3);
    });
  });
});
