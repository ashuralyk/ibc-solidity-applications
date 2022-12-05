const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers");
const { expect, assert } = require("chai");
const { upgrades, ethers } = require("hardhat");

function fixed_length(bytes, len) {
  let newBytes;
  if (bytes.length > len) {
    newBytes = bytes.slice(0, len);
  } else {
    newBytes = new Uint8Array(len);
    newBytes.set(bytes);
  }
  assert(newBytes.length == len);
  return newBytes;
}

describe("DotBit Auction", function () {
  const ACCOUNT_ID = fixed_length(ethers.utils.toUtf8Bytes("xyz.bit"), 20);
  const PRICE = ethers.utils.parseEther("0.1");

  function getFixedId(deadline) {
    return ethers.utils.solidityKeccak256(
      ["string", "bytes20", "uint256", "uint256"],
      ["on_fixed_sell", ACCOUNT_ID, PRICE, deadline]
    );
  }

  function getBidId(deadline) {
    return ethers.utils.solidityKeccak256(
      ["string", "bytes20", "uint256", "uint256"],
      ["on_bid_sell", ACCOUNT_ID, PRICE, deadline]
    );
  }

  // We define a fixture to reuse the same setup in every test.
  // We use loadFixture to run this setup once, snapshot that state,
  // and reset Hardhat Network to that snapshot in every test.
  async function deploy() {
    // Contracts are deployed using the first signer/account by default
    const [owner, buyer, seller, ...wallets] = await ethers.getSigners();

    const Auction = await ethers.getContractFactory("DotBitAuction");
    const Auction_PROXY = await upgrades.deployProxy(Auction, [], { initializer: "construct" });
    await Auction_PROXY.deployed();

    return { contract: Auction_PROXY.connect(buyer), owner, buyer, seller, wallets };
  }

  // Testing Buy
  describe("Buy", function () {
    it("Should emit Buy event with corrent seller balance", async function () {
      const { contract, _, buyer, seller } = await loadFixture(deploy);

      const previous_balance = await seller.getBalance();
      const deadline = await time.latest() + 3600 * 5;
      const fixedId = getFixedId(deadline);
      const buyParams = [seller.address, buyer.address, fixedId, ACCOUNT_ID, PRICE, deadline];
      await expect(contract.buy(...buyParams, { value: PRICE }))
        .emit(contract, "Buy")
        .withArgs(...buyParams);
      expect(await seller.getBalance()).to.equal(previous_balance.add(PRICE));
    });

    it("Should fail with insufficient ETH value", async function () {
      const { contract, _, buyer, seller } = await loadFixture(deploy);

      const deadline = await time.latest() + 3600 * 5;
      const fixedId = getFixedId(deadline);
      await expect(contract.buy(seller.address, buyer.address, fixedId, ACCOUNT_ID, PRICE, deadline))
        .rejectedWith(".BIT: ETH amount isn't enough");
    });

    it("Should fail with wrong fixedId", async function () {
      const { contract, _, buyer, seller } = await loadFixture(deploy);

      const deadline = await time.latest() + 3600 * 5;
      const fixedId = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("wrong fixedId"));
      await expect(contract.buy(seller.address, buyer.address, fixedId, ACCOUNT_ID, PRICE, deadline, { value: PRICE }))
        .rejectedWith(".BIT: fixedId dosen't match");
    });

    it("Should fail with short or long deadline", async function () {
      const { contract, _, buyer, seller } = await loadFixture(deploy);

      let deadline = await time.latest();
      let fixedId = getFixedId(deadline);
      await expect(contract.buy(seller.address, buyer.address, fixedId, ACCOUNT_ID, PRICE, deadline, { value: PRICE }))
        .rejectedWith(".BIT: sale has end up");

      deadline = await time.latest() + 3600 * 24 * 181;
      fixedId = getFixedId(deadline);
      await expect(contract.buy(seller.address, buyer.address, fixedId, ACCOUNT_ID, PRICE, deadline, { value: PRICE }))
        .rejectedWith(".BIT: deadline is too long");
    });

    it("Should fail while paused", async function () {
      const { contract, owner, buyer, seller } = await loadFixture(deploy);

      await contract.connect(owner).setPause(true);
      const deadline = await time.latest() + 3600 * 5;
      const fixedId = getFixedId(deadline);
      await expect(contract.buy(seller.address, buyer.address, fixedId, ACCOUNT_ID, PRICE, deadline, { value: PRICE }))
        .rejectedWith(".BIT: contract has paused, please wait unpause");
    });
  });

  // Testing Bid
  describe("Bid", function () {
    it("Should emit Bid event", async function () {
      const { contract, _, buyer, seller } = await loadFixture(deploy);

      const deadline = await time.latest() + 3600 * 24 * 5;
      const bidId = getBidId(deadline);
      const bidParams = [seller.address, buyer.address, bidId, ACCOUNT_ID, PRICE, deadline];
      await expect(contract.bid(...bidParams, { value: PRICE }))
        .emit(contract, "Bid")
        .withArgs(...bidParams);
    });

    it("Should pay back previous bid value to previous buyer", async function () {
      const { contract, owner, buyer, seller, wallets } = await loadFixture(deploy);

      const previous_balance = await buyer.getBalance();
      const deadline = await time.latest() + 3600 * 24 * 5;
      const bidId = getBidId(deadline);
      let bidParams = [seller.address, buyer.address, bidId, ACCOUNT_ID, PRICE, deadline];
      await expect(contract.connect(owner).bid(...bidParams, { value: PRICE })).not.rejected;
      expect(await buyer.getBalance()).to.equal(previous_balance);

      const another_buyer = wallets[0];
      bidParams[1] = another_buyer.address;
      const nextPrice = PRICE.add(ethers.utils.parseEther("0.05"));
      await expect(contract.connect(another_buyer).bid(...bidParams, { value: nextPrice })).not.rejected;
      expect(await buyer.getBalance()).to.equal(previous_balance.add(PRICE));
    });

    it("Should fail with lower bid price", async function () {
      const { contract, _, buyer, seller, wallets } = await loadFixture(deploy);

      const deadline = await time.latest() + 3600 * 24 * 5;
      const bidId = getBidId(deadline);
      let bidParams = [seller.address, buyer.address, bidId, ACCOUNT_ID, PRICE, deadline];
      await expect(contract.bid(...bidParams, { value: PRICE })).not.rejected;

      const another_buyer = wallets[0];
      bidParams[1] = another_buyer.address;
      await expect(contract.connect(another_buyer).bid(...bidParams, { value: PRICE }))
        .rejectedWith(".BIT: ETH amount is less than current price");
    });

    it("Should fail while paused", async function () {
      const { contract, owner, buyer, seller } = await loadFixture(deploy);

      await contract.connect(owner).setPause(true);
      const deadline = await time.latest() + 3600 * 24 * 5;
      const bidId = getBidId(deadline);
      await expect(contract.bid(seller.address, buyer.address, bidId, ACCOUNT_ID, PRICE, deadline, { value: PRICE }))
        .rejectedWith(".BIT: contract has paused, please wait unpause");
    });
  });

  // Testing GetBidIncome
  describe("GetBidIncome", function () {
    it("Should emit GetBidIncome event", async function () {
      const { contract, _, buyer, seller } = await loadFixture(deploy);

      const deadline = await time.latest() + 3600 * 24 * 5;
      const bidId = getBidId(deadline);
      await expect(contract.bid(seller.address, buyer.address, bidId, ACCOUNT_ID, PRICE, deadline, { value: PRICE }))
        .not.rejected;

      await expect(contract.connect(seller).getBidIncome(bidId, buyer.address))
        .emit(contract, "GetBidIncome")
        .withArgs(bidId, buyer.address);
    });

    it("Should fail with wrong buyer", async function () {
      const { contract, _, buyer, seller, wallets } = await loadFixture(deploy);

      const deadline = await time.latest() + 3600 * 24 * 5;
      const bidId = getBidId(deadline);
      await expect(contract.bid(seller.address, buyer.address, bidId, ACCOUNT_ID, PRICE, deadline, { value: PRICE }))
        .not.rejected;

      await expect(contract.connect(seller).getBidIncome(bidId, wallets[0].address))
        .rejectedWith(".BIT: incorrect buyer");
    });

    it("Should fail with wrong seller", async function () {
      const { contract, _, buyer, seller, wallets } = await loadFixture(deploy);

      const deadline = await time.latest() + 3600 * 24 * 5;
      const bidId = getBidId(deadline);
      await expect(contract.bid(seller.address, buyer.address, bidId, ACCOUNT_ID, PRICE, deadline, { value: PRICE }))
        .not.rejected;

      await expect(contract.connect(wallets[0]).getBidIncome(bidId, buyer.address))
        .rejectedWith(".BIT: caller should be the seller before the end of bid");
    });

    it("Should fail while paused", async function () {
      const { contract, owner, buyer, seller } = await loadFixture(deploy);

      await contract.connect(owner).setPause(true);
      const deadline = await time.latest() + 3600 * 24 * 5;
      const bidId = getBidId(deadline);
      await expect(contract.connect(seller).getBidIncome(bidId, buyer.address))
        .rejectedWith(".BIT: contract has paused, please wait unpause");
    });
  });

  // Testing Refund
  describe("Refund", function () {
    it("Should emit Refund event with correct buyer balance", async function () {
      const { contract, owner, buyer, seller } = await loadFixture(deploy);

      const deadline = await time.latest() + 3600 * 24 * 5;
      const bidId = getBidId(deadline);
      await expect(contract.bid(seller.address, buyer.address, bidId, ACCOUNT_ID, PRICE, deadline, { value: PRICE }))
        .not.rejected;

      const previous_balance = await buyer.getBalance();
      await time.increase(3600 * 24 * 6);
      await expect(contract.connect(owner).refund(bidId))
        .emit(contract, "Refund")
        .withArgs(bidId);
      expect(await buyer.getBalance()).to.equal(previous_balance.add(PRICE));
    });

    it("Should fail with wrong block.timestamp", async function () {
      const { contract, owner, buyer, seller } = await loadFixture(deploy);

      const deadline = await time.latest() + 3600 * 24 * 5;
      const bidId = getBidId(deadline);
      await expect(contract.bid(seller.address, buyer.address, bidId, ACCOUNT_ID, PRICE, deadline, { value: PRICE }))
        .not.rejected;

      await expect(contract.connect(owner).refund(bidId))
        .rejectedWith(".BIT: bid hasn't end");
    });

    it("Should fail while paused", async function () {
      const { contract, owner } = await loadFixture(deploy);

      await contract.connect(owner).setPause(true);
      const deadline = await time.latest() + 3600 * 24 * 5;
      const bidId = getBidId(deadline);
      await expect(contract.connect(owner).refund(bidId))
        .rejectedWith(".BIT: contract has paused, please wait unpause");
    });
  });
});
