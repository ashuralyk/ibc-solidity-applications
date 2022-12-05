// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/utils/Context.sol";
// import "hardhat/console.sol";

contract DotBitAuction is Context {
    string public constant FIXED_SALE = "on_fixed_sell";
    string public constant BID_SALE = "on_bid_sell";

    modifier onlyEoa(address user) {
        require(user.code.length == 0, ".BIT: only allow EOA account");
        _;
    }

    modifier onlyOwner {
        require(_msgSender() == _owner, ".BIT: only allow contract owner");
        _;
    }

    modifier onlyUnpaused {
        require(!_paused, ".BIT: contract has paused, please wait unpause");
        _;
    }

    event Buy(
        address seller,
        address buyer,
        bytes32 indexed fixedId,
        bytes20 indexed accountId,
        uint256 price,
        uint256 deadline
    );

    event Bid(
        address seller,
        address buyer,
        bytes32 indexed bidId,
        bytes20 indexed accountId,
        uint256 lowestPrice,
        uint256 deadline
    );

    event GetBidIncome(bytes32 indexed bidId, address buyer);

    event Refund(bytes32 indexed bidId);

    struct PriceItem {
        uint256 deadline;
        uint256 value;
        address bidder;
        address payable buyer;
        address payable seller;
    }

    bool    _paused;
    address _owner;
    uint256 _billing_period;
    uint256 _closing_period;
    uint256 _secure_period;
    uint256 _deadline_period;
    mapping (bytes32 => PriceItem) _priceTable;

    function construct() public {
        _paused = false;
        _owner = _msgSender();
        _billing_period = 1 days;
        _closing_period = 1 days;
        _secure_period = 1 hours;
        _deadline_period = 180 days;
    }

    function changeSettings(uint256 billing, uint256 closing, uint256 secure, uint256 deadline) public onlyOwner {
        _billing_period = billing;
        _closing_period = closing;
        _secure_period = secure;
        _deadline_period = deadline;
    }

    function setPause(bool pause) public onlyOwner {
        _paused = pause;
    }

    function transferOwner(address newOwner) public onlyOwner onlyEoa(newOwner) {
        _owner = newOwner;
    }

    function transferValue(address payable recipient, uint256 amount) private {
        require(address(this).balance >= amount, ".BIT: insufficient balance");
        recipient.transfer(amount);
    }

    function buy(
        address payable seller,
        address buyer,
        bytes32 fixedId,
        bytes20 accountId,
        uint256 price,
        uint256 deadline
    )
        public
        payable
        onlyEoa(_msgSender())
        onlyEoa(seller)
        onlyEoa(buyer)
        onlyUnpaused
    {
        require(price > 0, ".BIT: price can't be 0");
        require(msg.value >= price, ".BIT: ETH amount isn't enough");
        require(deadline <= block.timestamp + _deadline_period, ".BIT: deadline is too long");
        require(deadline - _secure_period > block.timestamp, ".BIT: sale has end up");
        
        bytes32 fixedIdFromParams = keccak256(abi.encodePacked(FIXED_SALE, accountId, price, deadline));
        require(fixedId == fixedIdFromParams, ".BIT: fixedId dosen't match");
        
        transferValue(seller, msg.value);
        emit Buy(seller, buyer, fixedId, accountId, price, deadline);
    }

    function bid(
        address payable seller,
        address payable buyer,
        bytes32 bidId,
        bytes20 accountId,
        uint256 lowestPrice,
        uint256 deadline
    )
        public
        payable
        onlyEoa(_msgSender())
        onlyEoa(buyer)
        onlyEoa(seller)
        onlyUnpaused
    {
        require(lowestPrice > 0, ".BIT: lowestPrice can't be 0");
        require(msg.value >= lowestPrice,  ".BIT: ETH amount isn't enough");
        require(deadline <= block.timestamp + _deadline_period, ".BIT: deadline is too long");
        require(block.timestamp < deadline - _billing_period - _closing_period, ".BIT: sale has end up");
        
        bytes32 bidIdFromParams = keccak256(abi.encodePacked(BID_SALE, accountId, lowestPrice, deadline));
        require(bidId == bidIdFromParams, ".BIT: bidId dosen't match");
        
        PriceItem storage item = _priceTable[bidId];
        require(msg.value > item.value, ".BIT: ETH amount is less than current price");

        // refund the pre highest price
        if (item.value > 0) {
            transferValue(item.buyer, item.value);
        }

        // update the highest price
        item.value = msg.value;
        item.deadline = deadline;
        item.bidder = _msgSender();
        item.buyer = buyer;
        item.seller = seller;

        emit Bid(seller, buyer, bidId, accountId, lowestPrice, deadline);
    }

    function getBidIncome(bytes32 bidId, address buyer) public onlyEoa(_msgSender()) onlyUnpaused {
        PriceItem memory item = _priceTable[bidId];
        require(item.deadline >= block.timestamp, ".BIT: bid hasn't end up yet");
        require(buyer == item.buyer, ".BIT: incorrect buyer");

        if (block.timestamp < item.deadline - _closing_period) {
            require(_msgSender() == item.seller, ".BIT: caller should be the seller before the end of bid");
        }
        
        transferValue(item.seller, item.value);
        delete _priceTable[bidId];

        emit GetBidIncome(bidId, buyer);
    }

    function refund(bytes32 bidId) public onlyEoa(_msgSender()) onlyUnpaused {
        PriceItem memory item = _priceTable[bidId];
        require(item.value > 0, ".BIT: invalid bidId");
        require(item.deadline < block.timestamp, ".BIT: bid hasn't end");

        transferValue(item.buyer, item.value);
        delete _priceTable[bidId];

        emit Refund(bidId);
    }
}
