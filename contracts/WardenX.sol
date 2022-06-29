// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "./open-zeppelin/interfaces/IERC20.sol";
import "./open-zeppelin/libraries/SafeERC20.sol";
import "./open-zeppelin/utils/Ownable.sol";
import "./open-zeppelin/utils/Pausable.sol";
import "./open-zeppelin/utils/ReentrancyGuard.sol";
import "./interfaces/IVotingEscrow.sol";
import "./interfaces/IVotingEscrowDelegation.sol";
import "./utils/Errors.sol";

/** @title Warden contract  */
/// @author Paladin
/*
    Delegation market (Bid version) based on Curve VotingEscrowDelegation contract
*/
contract WardenX is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Constants :
    uint256 public constant UNIT = 1e18;
    uint256 public constant MAX_PCT = 10000;
    uint256 public constant WEEK = 7 * 86400;

    // Storage :

    struct Bid{
        uint256 targetVotes;
        // Price per vote per second, set by the user
        uint256 pricePerVote;
        address bidder;
        address receiver;
        address rewardToken;
        // Timestamp of expiry of the Offer
        uint64 expiryTime;
    }

    Bid[] public bids;

    mapping(address => uint256) public userIndex;

    // sorted by Bid index
    mapping(uint256 => uint256) public bidAvailableRewardAmounts;


    /** @notice Address of the votingToken to delegate */
    IVotingEscrow public votingEscrow;
    /** @notice Address of the Delegation Boost contract */
    IVotingEscrowDelegation public delegationBoost;


    // Also used to whitelist the tokens for rewards
    mapping(address => uint256) public minAmountRewardToken;


    /** @notice ratio of fees to pay the protocol (in BPS) */
    uint256 public protocalFeeRatio; //bps
    /** @notice Address to receive protocol fees */
    address public chestAddress;


    /** @notice Min Percent of delegator votes to buy required to purchase a Delegation Boost (in BPS) */
    uint256 public minPercRequired; //bps

    /** @notice Minimum delegation time, taken from veBoost contract */
    uint256 public minDelegationTime = 1 weeks;


    // Events

    event NewRewardToken(address indexed token);
    event RemoveRewardToken(address indexed token);

    event ChestUpdated(address oldChest, address newChest);
    event PlatformFeeUpdated(uint256 oldfee, uint256 newFee);


    // Constructor

    /**
     * @dev Creates the contract, set the given base parameters
     * @param _votingEscrow address of the voting token to delegate
     * @param _delegationBoost address of the contract handling delegation
     * @param _protocalFeeRatio Percent of fees to be set as Reserve (bps)
     */
    constructor(
        address _votingEscrow,
        address _delegationBoost,
        uint256 _protocalFeeRatio //bps
    ) {
        votingEscrow = IVotingEscrow(_votingEscrow);
        delegationBoost = IVotingEscrowDelegation(_delegationBoost);

        require(_protocalFeeRatio <= 5000);
        protocalFeeRatio = _protocalFeeRatio;

        // fill index 0 in the bids array
        // since we want to use index 0 for unregistered users
        bids.push(Bid(0, 0, address(0), address(0), address(0), 0));
    }


    // View Methods

    /**
     * @notice Amount of Bids listed in this market
     * @dev Amount of Bids listed in this market
     */
    function bidsIndex() external view returns(uint256){
        return bids.length;
    }

    /**
     * @notice Returns the current period
     * @dev Calculates and returns the current period based on current timestamp
     */
    function currentPeriod() public view returns(uint256) {
        return (block.timestamp / WEEK) * WEEK;
    }


    // Write Methods










    // Admin Methods

    function addRewardToken(address token, uint256 minRewardPerSecond) external onlyOwner {
        if(minAmountRewardToken[token] != 0) revert Errors.AlreadyAllowedToken();
        if(token == address(0)) revert Errors.ZeroAddress();
        if(minRewardPerSecond == 0) revert Errors.NullValue();
        
        minAmountRewardToken[token] = minRewardPerSecond;

        emit NewRewardToken(token);
    }

    function removeRewardToken(address token) external onlyOwner {
        if(minAmountRewardToken[token] == 0) revert Errors.NotAllowedToken();
        
        minAmountRewardToken[token] = 0;
        
        emit RemoveRewardToken(token);
    }
    
    /**
    * @notice Updates the Chest address
    * @dev Updates the Chest address
    * @param chest Address of the new Chest
    */
    function updateChest(address chest) external onlyOwner {
        if(chest == address(0)) revert Errors.ZeroAddress();
        address oldChest = chestAddress;
        chestAddress = chest;

        emit ChestUpdated(oldChest, chest);
    }

    /**
    * @notice Updates the Platfrom fees BPS ratio
    * @dev Updates the Platfrom fees BPS ratio
    * @param newFee New fee ratio
    */
    function updatePlatformFee(uint256 newFee) external onlyOwner {
        if(newFee > 500) revert Errors.InvalidValue();
        uint256 oldfee = protocalFeeRatio;
        protocalFeeRatio = newFee;

        emit PlatformFeeUpdated(oldfee, newFee);
    }

    /**
    * @notice Recovers ERC2O tokens sent by mistake to the contract
    * @dev Recovers ERC2O tokens sent by mistake to the contract
    * @param token Address tof the EC2O token
    * @return bool: success
    */
    function recoverERC20(address token) external onlyOwner returns(bool) {
        if(minAmountRewardToken[token] != 0) revert Errors.CannotRecoverToken();

        uint256 amount = IERC20(token).balanceOf(address(this));
        if(amount == 0) revert Errors.NullValue();
        IERC20(token).safeTransfer(owner(), amount);

        return true;
    }

}