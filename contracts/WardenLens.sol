// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "./open-zeppelin/interfaces/IERC20.sol";
import "./open-zeppelin/libraries/SafeERC20.sol";
import "./Warden.sol";
import "./interfaces/IVotingEscrow.sol";
import "./interfaces/IVotingEscrowDelegation.sol";

/** @title Lens of the Warden contract  */
/// @author Paladin
contract WardenLens {

    uint256 public constant UNIT = 1e18;
    uint256 public constant MAX_PCT = 10000;
    uint256 public constant MAX_UINT = 2**256 - 1;
    uint256 public constant WEEK = 7 * 86400;

    IVotingEscrow public votingEscrow;
    IVotingEscrowDelegation public delegationBoost;
    Warden public warden;

    constructor(
        address _votingEscrow,
        address _delegationBoost,
        address _warden
    ) {
        votingEscrow = IVotingEscrow(_votingEscrow);
        delegationBoost = IVotingEscrowDelegation(_delegationBoost);
        warden = Warden(_warden);
    }

    function getUserClaimableBoosts(address user) external view returns(uint256[] memory) {
        uint256[] memory userBoosts = warden.getUserclaimableBoosts(user);
        uint256 length = userBoosts.length;

        uint256[] memory claimableBoosts = new uint256[](length);
        uint256 j;

        for(uint256 i; i < length;){

            Warden.PurchasedBoost memory boost = warden.getPurchasedBoost(userBoosts[i]);

            if(!boost.claimed){
                claimableBoosts[j] = userBoosts[i];
                j++;
            }

            unchecked{ ++i; }
        }

        return claimableBoosts;
    }

    // Check if given delegator could delegate with his minPerc parameter used
    function canDelegate(address delegator) external view returns(bool) {
        ( , , ,uint256 delegatorMinPerc, ) = warden.getOffer(warden.userIndex(delegator));
        uint256 balance = votingEscrow.balanceOf(delegator);
        return _canDelegate(delegator, (balance * delegatorMinPerc) / MAX_PCT);

    }

    function canDelegate(address delegator, uint256 percent) external view returns(bool) {
        uint256 balance = votingEscrow.balanceOf(delegator);
        return _canDelegate(delegator, (balance * percent) / MAX_PCT);
    }

    /** 
        All local variables used in the _canDelegate function
     */
    struct DelegateVars {
        uint256 currentTime;
        uint256 minDuration;
        uint256 minExpiryTime;
        uint256 balance;
        uint256 delegatedBalance;
        uint256 potentialCancelableBalance;
        uint256 nbTokens;
    }

    function _canDelegate(address delegator, uint256 amount) internal view returns(bool) {
        if (!delegationBoost.isApprovedForAll(delegator, address(warden)))
            return false;

        DelegateVars memory vars;

        vars.currentTime = block.timestamp;

        //If Delegator veCRV locks ends before the minimum duration
        vars.minDuration = warden.minDelegationTime();
        vars.minExpiryTime =  ((vars.currentTime + vars.minDuration) / WEEK) * WEEK;
        vars.minExpiryTime = (vars.minExpiryTime < vars.currentTime + vars.minDuration) ?
            ((vars.currentTime + vars.minDuration + WEEK) / WEEK) * WEEK :
            vars.minExpiryTime;
        if(vars.minExpiryTime >= votingEscrow.locked__end(delegator)) return false;

        // Delegator current balance
        vars.balance = votingEscrow.balanceOf(delegator);
        // Total amount currently delegated
        vars.delegatedBalance = delegationBoost.delegated_boost(delegator);

        ( , , , ,uint256 delegatorMaxPerc) = warden.getOffer(warden.userIndex(delegator));

        // Percent of delegator balance not allowed to delegate (as set by maxPerc in the BoostOffer)
        uint256 blockedBalance = (vars.balance * (MAX_PCT - delegatorMaxPerc)) /
            MAX_PCT;

        // Available Balance to delegate = VotingEscrow Balance - Blocked Balance
        uint256 availableBalance = vars.balance - blockedBalance;
        // Then need to check what is the amount currently delegated out of the Available Balance
        if(availableBalance > vars.delegatedBalance){
            if(amount <= (availableBalance - vars.delegatedBalance)) return true;
        }

        // Check if cancel expired Boosts could bring enough to delegate
        vars.potentialCancelableBalance = 0;

        vars.nbTokens = delegationBoost.total_minted(delegator);

        // Loop over the delegator current boosts to find expired ones
        for (uint256 i = 0; i < vars.nbTokens;) {
            uint256 tokenId = delegationBoost.token_of_delegator_by_index(
                delegator,
                i
            );
            uint256 cancelTime = delegationBoost.token_cancel_time(tokenId);

            if (cancelTime < vars.currentTime) {
                int256 boost = delegationBoost.token_boost(tokenId);
                uint256 absolute_boost = boost >= 0 ? uint256(boost) : uint256(-boost);
                vars.potentialCancelableBalance += absolute_boost;
            }

            unchecked{ ++i; }
        }

        // If the current Boosts are more than the availableBalance => No balance available for a new Boost
        if (availableBalance < (vars.delegatedBalance - vars.potentialCancelableBalance)) return false;
        // If canceling the tokens can free enough to delegate
        if (amount <= (availableBalance - (vars.delegatedBalance - vars.potentialCancelableBalance))) return true;

        return false;
    }

    //Base method for the beginning, if the list of users grows too big, will be useless
    function getAvailableDelegators() external view returns(address[] memory) {
        uint256 totalNbOffers = warden.offersIndex();

        address[] memory availableDelegators = new address[](totalNbOffers);
        uint256 availableIndex = 0;

        for(uint256 i = 1; i < totalNbOffers;){ //since the offer at index 0 is useless
            (address delegator , , ,uint256 minPerc ,) = warden.getOffer(i);
            uint256 balance = votingEscrow.balanceOf(delegator);
            if(_canDelegate(delegator, (balance * minPerc) / MAX_PCT)){
                availableDelegators[availableIndex] = delegator;
                availableIndex++;
            }

            unchecked{ ++i; }
        }

        return availableDelegators;
    }

    struct Prices {
        uint256 highest;
        uint256 lowest;
        uint256 median;
    }

    function getPrices() external view returns(Prices memory prices) {
        uint256 totalNbOffers = warden.offersIndex();
        uint256 sumPrices;

        if(totalNbOffers <= 1) return prices; //Case where no Offer in the list

        prices.lowest = MAX_UINT; //Set max amount as lowest value instead of 0

        for(uint256 i = 1; i < totalNbOffers;){ //since the offer at index 0 is useless
            (,uint256 offerPrice,,,) = warden.getOffer(i);

            sumPrices += offerPrice;

            if(offerPrice > prices.highest){
                prices.highest = offerPrice;
            }
            if(offerPrice < prices.lowest && offerPrice != 0){
                prices.lowest = offerPrice;
            }

            unchecked{ ++i; }
        }

        prices.median = sumPrices / (totalNbOffers - 1);

        return prices;
        
    }

}