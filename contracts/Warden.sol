// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "./open-zeppelin/interfaces/IERC20.sol";
import "./open-zeppelin/libraries/SafeERC20.sol";
import "./open-zeppelin/utils/Ownable.sol";
import "./open-zeppelin/utils/Pausable.sol";
import "./open-zeppelin/utils/ReentrancyGuard.sol";
import "./interfaces/IVotingEscrow.sol";
import "./interfaces/IVotingEscrowDelegation.sol";

/** @title Warden contract  */
/// @author Paladin
/*
    Delegation market based on Curve VestingEscrowDelegation contract
*/
contract Warden is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Constants :
    uint256 public constant UNIT = 1e18;
    uint256 public constant MAX_PCT = 10000;

    // Storage :

    /** @notice Offer made by an user to buy a given amount of his votes */
    struct BoostOffer {
        // Address of the user making the offer
        address user;
        // Price per vote, set by the user
        uint256 pricePerVote;
        // Minimum percent of users voting token balance to delegate
        uint16 minPerc; //bps
        // Maximum percent of users voting token balance to delegate
        uint16 maxPerc; //bps
    }

    /** @notice ERC20 used to pay for DelegationBoost */
    IERC20 public feeToken;
    /** @notice Address of the votingToken to delegate */
    IVotingEscrow public votingEscrow;
    /** @notice Address of the Delegation Boost contract */
    IVotingEscrowDelegation public delegationBoost;

    /** @notice ratio of fees to be set as Reserve */
    uint256 public feeRatio; //bps
    /** @notice Total Amount in the Reserve */
    uint256 public reserveAmount;

    /** @notice Min Percent of delegator votes to buy required to purchase a Delegation Boost */
    uint256 public minPercRequired; //bps

    /** @notice Minimum delegation time, taken from veBoost contract */
    uint256 public minDelegationTime = 7 * 1 days;

    /** @notice Total number of offers in the array (useful for external contracts) */
    uint256 public offersIndex;

    /** @notice List of all current registered users and their delegation offer */
    BoostOffer[] public offers;

    /** @notice Index of the user in the offers array */
    mapping(address => uint256) public userIndex;

    /** @notice Amount of fees earned by users through Boost selling */
    mapping(address => uint256) public earnedFees;

    // Events :

    event Registred(address indexed user, uint256 price);

    event UpdateOffer(address indexed user, uint256 newPrice);

    event Quit(address indexed user);

    event BoostPurchase(
        address indexed delegator,
        address indexed receiver,
        uint256 tokenId,
        uint256 percent, //bps
        uint256 price,
        uint256 feeAmount,
        uint256 expiryTime
    );

    event Claim(address indexed user, uint256 amount);

    // Constructor :
    /**
     * @dev Creates the contract, set the given base parameters
     * @param _feeToken address of the token used to pay fees
     * @param _votingEscrow address of the voting token to delegate
     * @param _delegationBoost address of the contract handling delegation
     * @param _feeRatio Percent of fees to be set as Reserve (bps)
     * @param _minPercRequired Minimum percent of user
     */
    constructor(
        address _feeToken,
        address _votingEscrow,
        address _delegationBoost,
        uint256 _feeRatio, //bps
        uint256 _minPercRequired //bps
    ) {
        feeToken = IERC20(_feeToken);
        votingEscrow = IVotingEscrow(_votingEscrow);
        delegationBoost = IVotingEscrowDelegation(_delegationBoost);

        require(_feeRatio <= 5000);
        require(_minPercRequired > 0 && _minPercRequired <= 10000);
        feeRatio = _feeRatio;
        minPercRequired = _minPercRequired;

        // fill index 0 in the offers array
        // since we want to use index 0 for unregistered users
        offers.push(BoostOffer(address(0), 0, 0, 0));
        offersIndex++;
    }

    // Functions :

    /**
     * @notice Registers a new user wanting to sell its delegation
     * @dev Regsiters a new user, creates a BoostOffer with the given parameters
     * @param pricePerVote Price of 1 vote per second
     * @param minPerc Minimum of the delegator balance allowed to use for Boost
     * @param maxPerc Maximum of the delegator balance allowed to use for Boost
     */
    function register(
        uint256 pricePerVote,
        uint16 minPerc,
        uint16 maxPerc
    ) external whenNotPaused {
        address user = msg.sender;
        require(userIndex[user] == 0, "Warden: Already registered");
        require(
            delegationBoost.isApprovedForAll(user, address(this)),
            "Warden: Not operator for caller"
        );

        require(pricePerVote > 0, "Warden: Price cannot be 0");
        require(minPerc <= maxPerc, "Warden: minPerc is over maxPerc");
        require(maxPerc <= 10000, "Warden: maxPerc too high");
        require(minPerc >= minPercRequired, "Warden: minPerc too low");

        // Create the BoostOffer for the new user, and add it to the storage
        uint256 newIndex = offers.length;
        offers.push(BoostOffer(user, pricePerVote, minPerc, maxPerc));
        userIndex[user] = newIndex;
        offersIndex++;

        emit Registred(user, pricePerVote);
    }

    /**
     * @notice Updates an user BoostOffer parameters
     * @dev Updates parameters for the user's BoostOffer
     * @param pricePerVote Price of 1 vote per second
     * @param minPerc Minimum of the delegator balance allowed to use for Boost
     * @param maxPerc Maximum of the delegator balance allowed to use for Boost
     */
    function updateOffer(
        uint256 pricePerVote,
        uint16 minPerc,
        uint16 maxPerc
    ) external whenNotPaused {
        // Fet the user index, and check for registration
        address user = msg.sender;
        uint256 index = userIndex[user];
        require(index != 0, "Warden: Not registered");

        // Fetch the BoostOffer to update
        BoostOffer storage offer = offers[index];

        require(offer.user == msg.sender, "Warden: Not offer owner");

        require(pricePerVote > 0, "Warden: Price cannot be 0");
        require(minPerc <= maxPerc, "Warden: minPerc is over maxPerc");
        require(maxPerc <= 10000, "Warden: maxPerc too high");
        require(minPerc >= minPercRequired, "Warden: minPerc too low");

        // Update the parameters
        offer.pricePerVote = pricePerVote;
        offer.minPerc = minPerc;
        offer.maxPerc = maxPerc;

        emit UpdateOffer(user, pricePerVote);
    }

    /**
     * @notice Remove the BoostOffer of the user, and claim any remaining fees earned
     * @dev User's BoostOffer is removed from the listing, and any unclaimed fees is sent
     */
    function quit() external whenNotPaused nonReentrant {
        address user = msg.sender;
        require(userIndex[user] != 0, "Warden: Not registered");

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
        offersIndex--;

        emit Quit(user);
    }

    /**
     * @notice Gives an estimate of fees to pay for a given Boost Delegation
     * @dev Calculates the amount of fees for a Boost Delegation with the given amount (through the percent) and the duration
     * @param delegator Address of the delegator for the Boost
     * @param percent Percent of the delegator balance to delegate
     * @param duration Duration (in days) of the Boost
     */
    function estimateFees(
        address delegator,
        uint256 percent,
        uint256 duration
    ) external view returns (uint256) {
        require(delegator != address(0), "Warden: Zero address");
        require(userIndex[delegator] != 0, "Warden: Not registered");
        require(
            percent > minPercRequired,
            "Warden: Percent under min required"
        );
        require(percent <= MAX_PCT, "Warden: Percent over 100");

        // Get the duration in seconds, and check it's more than the minimum required
        uint256 durationSeconds = duration * 1 days;
        require(
            durationSeconds >= minDelegationTime,
            "Warden: Duration too short"
        );

        // Fetch the BoostOffer for the delegator
        BoostOffer storage offer = offers[userIndex[delegator]];

        require(
            percent >= offer.minPerc && percent <= offer.maxPerc,
            "Warden: Percent out of Offer bounds"
        );

        // Find how much of the delegator's tokens the given percent represents
        uint256 delegatorBalance = votingEscrow.balanceOf(delegator);
        uint256 toDelegateAmount = (delegatorBalance * percent) / MAX_PCT;

        // Get the price for the whole Amount (price fer second)
        uint256 priceForAmount = (toDelegateAmount * offer.pricePerVote) / UNIT;

        // Then multiply it by the duration (in seconds) to get the cost of the Boost
        return priceForAmount * durationSeconds;
    }

    /**
     * @notice aaa
     * @dev aaa
     * @param delegator Address of the delegator for the Boost
     * @param receiver Address of the receiver of the Boost
     * @param percent Percent of the delegator balance to delegate
     * @param duration Duration (in days) of the Boost
     * @param maxFeeAmount Maximum amount of feeToken available to pay to cover the Boost Duration
     */
    function buyDelegationBoost(
        address delegator,
        address receiver,
        uint256 percent,
        uint256 duration, //in days
        uint256 maxFeeAmount
    ) external nonReentrant whenNotPaused {
        require(
            delegator != address(0) && receiver != address(0),
            "Warden: Zero address"
        );
        require(userIndex[delegator] != 0, "Warden: Not registered");
        require(maxFeeAmount > 0, "Warden: No fees");
        require(
            percent > minPercRequired,
            "Warden: Percent under min required"
        );
        require(percent <= MAX_PCT, "Warden: Percent over 100");

        // Get the duration of the wanted Boost in seconds
        require(
            (duration * 1 days) >= minDelegationTime,
            "Warden: Duration too short"
        );

        // Fetch the BoostOffer for the delegator
        BoostOffer storage offer = offers[userIndex[delegator]];

        require(
            percent >= offer.minPerc && percent <= offer.maxPerc,
            "Warden: Percent out of Offer bounds"
        );

        // Find how much of the delegator's tokens the given percent represents
        uint256 delegatorBalance = votingEscrow.balanceOf(delegator);
        uint256 toDelegateAmount = (delegatorBalance * percent) / MAX_PCT;

        // Check if delegator can delegate the amount, without exceeding the maximum percent allowed by the delegator
        // _canDelegate will also try to cancel expired Boosts of the deelgator to free more tokens for delegation
        require(
            _canDelegate(delegator, toDelegateAmount, offer.maxPerc),
            "Warden: Cannot delegate"
        );

        // Calculate the price for the given duration, get the real amount of fees to pay,
        // and check the maxFeeAmount provided (and approved beforehand) is enough.
        // Calculated using the pricePerVote set by the delegator
        uint256 priceForAmount = (toDelegateAmount * offer.pricePerVote) / UNIT;
        uint256 realFeeAmount = priceForAmount * (duration * 1 days);
        require(
            realFeeAmount <= maxFeeAmount,
            "Warden: Fees do not cover Boost duration"
        );

        // Puul the tokens from the buyer, setting it as earned fees for the delegator (and part of it for the Reserve)
        _pullFees(msg.sender, realFeeAmount, delegator);

        // Calcualte the expiry time for the Boost = now + duration
        uint256 expiryTime = block.timestamp + (duration * 1 days);

        // VotingEscrowDelegation needs the percent of available tokens for delegation when creating the boost, instead of
        // the percent of the users balance. We calculate this percent representing the amount of tokens wanted by the buyer
        uint256 boostPercent = (toDelegateAmount * MAX_PCT) / (delegatorBalance - delegationBoost.delegated_boost(delegator));

        // Get the id (depending on the delegator) for the new Boost
        // See if we could check for past used token for same delegator -> receiver couple to reuse (no minting needed)
        uint256 newId = delegationBoost.total_minted(delegator);

        // Creates the DelegationBoost
        delegationBoost.create_boost(
            delegator,
            receiver,
            int256(boostPercent),
            expiryTime,
            expiryTime,
            newId
        );

        // Fetch the tokenId for the new DelegationBoost that was created, and check it was set for the correct delegator
        uint256 newTokenId = delegationBoost.get_token_id(delegator, newId);
        require(
            newTokenId ==
                delegationBoost.token_of_delegator_by_index(delegator, newId),
            "Warden: DelegationBoost failed"
        );

        emit BoostPurchase(
            delegator,
            receiver,
            newTokenId,
            percent,
            offer.pricePerVote,
            maxFeeAmount,
            expiryTime
        );
    }

    /**
     * @notice Cancels a DelegationBoost
     * @dev Cancels a DelegationBoost :
     * In case the caller is the owner of the Boost, at any time
     * In case the caller is the delegator for the Boost, after cancel_time
     * Else, after expiry_time
     * @param tokenId Id of the DelegationBoost token to cancel
     */
    function cancelDelegationBoost(uint256 tokenId) external whenNotPaused {
        address tokenOwner = delegationBoost.ownerOf(tokenId);
        // If the caller own the token, or this contract is operator for the owner
        // we try to burn the token directly
        if (
            msg.sender == tokenOwner ||
            delegationBoost.isApprovedForAll(tokenOwner, address(this))
        ) {
            delegationBoost.burn(tokenId);
            return;
        }

        uint256 currentTime = block.timestamp;

        // Delegator can cancel the Boost if Cancel Time passed
        address delegator = _getTokenDelegator(tokenId);
        if (
            delegationBoost.token_cancel_time(tokenId) < currentTime &&
            (msg.sender == delegator ||
                delegationBoost.isApprovedForAll(delegator, address(this)))
        ) {
            delegationBoost.cancel_boost(tokenId);
            return;
        }

        // Else, we wait Exipiry Time, so anyone can cancel the delegation
        if (delegationBoost.token_expiry(tokenId) < currentTime) {
            delegationBoost.cancel_boost(tokenId);
            return;
        }

        revert("Cannot cancel the boost");
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
    function claim() external whenNotPaused nonReentrant {
        _claim(msg.sender, earnedFees[msg.sender]);
    }

    /**
     * @notice Claims all earned fees, and cancel all expired Delegation Boost for the user
     * @dev Send all the user's earned fees, and fetch all expired Boosts to cancel them
     */
    function claimAndCancel() external whenNotPaused nonReentrant {
        _cancelAllExpired(msg.sender);
        _claim(msg.sender, earnedFees[msg.sender]);
    }

    /**
     * @notice Claims an amount of earned fees through Boost Delegation selling
     * @dev Send the given amount of earned fees (if amount is correct)
     * @param amount Amount of earned fees to claim
     */
    function claim(uint256 amount) external whenNotPaused nonReentrant {
        require(amount <= earnedFees[msg.sender], "Warden: Amount too high");
        _claim(msg.sender, earnedFees[msg.sender]);
    }

    function _pullFees(
        address buyer,
        uint256 amount,
        address seller
    ) internal {
        // Pull the given token amount ot this contract (must be approved beforehand)
        feeToken.safeTransferFrom(buyer, address(this), amount);

        // Split fees between Boost offerer & Reserve
        earnedFees[seller] += (amount * (MAX_PCT - feeRatio)) / MAX_PCT;
        reserveAmount += (amount * feeRatio) / MAX_PCT;
    }

    function _canDelegate(
        address delegator,
        uint256 amount,
        uint256 delegatorMaxPerc
    ) internal returns (bool) {
        if (!delegationBoost.isApprovedForAll(delegator, address(this)))
            return false;

        // Delegator current balance
        uint256 balance = votingEscrow.balanceOf(delegator);

        // Percent of delegator balance not allowed to delegate (as set by maxPerc in the BoostOffer)
        uint256 blockedBalance = (balance * (MAX_PCT - delegatorMaxPerc)) /
            MAX_PCT;

        // Available Balance to delegate = VotingEscrow Balance - Delegated Balance - Blocked Balance
        uint256 availableBalance = balance - delegationBoost.delegated_boost(delegator) - blockedBalance;
        if (amount <= availableBalance) return true;

        // Check if cancel expired Boosts could bring enough to delegate
        uint256 potentialBalance = availableBalance;

        uint256 nbTokens = delegationBoost.total_minted(delegator);
        uint256[] memory toCancel = new uint256[](nbTokens);
        uint256 nbToCancel = 0;

        // Loop over the delegator current boosts to find expired ones
        for (uint256 i = 0; i < nbTokens; i++) {
            uint256 tokenId = delegationBoost.token_of_delegator_by_index(
                delegator,
                i
            );

            if (delegationBoost.token_cancel_time(tokenId) < block.timestamp) {
                potentialBalance += uint256(
                    -delegationBoost.token_boost(tokenId)
                );
                toCancel[nbToCancel] = tokenId;
                nbToCancel++;
            }
        }

        // If canceling the tokens can free enough to delegate,
        // cancel the batch and return true
        if (amount <= potentialBalance && nbToCancel > 0) {
            delegationBoost.batch_cancel_boosts(toCancel);
            return true;
        }

        return false;
    }

    function _cancelAllExpired(address delegator) internal {
        uint256 nbTokens = delegationBoost.total_minted(delegator);
        // Delegator does not have active Boosts currently
        if (nbTokens == 0) return;

        uint256[] memory toCancel = new uint256[](nbTokens);
        uint256 nbToCancel = 0;
        uint256 currentTime = block.timestamp;

        // Loop over the delegator current boosts to find expired ones
        for (uint256 i = 0; i < nbTokens; i++) {
            uint256 tokenId = delegationBoost.token_of_delegator_by_index(
                delegator,
                i
            );
            uint256 cancelTime = delegationBoost.token_cancel_time(tokenId);

            if (cancelTime < currentTime) {
                toCancel[nbToCancel] = tokenId;
                nbToCancel++;
            }
        }

        // If Boost were found, cancel the batch
        if (nbToCancel > 0) {
            delegationBoost.batch_cancel_boosts(toCancel);
        }
    }

    function _claim(address user, uint256 amount) internal {
        require(
            amount <= feeToken.balanceOf(address(this)),
            "Warden: Insufficient cash"
        );

        // If fees to be claimed, update the mapping, and send the amount
        earnedFees[user] -= amount;

        feeToken.safeTransfer(user, amount);

        emit Claim(user, amount);
    }

    function _getTokenDelegator(uint256 tokenId)
        internal
        pure
        returns (address)
    {
        //Extract the address from the token id : See VotingEscrowDelegation.vy for the logic
        return address(uint160(tokenId >> 96));
    }

    // Admin Functions :

    /**
     * @notice Updates the minimum percent required to buy a Boost
     * @param newMinPercRequired New minimum percent required to buy a Boost
     */
    function setMinPercRequired(uint256 newMinPercRequired) external onlyOwner {
        require(newMinPercRequired > 0 && newMinPercRequired <= 10000);
        minPercRequired = newMinPercRequired;
    }

        /**
     * @notice Updates the minimum delegation time
     * @param newMinDelegationTime New minimum deelgation time
     */
    function setMinDelegationTime(uint256 newMinDelegationTime) external onlyOwner {
        require(newMinDelegationTime > 0);
        minDelegationTime = newMinDelegationTime;
    }

    /**
     * @notice Updates the ratio of Fees set for the Reserve
     * @param newFeeRatio New ratio
     */
    function setFeeRatio(uint256 newFeeRatio) external onlyOwner {
        require(newFeeRatio <= 5000);
        feeRatio = newFeeRatio;
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
     * @dev Withdraw either a lost ERC20 token sent to the contract,
     * or part of the contract Reserve (if token is the feeToken)
     * @param token ERC20 token to withdraw
     * @param amount Amount to transfer
     */
    function withdrawERC20(address token, uint256 amount) external onlyOwner {
        if (token == address(feeToken)) {
            require(amount <= reserveAmount, "Warden: Reserve too low");
            reserveAmount = reserveAmount - amount;
            feeToken.safeTransfer(owner(), amount);
        } else {
            IERC20(token).safeTransfer(owner(), amount);
        }
    }
}
