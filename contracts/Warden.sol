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
    Delegation market based on Curve VotingEscrowDelegation contract
*/
contract Warden is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Constants :
    uint256 public constant UNIT = 1e18;
    uint256 public constant MAX_PCT = 10000;
    uint256 public constant WEEK = 7 * 86400;

    // Storage :

    /** @notice Offer made by an user to buy a given amount of his votes 
    user : Address of the user making the offer
    pricePerVote : Price per vote per second, set by the user
    minPerc : Minimum percent of users voting token balance to buy for a Boost (in BPS)
    maxPerc : Maximum percent of users total voting token balance available to delegate (in BPS)
    */
    struct BoostOffer {
        // Address of the user making the offer
        address user;
        // Price per vote per second, set by the user
        uint256 pricePerVote;
        // Max duration a Boost from this offer can last
        uint64 maxDuration;
        // Minimum percent of users voting token balance to buy for a Boost
        uint16 minPerc; //bps
        // Maximum percent of users total voting token balance available to delegate
        uint16 maxPerc; //bps
        // Use the advised price instead of the Offer one
        bool useAdvicePrice;
    }

    /** @notice ERC20 used to pay for DelegationBoost */
    IERC20 public feeToken;
    /** @notice Address of the votingToken to delegate */
    IVotingEscrow public votingEscrow;
    /** @notice Address of the Delegation Boost contract */
    IVotingEscrowDelegation public delegationBoost;

    /** @notice ratio of fees to be set as Reserve (in BPS) */
    uint256 public feeReserveRatio; //bps
    /** @notice Total Amount in the Reserve */
    uint256 public reserveAmount;
    /** @notice Address allowed to withdraw from the Reserve */
    address public reserveManager;

    /** @notice Min Percent of delegator votes to buy required to purchase a Delegation Boost (in BPS) */
    uint256 public minPercRequired; //bps

    /** @notice Minimum delegation time, taken from veBoost contract */
    uint256 public minDelegationTime = 1 weeks;

    /** @notice List of all current registered users and their delegation offer */
    BoostOffer[] public offers;

    /** @notice Index of the user in the offers array */
    mapping(address => uint256) public userIndex;

    /** @notice Amount of fees earned by users through Boost selling */
    mapping(address => uint256) public earnedFees;

    bool private _claimBlocked;

    /** @notice Price per vote advised by the maangers for users that don't handle their pricing themselves */
    uint256 public advisedPrice;

    /** @notice Address approved to mamange the advised price */
    mapping(address => bool) public approvedManagers;

    /** @notice Next period to update for the Reward State */
    uint256 public nextUpdatePeriod;

    /** @notice Reward Index by period */
    mapping(uint256 => uint256) public periodRewardIndex;

    /** @notice Base amount of reward to distribute weekly for each veCRV purchased */
    uint256 public baseWeeklyDropPerVote;

    /** @notice Minimum amount of reward to distribute weekly for each veCRV purchased */
    uint256 public minWeeklyDropPerVote;

    /** @notice Target amount of veCRV Boosts to be purchased in a period */
    uint256 public targetPurchaseAmount;

    /** @notice Amount of reward to distribute for the period */
    mapping(uint256 => uint256) public periodDropPerVote;

    /** @notice Amount of veCRV Boosts pruchased for the period */
    mapping(uint256 => uint256) public periodPurchasedAmount;

    /** @notice Decrease of the Purchased amount at the end of the period (since veBoost amounts decrease over time) */
    mapping(uint256 => uint256) public periodEndPurchasedDecrease;

    /** @notice Changes in the periodEndPurchasedDecrease for the period */
    mapping(uint256 => uint256) public periodPurchasedDecreaseChanges;

    /** @notice Amount of rewards paid in extra during last periods */
    uint256 public extraPaidPast;

    /** @notice Reamining rewards not distributed from last periods */
    uint256 public remainingRewardPastPeriod;

    struct PurchasedBoost {
        uint256 amount;
        uint256 startIndex;
        uint128 startTimestamp;
        uint128 endTimestamp;
        address buyer;
        bool claimed;
    }

    /** @notice Mapping of a Boost purchase info, stored by the Boost token ID */
    mapping(uint256 => PurchasedBoost) public purchasedBoosts;

    /** @notice List of the Boost purchased by an user */
    mapping(address => uint256[]) public userPurchasedBoosts;
    
    /** @notice Reward token to distribute to buyers */
    IERC20 public rewardToken;


    // Events :

    event Registred(address indexed user, uint256 price);

    event UpdateOffer(address indexed user, uint256 newPrice);
    event UpdateOfferPrice(address indexed user, uint256 newPrice);

    event Quit(address indexed user);

    event BoostPurchase(
        address indexed delegator,
        address indexed receiver,
        uint256 tokenId,
        uint256 percent, //bps
        uint256 price,
        uint256 paidFeeAmount,
        uint256 expiryTime
    );

    event Claim(address indexed user, uint256 amount);

    event ClaimReward(uint256 boostId, address indexed user, uint256 amount);

    event NewAdvisedPrice(uint256 newPrice);


    modifier onlyAllowed(){
        if(msg.sender != reserveManager && msg.sender != owner()) revert Errors.CallerNotAllowed();
        _;
    }

    // Constructor :
    /**
     * @dev Creates the contract, set the given base parameters
     * @param _feeToken address of the token used to pay fees
     * @param _votingEscrow address of the voting token to delegate
     * @param _delegationBoost address of the contract handling delegation
     * @param _feeReserveRatio Percent of fees to be set as Reserve (bps)
     * @param _minPercRequired Minimum percent of user
     */
    constructor(
        address _feeToken,
        address _votingEscrow,
        address _delegationBoost,
        uint256 _feeReserveRatio, //bps
        uint256 _minPercRequired, //bps
        uint256 _advisedPrice
    ) {
        feeToken = IERC20(_feeToken);
        votingEscrow = IVotingEscrow(_votingEscrow);
        delegationBoost = IVotingEscrowDelegation(_delegationBoost);

        require(_advisedPrice > 0);
        advisedPrice = _advisedPrice;

        require(_feeReserveRatio <= 5000);
        require(_minPercRequired > 0 && _minPercRequired <= 10000);
        feeReserveRatio = _feeReserveRatio;
        minPercRequired = _minPercRequired;

        // fill index 0 in the offers array
        // since we want to use index 0 for unregistered users
        offers.push(BoostOffer(address(0), 0, 0, 0, 0, false));
    }

    // Modifiers :

    modifier rewardStateUpdate() {
        if(!updateRewardState()) revert Errors.FailRewardUpdate();
        _;
    }

    // Functions :

    /**
     * @notice Amount of Offer listed in this market
     * @dev Amount of Offer listed in this market
     */
    function offersIndex() external view returns(uint256){
        return offers.length;
    }

    /**
     * @notice Returns the current period
     * @dev Calculates and returns the current period based on current timestamp
     */
    function currentPeriod() public view returns(uint256) {
        return (block.timestamp / WEEK) * WEEK;
    }

    /**
     * @notice Updates the reward state for all past periods
     * @dev Updates the reward state for all past periods
     */
    function updateRewardState() public whenNotPaused returns(bool){
        if(nextUpdatePeriod == 0) return true; // Reward distribution not initialized
        // Updates once a week
        // If last update is less than a week ago, simply return
        uint256 _currentPeriod = currentPeriod();
        if(_currentPeriod <= nextUpdatePeriod) return true;

        uint256 period = nextUpdatePeriod;

        // Only update 100 period at a time
        for(uint256 i; i < 100;){
            if(period >= _currentPeriod) break;

            uint256 nextPeriod = period + WEEK;

            // Calculate the expected amount ot be distributed for the week (the period)
            // And how much was distributed for that period (based on purchased amounts & period drop per vote)
            uint256 weeklyDropAmount = (baseWeeklyDropPerVote * targetPurchaseAmount) / UNIT;
            uint256 periodRewardAmount = (periodPurchasedAmount[period] * periodDropPerVote[period]) / UNIT;

            // In case we distributed less than the objective
            if(periodRewardAmount <= weeklyDropAmount){
                uint256 undistributedAmount = weeklyDropAmount - periodRewardAmount;
                
                // Remove any extra amount distributed from past periods
                // And set any remaining rewards to be distributed as surplus for next period
                if(extraPaidPast != 0){
                    if(undistributedAmount >= extraPaidPast){
                        undistributedAmount -= extraPaidPast;
                        extraPaidPast = 0;
                    } else{
                        extraPaidPast -= undistributedAmount;
                        undistributedAmount = 0;
                    }
                }
                remainingRewardPastPeriod += undistributedAmount;
            } else { // In case we distributed more than the objective
                uint256 overdistributedAmount = periodRewardAmount - weeklyDropAmount;

                // Remove the extra distributed from the remaining rewards from past period (if there is any)
                // And set the rest of the extra distributed rewards to be accounted for next period
                if(remainingRewardPastPeriod != 0){
                    if(overdistributedAmount >= remainingRewardPastPeriod){
                        overdistributedAmount -= remainingRewardPastPeriod;
                        remainingRewardPastPeriod = 0;
                    } else{
                        remainingRewardPastPeriod -= overdistributedAmount;
                        overdistributedAmount = 0;
                    }
                }
                extraPaidPast += overdistributedAmount;
            }

            // Calculate nextPeriod new drop
            // Based on the basic weekly drop, and any extra reward paid past periods, or remaining rewards from last period
            // In case remainingRewardPastPeriod > 0, then the nextPeriodDropPerVote should be higher than the base one
            // And in case there is extraPaidPast >0, the nextPeriodDropPerVote should be less
            // But nextPeriodDropPerVote can never be less than minWeeklyDropPerVote
            // (In that case, we expected the next period to have extra rewards paid again, and to reach back the objective on future periods)
            uint256 nextPeriodDropPerVote;
            if(extraPaidPast >= weeklyDropAmount + remainingRewardPastPeriod){
                nextPeriodDropPerVote = minWeeklyDropPerVote;
            } else {
                uint256 tempWeeklyDropPerVote = ((weeklyDropAmount + remainingRewardPastPeriod - extraPaidPast) * UNIT) / targetPurchaseAmount;
                nextPeriodDropPerVote = tempWeeklyDropPerVote > minWeeklyDropPerVote ? tempWeeklyDropPerVote : minWeeklyDropPerVote;
            }
            periodDropPerVote[nextPeriod] = nextPeriodDropPerVote;

            // Update the index for the period, based on the period DropPerVote
            periodRewardIndex[nextPeriod] = periodRewardIndex[period] + periodDropPerVote[period];

            // Make next period purchased amount decrease changes
            if(periodPurchasedAmount[period] >= periodEndPurchasedDecrease[period]){
                periodPurchasedAmount[nextPeriod] += periodPurchasedAmount[period] - periodEndPurchasedDecrease[period];
                // Else, we consider the current period purchased amount as  totally removed
            }
            if(periodEndPurchasedDecrease[period] >= periodPurchasedDecreaseChanges[nextPeriod]){
                periodEndPurchasedDecrease[nextPeriod] += periodEndPurchasedDecrease[period] - periodPurchasedDecreaseChanges[nextPeriod];
                // Else the decrease from the current period does not need to be kept for the next period
            }

            // Go to next period
            period = nextPeriod;
            unchecked{ ++i; }
        }

        // Set the period where we stopped (and not updated), as the next period to be updated
        nextUpdatePeriod = period;

        return true;
    }

    /**
     * @notice Registers a new user wanting to sell its delegation
     * @dev Regsiters a new user, creates a BoostOffer with the given parameters
     * @param pricePerVote Price of 1 vote per second (in wei)
     * @param minPerc Minimum percent of users voting token balance to buy for a Boost (in BPS)
     * @param maxPerc Maximum percent of users total voting token balance available to delegate (in BPS)
     */
    function register(
        uint256 pricePerVote,
        uint64 maxDuration,
        uint16 minPerc,
        uint16 maxPerc,
        bool useAdvicePrice
    ) external whenNotPaused rewardStateUpdate returns(bool) {
        address user = msg.sender;
        if(userIndex[user] != 0) revert Errors.AlreadyRegistered();
        if(!delegationBoost.isApprovedForAll(user, address(this))) revert Errors.WardenNotOperator();

        if(pricePerVote == 0) revert Errors.NullPrice();
        if(maxPerc > 10000) revert Errors.MaxPercTooHigh();
        if(minPerc > maxPerc) revert Errors.MinPercOverMaxPerc();
        if(minPerc < minPercRequired) revert Errors.MinPercTooLow();
        if(maxDuration == 0) revert Errors.NullMaxDuration();

        // Create the BoostOffer for the new user, and add it to the storage
        userIndex[user] = offers.length;
        offers.push(BoostOffer(user, pricePerVote, maxDuration, minPerc, maxPerc, useAdvicePrice));

        emit Registred(user, pricePerVote);

        return true;
    }

    /**
     * @notice Updates an user BoostOffer parameters
     * @dev Updates parameters for the user's BoostOffer
     * @param pricePerVote Price of 1 vote per second (in wei)
     * @param minPerc Minimum percent of users voting token balance to buy for a Boost (in BPS)
     * @param maxPerc Maximum percent of users total voting token balance available to delegate (in BPS)
     */
    function updateOffer(
        uint256 pricePerVote,
        uint64 maxDuration,
        uint16 minPerc,
        uint16 maxPerc,
        bool useAdvicePrice
    ) external whenNotPaused rewardStateUpdate returns(bool) {
        // Fet the user index, and check for registration
        address user = msg.sender;
        uint256 index = userIndex[user];
        if(index == 0) revert Errors.NotRegistered();

        // Fetch the BoostOffer to update
        BoostOffer storage offer = offers[index];

        if(offer.user != msg.sender) revert Errors.NotOfferOwner();

        if(pricePerVote == 0) revert Errors.NullPrice();
        if(maxPerc > 10000) revert Errors.MaxPercTooHigh();
        if(minPerc > maxPerc) revert Errors.MinPercOverMaxPerc();
        if(minPerc < minPercRequired) revert Errors.MinPercTooLow();
        if(maxDuration == 0) revert Errors.NullMaxDuration();

        // Update the parameters
        offer.pricePerVote = pricePerVote;
        offer.maxDuration = maxDuration;
        offer.minPerc = minPerc;
        offer.maxPerc = maxPerc;
        offer.useAdvicePrice = useAdvicePrice;

        emit UpdateOffer(user, useAdvicePrice ? advisedPrice : pricePerVote);

        return true;
    }

    /**
     * @notice Updates an user BoostOffer price parameters
     * @dev Updates an user BoostOffer price parameters
     * @param pricePerVote Price of 1 vote per second (in wei)
     * @param useAdvicePrice Bool: use advised price
     */
    function updateOfferPrice(
        uint256 pricePerVote,
        bool useAdvicePrice
    ) external whenNotPaused rewardStateUpdate returns(bool) {
        // Fet the user index, and check for registration
        address user = msg.sender;
        uint256 index = userIndex[user];
        if(index == 0) revert Errors.NotRegistered();

        // Fetch the BoostOffer to update
        BoostOffer storage offer = offers[index];

        if(offer.user != msg.sender) revert Errors.NotOfferOwner();

        if(pricePerVote == 0) revert Errors.NullPrice();

        // Update the parameters
        offer.pricePerVote = pricePerVote;
        offer.useAdvicePrice = useAdvicePrice;

        emit UpdateOfferPrice(user, useAdvicePrice ? advisedPrice : pricePerVote);

        return true;
    }

    /**
     * @notice Returns the Offer data
     * @dev Returns the Offer struct from storage
     * @param index Index of the Offer in the list
     */
    function getOffer(uint256 index) external view returns(
        address user,
        uint256 pricePerVote,
        uint64 maxDuration,
        uint16 minPerc,
        uint16 maxPerc
    ) {
        BoostOffer storage offer = offers[index];
        return(
            offer.user,
            offer.useAdvicePrice ? advisedPrice : offer.pricePerVote,
            offer.maxDuration,
            offer.minPerc,
            offer.maxPerc
        );
    }

    /**
     * @notice Remove the BoostOffer of the user, and claim any remaining fees earned
     * @dev User's BoostOffer is removed from the listing, and any unclaimed fees is sent
     */
    function quit() external whenNotPaused nonReentrant rewardStateUpdate returns(bool) {
        address user = msg.sender;
        if(userIndex[user] == 0) revert Errors.NotRegistered();

        // Check for unclaimed fees, claim it if needed
        if (earnedFees[user] > 0) {
            _claim(user, earnedFees[user]);
        }

        // Find the BoostOffer to remove
        uint256 currentIndex = userIndex[user];
        // If BoostOffer is not the last of the list
        // Replace last of the list with the one to remove
        if (currentIndex < offers.length) {
            uint256 lastIndex = offers.length - 1;
            address lastUser = offers[lastIndex].user;
            offers[currentIndex] = offers[lastIndex];
            userIndex[lastUser] = currentIndex;
        }
        //Remove the last item of the list
        offers.pop();
        userIndex[user] = 0;

        emit Quit(user);

        return true;
    }

    /**
     * @notice Gives an estimate of fees to pay for a given Boost Delegation
     * @dev Calculates the amount of fees for a Boost Delegation with the given amount (through the percent) and the duration
     * @param delegator Address of the delegator for the Boost
     * @param percent Percent of the delegator balance to delegate (in BPS)
     * @param duration Duration (in weeks) of the Boost to purchase
     */
    function estimateFees(
        address delegator,
        uint256 percent,
        uint256 duration //in weeks
    ) external view returns (uint256) {
        if(delegator == address(0)) revert Errors.ZeroAddress();
        if(userIndex[delegator] == 0) revert Errors.NotRegistered();
        if(percent < minPercRequired) revert Errors.PercentUnderMinRequired();
        if(percent > MAX_PCT) revert Errors.PercentOverMax();

        // Fetch the BoostOffer for the delegator
        BoostOffer storage offer = offers[userIndex[delegator]];

        //Check that the duration is less or equal to Offer maxDuration
        if(duration > offer.maxDuration) revert Errors.DurationOverOfferMaxDuration();
        // Get the duration in seconds, and check it's more than the minimum required
        uint256 durationSeconds = duration * 1 weeks;
        if(durationSeconds < minDelegationTime) revert Errors.DurationTooShort();

        if(percent < offer.minPerc || percent > offer.maxPerc) 
            revert Errors.PercentOutOfferBonds();

        uint256 expiryTime = ((block.timestamp + durationSeconds) / WEEK) * WEEK;
        expiryTime = (expiryTime < block.timestamp + durationSeconds) ?
            ((block.timestamp + durationSeconds + WEEK) / WEEK) * WEEK :
            expiryTime;

        if(expiryTime > votingEscrow.locked(delegator).end) revert Errors.LockEndTooShort();

        // Find how much of the delegator's tokens the given percent represents
        uint256 delegatorBalance = votingEscrow.balanceOf(delegator);
        uint256 toDelegateAmount = (delegatorBalance * percent) / MAX_PCT;

        //Should we use the Offer price or the advised one
        uint256 pricePerVote = offer.useAdvicePrice ? advisedPrice : offer.pricePerVote;

        // Get the price for the whole Amount (price fer second)
        uint256 priceForAmount = (toDelegateAmount * pricePerVote) / UNIT;

        // Then multiply it by the duration (in seconds) to get the cost of the Boost
        return priceForAmount * durationSeconds;
    }

    /** 
        All local variables used in the buyDelegationBoost function
     */
    struct BuyVars {
        uint256 boostDuration;
        uint256 delegatorBalance;
        uint256 toDelegateAmount;
        uint256 pricePerVote;
        uint256 realFeeAmount;
        uint256 expiryTime;
        uint256 cancelTime;
        uint256 boostPercent;
        uint256 newId;
        uint256 newTokenId;
        uint256 currentPeriod;
        uint256 currentRewardIndex;
        uint256 boostWeeklyDecrease;
    }

    /**
     * @notice Buy a Delegation Boost for a Delegator Offer
     * @dev If all parameters match the offer from the delegator, creates a Boost for the caller
     * @param delegator Address of the delegator for the Boost
     * @param receiver Address of the receiver of the Boost
     * @param percent Percent of the delegator balance to delegate (in BPS)
     * @param duration Duration (in weeks) of the Boost to purchase
     * @param maxFeeAmount Maximum amount of feeToken available to pay to cover the Boost Duration (in wei)
     * returns the id of the new veBoost
     */
    function buyDelegationBoost(
        address delegator,
        address receiver,
        uint256 percent,
        uint256 duration, //in weeks
        uint256 maxFeeAmount
    ) external nonReentrant whenNotPaused rewardStateUpdate returns(uint256) {
        if(delegator == address(0) || receiver == address(0)) revert Errors.ZeroAddress();
        if(userIndex[delegator] == 0) revert Errors.NotRegistered();
        if(maxFeeAmount == 0) revert Errors.NullFees();
        if(percent < minPercRequired) revert Errors.PercentUnderMinRequired();
        if(percent > MAX_PCT) revert Errors.PercentOverMax();

        BuyVars memory vars;

        // Fetch the BoostOffer for the delegator
        BoostOffer storage offer = offers[userIndex[delegator]];

        //Check that the duration is less or equal to Offer maxDuration
        if(duration > offer.maxDuration) revert Errors.DurationOverOfferMaxDuration();

        // Get the duration of the wanted Boost in seconds
        vars.boostDuration = duration * 1 weeks;
        if(vars.boostDuration < minDelegationTime) revert Errors.DurationTooShort();

        if(percent < offer.minPerc || percent > offer.maxPerc) revert Errors.PercentOutOfferBonds();

        // Find how much of the delegator's tokens the given percent represents
        vars.delegatorBalance = votingEscrow.balanceOf(delegator);
        vars.toDelegateAmount = (vars.delegatorBalance * percent) / MAX_PCT;

        // Check if delegator can delegate the amount, without exceeding the maximum percent allowed by the delegator
        // _canDelegate will also try to cancel expired Boosts of the deelgator to free more tokens for delegation
        if(!_canDelegate(delegator, vars.toDelegateAmount, offer.maxPerc)) revert Errors.CannotDelegate();

        //Should we use the Offer price or the advised one
        vars.pricePerVote = offer.useAdvicePrice ? advisedPrice : offer.pricePerVote;

        // Calculate the price for the given duration, get the real amount of fees to pay,
        // and check the maxFeeAmount provided (and approved beforehand) is enough.
        // Calculated using the pricePerVote set by the delegator
        vars.realFeeAmount = (vars.toDelegateAmount * vars.pricePerVote * vars.boostDuration) / UNIT;
        if(vars.realFeeAmount > maxFeeAmount) revert Errors.FeesTooLow();

        // Pull the tokens from the buyer, setting it as earned fees for the delegator (and part of it for the Reserve)
        _pullFees(msg.sender, vars.realFeeAmount, delegator);

        // Calcualte the expiry time for the Boost = now + duration
        vars.expiryTime = ((block.timestamp + vars.boostDuration) / WEEK) * WEEK;

        // Hack needed because veBoost contract rounds down expire_time
        // We don't want buyers to receive less than they pay for
        // So an "extra" week is added if needed to get an expire_time covering the required duration
        // But cancel_time will be set for the exact paid duration, so any "bonus days" received can be canceled
        // if a new buyer wants to take the offer
        vars.expiryTime = (vars.expiryTime < block.timestamp + vars.boostDuration) ?
            ((block.timestamp + vars.boostDuration + WEEK) / WEEK) * WEEK :
            vars.expiryTime;

        if(vars.expiryTime > votingEscrow.locked(delegator).end) revert Errors.LockEndTooShort();

        // VotingEscrowDelegation needs the percent of available tokens for delegation when creating the boost, instead of
        // the percent of the users balance. We calculate this percent representing the amount of tokens wanted by the buyer
        vars.boostPercent = (vars.toDelegateAmount * MAX_PCT) / 
            (vars.delegatorBalance - delegationBoost.delegated_boost(delegator));

        // Get the id (depending on the delegator) for the new Boost
        vars.newId = delegationBoost.total_minted(delegator);
        unchecked {
            // cancelTime stays current timestamp + paid duration
            // Should not overflow : Since expiryTime is the same + some extra time, expiryTime >= cancelTime
            vars.cancelTime = block.timestamp + vars.boostDuration;
        }

        // Creates the DelegationBoost
        delegationBoost.create_boost(
            delegator,
            receiver,
            int256(vars.boostPercent),
            vars.cancelTime,
            vars.expiryTime,
            vars.newId
        );

        // Fetch the tokenId for the new DelegationBoost that was created, and check it was set for the correct delegator
        vars.newTokenId = delegationBoost.get_token_id(delegator, vars.newId);
        if(
            vars.newTokenId !=
                delegationBoost.token_of_delegator_by_index(delegator, vars.newId)
        ) revert Errors.FailDelegationBoost();

        // If rewards were started, otherwise no need to write for that Boost
        if(nextUpdatePeriod != 0) { 

            // Find the current reward index
            vars.currentPeriod = currentPeriod();
            vars.currentRewardIndex = periodRewardIndex[vars.currentPeriod] + (
                (periodDropPerVote[vars.currentPeriod] * (block.timestamp - vars.currentPeriod)) / WEEK
            );

            // Add the amount purchased to the period purchased amount (& the decrease + decrease change)
            vars.boostWeeklyDecrease = (vars.toDelegateAmount * WEEK) / (vars.expiryTime - block.timestamp);
            uint256 nextPeriod = vars.currentPeriod + WEEK;
            periodPurchasedAmount[vars.currentPeriod] += vars.toDelegateAmount;
            periodEndPurchasedDecrease[vars.currentPeriod] += (vars.boostWeeklyDecrease * (nextPeriod - block.timestamp)) / WEEK;
            periodPurchasedDecreaseChanges[nextPeriod] += (vars.boostWeeklyDecrease * (nextPeriod - block.timestamp)) / WEEK;

            if(vars.expiryTime != (nextPeriod)){
                periodEndPurchasedDecrease[nextPeriod] += vars.boostWeeklyDecrease;
                periodPurchasedDecreaseChanges[vars.expiryTime] += vars.boostWeeklyDecrease;
            }

            // Write the Purchase for rewards
            purchasedBoosts[vars.newTokenId] = PurchasedBoost(
                vars.toDelegateAmount,
                vars.currentRewardIndex,
                uint128(block.timestamp),
                uint128(vars.expiryTime),
                msg.sender,
                false
            );
            userPurchasedBoosts[msg.sender].push(vars.newTokenId);
        }

        emit BoostPurchase(
            delegator,
            receiver,
            vars.newTokenId,
            percent,
            vars.pricePerVote,
            vars.realFeeAmount,
            vars.expiryTime
        );

        return vars.newTokenId;
    }

    /**
     * @notice Cancels a DelegationBoost
     * @dev Cancels a DelegationBoost :
     * In case the caller is the owner of the Boost, at any time
     * In case the caller is the delegator for the Boost, after cancel_time
     * Else, after expiry_time
     * @param tokenId Id of the DelegationBoost token to cancel
     */
    function cancelDelegationBoost(uint256 tokenId) external whenNotPaused rewardStateUpdate returns(bool) {
        address tokenOwner = delegationBoost.ownerOf(tokenId);
        // If the caller own the token, and this contract is operator for the owner
        // we try to burn the token directly
        if (
            msg.sender == tokenOwner &&
            delegationBoost.isApprovedForAll(tokenOwner, address(this))
        ) {
            delegationBoost.burn(tokenId);
            return true;
        }

        uint256 currentTime = block.timestamp;

        // Delegator can cancel the Boost if Cancel Time passed
        address delegator = _getTokenDelegator(tokenId);
        if (
            delegationBoost.token_cancel_time(tokenId) < currentTime &&
            (msg.sender == delegator &&
                delegationBoost.isApprovedForAll(delegator, address(this)))
        ) {
            delegationBoost.cancel_boost(tokenId);
            return true;
        }

        // Else, we wait Exipiry Time, so anyone can cancel the delegation
        if (delegationBoost.token_expiry(tokenId) < currentTime) {
            delegationBoost.cancel_boost(tokenId);
            return true;
        }

        revert Errors.CannotCancelBoost();
    }

    /**
     * @notice Returns the amount of fees earned by the user that can be claimed
     * @dev Returns the value in earnedFees for the given user
     * @param user Address of the user
     */
    function claimable(address user) external view returns (uint256) {
        return earnedFees[user];
    }

    /**
     * @notice Claims all earned fees
     * @dev Send all the user's earned fees
     */
    function claim() external nonReentrant rewardStateUpdate returns(bool) {
        if(earnedFees[msg.sender] == 0) revert Errors.NullClaimAmount();
        return _claim(msg.sender, earnedFees[msg.sender]);
    }

    /**
     * @notice Claims all earned fees, and cancel all expired Delegation Boost for the user
     * @dev Send all the user's earned fees, and fetch all expired Boosts to cancel them
     */
    function claimAndCancel() external nonReentrant rewardStateUpdate returns(bool) {
        _cancelAllExpired(msg.sender);
        return _claim(msg.sender, earnedFees[msg.sender]);
    }

    /**
     * @notice Claims an amount of earned fees through Boost Delegation selling
     * @dev Send the given amount of earned fees (if amount is correct)
     * @param amount Amount of earned fees to claim
     */
    function claim(uint256 amount) external nonReentrant rewardStateUpdate returns(bool) {
        if(amount > earnedFees[msg.sender]) revert Errors.AmountTooHigh();
        if(amount == 0) revert Errors.NullClaimAmount();
        return _claim(msg.sender, amount);
    }

    /**
     * @notice Get all Boosts purchased by an user
     * @dev Get all Boosts purchased by an user
     * @param user Address of the buyer
     */
    function getUserPurchasedBoosts(address user) external view returns(uint256[] memory) {
        return userPurchasedBoosts[user];
    }

    /**
     * @notice Get the Purchased Boost data
     * @dev Get the Purchased Boost struct from storage
     * @param boostId Id of the veBoost
     */
    function getPurchasedBoost(uint256 boostId) external view returns(PurchasedBoost memory) {
        return purchasedBoosts[boostId];
    }

    /**
     * @notice Get the amount of rewards for a Boost
     * @dev Get the amount of rewards for a Boost
     * @param boostId Id of the veBoost
     */
    function getBoostReward(uint256 boostId) external view returns(uint256) {
        if(boostId == 0) revert Errors.InvalidBoostId();
        return _getBoostRewardAmount(boostId);
    }

    /**
     * @notice Claim the rewards for a purchased Boost
     * @dev Claim the rewards for a purchased Boost
     * @param boostId Id of the veBoost
     */
    function claimBoostReward(uint256 boostId) external nonReentrant rewardStateUpdate returns(bool) {
        if(boostId == 0) revert Errors.InvalidBoostId();
        return _claimBoostRewards(boostId);
    }

    /**
     * @notice Claim the rewards for multiple Boosts
     * @dev Claim the rewards for multiple Boosts
     * @param boostIds List of veBoost Ids
     */
    function claimMultipleBoostReward(uint256[] calldata boostIds) external nonReentrant rewardStateUpdate returns(bool) {
        uint256 length = boostIds.length;
        for(uint256 i; i < length;) {
            if(boostIds[i] == 0) revert Errors.InvalidBoostId();
            require(_claimBoostRewards(boostIds[i]));

            unchecked{ ++i; }
        }

        return true;
    }

    function _pullFees(
        address buyer,
        uint256 amount,
        address seller
    ) internal {
        // Pull the given token amount ot this contract (must be approved beforehand)
        feeToken.safeTransferFrom(buyer, address(this), amount);

        // Split fees between Boost offerer & Reserve
        earnedFees[seller] += (amount * (MAX_PCT - feeReserveRatio)) / MAX_PCT;
        reserveAmount += (amount * feeReserveRatio) / MAX_PCT;
    }

    struct CanDelegateVars {
        uint256 balance;
        uint256 blockedBalance;
        uint256 availableBalance;
        uint256 nbTokens;
        uint256 delegatedBalance;
        uint256 potentialCancelableBalance;
    }

    function _canDelegate(
        address delegator,
        uint256 amount,
        uint256 delegatorMaxPerc
    ) internal returns (bool) {
        if (!delegationBoost.isApprovedForAll(delegator, address(this)))
            return false;

        CanDelegateVars memory vars;

        // Delegator current balance
        vars.balance = votingEscrow.balanceOf(delegator);

        // Percent of delegator balance not allowed to delegate (as set by maxPerc in the BoostOffer)
        vars.blockedBalance = (vars.balance * (MAX_PCT - delegatorMaxPerc)) / MAX_PCT;

        // Available Balance to delegate = VotingEscrow Balance - Blocked Balance
        vars.availableBalance = vars.balance - vars.blockedBalance;

        vars.nbTokens = delegationBoost.total_minted(delegator);
        uint256[256] memory expiredBoosts; //Need this type of array because of batch_cancel_boosts() from veBoost
        uint256 nbExpired = 0;

        // Loop over the delegator current boosts to find expired ones
        for (uint256 i = 0; i < vars.nbTokens;) {
            uint256 tokenId = delegationBoost.token_of_delegator_by_index(
                delegator,
                i
            );

            // If boost expired
            if (delegationBoost.token_expiry(tokenId) < block.timestamp) {
                expiredBoosts[nbExpired] = tokenId;
                nbExpired++;
            }

            unchecked{ ++i; }
        }
        
        if (nbExpired > 0) {
            delegationBoost.batch_cancel_boosts(expiredBoosts);
        }

        // Then need to check what is the amount currently delegated out of the Available Balance
        vars.delegatedBalance = delegationBoost.delegated_boost(delegator);

        if(vars.availableBalance > vars.delegatedBalance){
            if(amount <= (vars.availableBalance - vars.delegatedBalance)) return true;
        }

        // Check if cancel expired Boosts could bring enough to delegate
        vars.potentialCancelableBalance = 0;

        uint256[256] memory toCancel; //Need this type of array because of batch_cancel_boosts() from veBoost
        uint256 nbToCancel = 0;

        // Loop over the delegator current boosts to find potential cancelable ones
        for (uint256 i = 0; i < vars.nbTokens;) {
            uint256 tokenId = delegationBoost.token_of_delegator_by_index(
                delegator,
                i
            );

            if (delegationBoost.token_cancel_time(tokenId) <= block.timestamp && delegationBoost.token_cancel_time(tokenId) != 0) {
                int256 boost = delegationBoost.token_boost(tokenId);
                uint256 absolute_boost = boost >= 0 ? uint256(boost) : uint256(-boost);
                vars.potentialCancelableBalance += absolute_boost;
                toCancel[nbToCancel] = tokenId;
                nbToCancel++;
            }

            unchecked{ ++i; }
        }

        // If the current Boosts are more than the availableBalance => No balance available for a new Boost
        if (vars.availableBalance < (vars.delegatedBalance - vars.potentialCancelableBalance)) return false;
        // If canceling the tokens can free enough to delegate,
        // cancel the batch and return true
        if (amount <= (vars.availableBalance - (vars.delegatedBalance - vars.potentialCancelableBalance)) && nbToCancel > 0) {
            delegationBoost.batch_cancel_boosts(toCancel);
            return true;
        }

        return false;
    }

    function _cancelAllExpired(address delegator) internal {
        uint256 nbTokens = delegationBoost.total_minted(delegator);
        // Delegator does not have active Boosts currently
        if (nbTokens == 0) return;

        uint256[256] memory toCancel;
        uint256 nbToCancel = 0;
        uint256 currentTime = block.timestamp;

        // Loop over the delegator current boosts to find expired ones
        for (uint256 i = 0; i < nbTokens;) {
            uint256 tokenId = delegationBoost.token_of_delegator_by_index(
                delegator,
                i
            );
            uint256 cancelTime = delegationBoost.token_cancel_time(tokenId);

            if (cancelTime <= currentTime && cancelTime != 0) {
                toCancel[nbToCancel] = tokenId;
                nbToCancel++;
            }

            unchecked{ ++i; }
        }

        // If Boost were found, cancel the batch
        if (nbToCancel > 0) {
            delegationBoost.batch_cancel_boosts(toCancel);
        }
    }

    function _claim(address user, uint256 amount) internal returns(bool) {
        if(_claimBlocked) revert Errors.ClaimBlocked();
        if(amount > feeToken.balanceOf(address(this))) revert Errors.InsufficientCash();

        if(amount == 0) return true; // nothing to claim, but used in claimAndCancel()

        // If fees to be claimed, update the mapping, and send the amount
        unchecked{
            // Should not underflow, since the amount was either checked in the claim() method, or set as earnedFees[user]
            earnedFees[user] -= amount;
        }

        feeToken.safeTransfer(user, amount);

        emit Claim(user, amount);

        return true;
    }

    function _getBoostRewardAmount(uint256 boostId) internal view returns(uint256) {
        PurchasedBoost memory boost = purchasedBoosts[boostId];
        if(boost.buyer == address(0)) revert Errors.BoostRewardsNull();
        if(boost.claimed) return 0;
        if(currentPeriod() <= boost.endTimestamp) return 0;
        if(nextUpdatePeriod <= boost.endTimestamp) revert Errors.RewardsNotUpdated();

        uint256 boostAmount = boost.amount;
        uint256 boostDuration = boost.endTimestamp - boost.startTimestamp;
        uint256 boostDecreaseStep = boostAmount / (boostDuration);
        uint256 boostPeriodDecrease = boostDecreaseStep * WEEK;

        uint256 rewardAmount;

        uint256 indexDiff;
        uint256 periodBoostAmount;
        uint256 endPeriodBoostAmount;

        uint256 period = (boost.startTimestamp / WEEK) * WEEK;
        uint256 nextPeriod = period + WEEK;

        // 1st period (if incomplete)
        if(boost.startTimestamp > period) {
            indexDiff = periodRewardIndex[nextPeriod] - boost.startIndex;
            uint256 timeDiff = nextPeriod - boost.startTimestamp;

            endPeriodBoostAmount = boostAmount - (boostDecreaseStep * timeDiff);

            periodBoostAmount = endPeriodBoostAmount + ((boostDecreaseStep + (boostDecreaseStep * timeDiff)) / 2);

            rewardAmount += (indexDiff * periodBoostAmount) / UNIT;

            boostAmount = endPeriodBoostAmount;
            period = nextPeriod;
            nextPeriod = period + WEEK;
        }

        uint256 nbPeriods = boostDuration / WEEK;
        // all complete periods
        for(uint256 j; j < nbPeriods;){
            indexDiff = periodRewardIndex[nextPeriod] - periodRewardIndex[period];

            endPeriodBoostAmount = boostAmount - (boostDecreaseStep * WEEK);

            periodBoostAmount = endPeriodBoostAmount + ((boostDecreaseStep + boostPeriodDecrease) / 2);

            rewardAmount += (indexDiff * periodBoostAmount) / UNIT;

            boostAmount = endPeriodBoostAmount;
            period = nextPeriod;
            nextPeriod = period + WEEK;

            unchecked{ ++j; }
        }

        return rewardAmount;
    }

    function _claimBoostRewards(uint256 boostId) internal returns(bool) {
        if(nextUpdatePeriod == 0) revert Errors.RewardsNotStarted();
        PurchasedBoost storage boost = purchasedBoosts[boostId];
        if(boost.buyer == address(0)) revert Errors.BoostRewardsNull();

        if(msg.sender != boost.buyer) revert Errors.NotBoostBuyer();
        if(boost.claimed) revert Errors.AlreadyClaimed();
        if(currentPeriod() <= boost.endTimestamp) revert Errors.CannotClaim();

        uint256 rewardAmount = _getBoostRewardAmount(boostId);

        if(rewardAmount == 0) return true; // nothing to claim, return

        if(rewardAmount > rewardToken.balanceOf(address(this))) revert Errors.InsufficientRewardCash();

        boost.claimed = true;

        rewardToken.safeTransfer(msg.sender, rewardAmount);

        emit ClaimReward(boostId, msg.sender, rewardAmount);

        return true;
    }

    function _getTokenDelegator(uint256 tokenId)
        internal
        pure
        returns (address)
    {
        //Extract the address from the token id : See VotingEscrowDelegation.vy for the logic
        return address(uint160(tokenId >> 96));
    }

    // Manager methods:

    function setAdvisedPrice(uint256 newPrice) external {
        if(!approvedManagers[msg.sender]) revert Errors.CallerNotManager();
        if(newPrice == 0) revert Errors.NullValue();
        advisedPrice = newPrice;

        emit NewAdvisedPrice(newPrice);
    }

    // Admin Functions :

    function startRewardDistribution(
        address _rewardToken,
        uint256 _baseWeeklyDropPerVote,
        uint256 _minWeeklyDropPerVote,
        uint256 _targetPurchaseAmount
    ) external onlyOwner {
        if(_rewardToken == address(0)) revert Errors.ZeroAddress();
        if(_baseWeeklyDropPerVote == 0 || _minWeeklyDropPerVote == 0 ||  _targetPurchaseAmount == 0) revert Errors.NullValue();
        if(_baseWeeklyDropPerVote < _minWeeklyDropPerVote) revert Errors.BaseDropTooLow();
        if(nextUpdatePeriod != 0) revert Errors.RewardsAlreadyStarted();

        rewardToken = IERC20(_rewardToken);

        baseWeeklyDropPerVote = _baseWeeklyDropPerVote;
        minWeeklyDropPerVote = _minWeeklyDropPerVote;
        targetPurchaseAmount = _targetPurchaseAmount;

        // Initial period and initial index
        uint256 startPeriod = ((block.timestamp + WEEK) / WEEK) * WEEK;
        periodRewardIndex[startPeriod] = 0;
        nextUpdatePeriod = startPeriod;

        //Initial drop
        periodDropPerVote[startPeriod] = baseWeeklyDropPerVote;
    }

    function setBaseWeeklyDropPerVote(uint256 newBaseWeeklyDropPerVote) external onlyOwner {
        if(newBaseWeeklyDropPerVote == 0) revert Errors.NullValue();
        if(newBaseWeeklyDropPerVote < minWeeklyDropPerVote) revert Errors.BaseDropTooLow();
        baseWeeklyDropPerVote = newBaseWeeklyDropPerVote;
    }

    function setMinWeeklyDropPerVote(uint256 newMinWeeklyDropPerVote) external onlyOwner {
        if(newMinWeeklyDropPerVote == 0) revert Errors.NullValue();
        if(baseWeeklyDropPerVote < newMinWeeklyDropPerVote) revert Errors.MinDropTooHigh();
        minWeeklyDropPerVote = newMinWeeklyDropPerVote;
    }

    function setTargetPurchaseAmount(uint256 newTargetPurchaseAmount) external onlyOwner {
        if(newTargetPurchaseAmount == 0) revert Errors.NullValue();
        targetPurchaseAmount = newTargetPurchaseAmount;
    }

    /**
     * @notice Updates the minimum percent required to buy a Boost
     * @param newMinPercRequired New minimum percent required to buy a Boost (in BPS)
     */
    function setMinPercRequired(uint256 newMinPercRequired) external onlyOwner {
        if(newMinPercRequired == 0 || newMinPercRequired > 10000) revert Errors.InvalidValue();
        minPercRequired = newMinPercRequired;
    }

        /**
     * @notice Updates the minimum delegation time
     * @param newMinDelegationTime New minimum deelgation time (in seconds)
     */
    function setMinDelegationTime(uint256 newMinDelegationTime) external onlyOwner {
        if(newMinDelegationTime == 0) revert Errors.NullValue();
        minDelegationTime = newMinDelegationTime;
    }

    /**
     * @notice Updates the ratio of Fees set for the Reserve
     * @param newFeeReserveRatio New ratio (in BPS)
     */
    function setFeeReserveRatio(uint256 newFeeReserveRatio) external onlyOwner {
        if(newFeeReserveRatio > 5000) revert Errors.InvalidValue();
        feeReserveRatio = newFeeReserveRatio;
    }

    /**
     * @notice Updates the Delegation Boost (veBoost)
     * @param newDelegationBoost New veBoost contract address
     */
    function setDelegationBoost(address newDelegationBoost) external onlyOwner {
        delegationBoost = IVotingEscrowDelegation(newDelegationBoost);
    }

    /**
     * @notice Updates the Reserve Manager
     * @param newReserveManager New Reserve Manager address
     */
    function setReserveManager(address newReserveManager) external onlyOwner {
        reserveManager = newReserveManager;
    }

    /**
    * @notice Approves a new address as manager 
    * @dev Approves a new address as manager
    * @param newManager Address to add
    */
    function approveManager(address newManager) external onlyOwner {
        if(newManager == address(0)) revert Errors.ZeroAddress();
        approvedManagers[newManager] = true;
    }
   
    /**
    * @notice Removes an address from the managers
    * @dev Removes an address from the managers
    * @param manager Address to remove
    */
    function removeManager(address manager) external onlyOwner {
        if(manager == address(0)) revert Errors.ZeroAddress();
        approvedManagers[manager] = false;
    }

    /**
     * @notice Pauses the contract
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpauses the contract
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Block user fee claims
     */
    function blockClaim() external onlyOwner {
        if(_claimBlocked) revert Errors.ClaimBlocked();
        _claimBlocked = true;
    }

    /**
     * @notice Unblock user fee claims
     */
    function unblockClaim() external onlyOwner {
        if(!_claimBlocked) revert Errors.ClaimNotBlocked();
        _claimBlocked = false;
    }

    /**
     * @dev Withdraw either a lost ERC20 token sent to the contract (expect the feeToken)
     * @param token ERC20 token to withdraw
     * @param amount Amount to transfer (in wei)
     */
    function withdrawERC20(address token, uint256 amount) external onlyOwner returns(bool) {
        if(!_claimBlocked && token == address(feeToken)) revert Errors.CannotWithdrawFeeToken(); //We want to be able to recover the fees if there is an issue
        IERC20(token).safeTransfer(owner(), amount);

        return true;
    }

    function depositToReserve(address from, uint256 amount) external onlyAllowed returns(bool) {
        reserveAmount = reserveAmount + amount;
        feeToken.safeTransferFrom(from, address(this), amount);

        return true;
    }

    function withdrawFromReserve(uint256 amount) external onlyAllowed returns(bool) {
        if(amount > reserveAmount) revert Errors.ReserveTooLow();
        reserveAmount = reserveAmount - amount;
        feeToken.safeTransfer(reserveManager, amount);

        return true;
    }
}
