// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "./open-zeppelin/interfaces/IERC20.sol";
import "./open-zeppelin/libraries/SafeERC20.sol";
import "./open-zeppelin/utils/Ownable.sol";
import "./Warden.sol";
import "./interfaces/IVotingEscrow.sol";
import "./interfaces/IVotingEscrowDelegation.sol";

/** @title WardenMultiBuy contract  */
/**
    This contract's purpose is to allow easier purchase of multiple Boosts at once
    Can either:
        - Buy blindly from the Offers list, without sorting,
            with the parameters : maximum Price, and clearExpired (if false: will skip Delegators that could be available 
            after canceling their expired Boosts => less gas used)
        - Buy using a presorted array of Offers index (with the same parameters available)
        - Buy by performing a quickSort over the Offers, to start with the cheapest ones (with the same parameters available)
 */
/// @author Paladin
contract WardenMultiBuy is Ownable {
    using SafeERC20 for IERC20;

    uint256 public constant UNIT = 1e18;
    uint256 public constant MAX_PCT = 10000;
    uint256 public constant WEEK = 7 * 86400;

    /** @notice ERC20 used to pay for DelegationBoost */
    IERC20 public feeToken;
    IVotingEscrow public votingEscrow;
    IVotingEscrowDelegation public delegationBoost;
    Warden public warden;

    constructor(
        address _feeToken,
        address _votingEscrow,
        address _delegationBoost,
        address _warden
    ) {
        feeToken = IERC20(_feeToken);
        votingEscrow = IVotingEscrow(_votingEscrow);
        delegationBoost = IVotingEscrowDelegation(_delegationBoost);
        warden = Warden(_warden);
    }


    struct MultiBuyVars {
        uint256 weeksDuration;
        uint256 boostDuration;
        uint256 totalNbOffers;
        uint256 boostEndTime;
        uint256 expiryTime;
        uint256 previousBalance;
        uint256 endBalance;
        uint256 missingAmount;
        uint256 boughtAmount;
        uint256 wardenMinRequiredPercent;
    }

    struct OfferVars {
        uint256 availableUserBalance;
        uint256 toBuyAmount;
        address delegator;
        uint256 offerPrice;
        uint256 offerminPercent;
        uint256 boostFeeAmount;
        uint256 boostPercent;
        uint256 newTokenId;
    }

    function simpleMultiBuy(
        address receiver,
        uint256 duration,
        uint256 boostAmount,
        uint256 maxPrice,
        uint256 minRequiredAmount, //minimum size of the Boost to buy, smaller will be skipped
        uint256 totalFeesAmount,
        uint256 acceptableSlippage, //BPS
        bool clearExpired
    ) external returns (bool) {
        require(
            receiver != address(0),
            "Zero address"
        );
        require(boostAmount != 0 && totalFeesAmount != 0 && acceptableSlippage != 0, "Null value");
        require(maxPrice != 0, "Null price");

        MultiBuyVars memory vars;

        vars.boostDuration = duration * 1 weeks;
        require(vars.boostDuration >= warden.minDelegationTime(), "Duration too short");
        require(((boostAmount * maxPrice * vars.boostDuration) / UNIT) <= totalFeesAmount, "Not Enough Fees");

        vars.totalNbOffers = warden.offersIndex();

        vars.boostEndTime = block.timestamp + vars.boostDuration;
        vars.expiryTime = (vars.boostEndTime / WEEK) * WEEK;
        vars.expiryTime = (vars.expiryTime < vars.boostEndTime)
            ? ((vars.boostEndTime + WEEK) / WEEK) * WEEK
            : vars.expiryTime;

        vars.previousBalance = feeToken.balanceOf(address(this));

        // Pull the given token amount ot this contract (must be approved beforehand)
        feeToken.safeTransferFrom(msg.sender, address(this), totalFeesAmount);

        //Set the approval to 0, then set it to totalFeesAmount (CRV : race condition)
        if(feeToken.allowance(address(this), address(warden)) != 0) feeToken.safeApprove(address(warden), 0);
        feeToken.safeApprove(address(warden), totalFeesAmount);

        vars.missingAmount = boostAmount;
        vars.boughtAmount = 0;

        vars.wardenMinRequiredPercent = warden.minPercRequired();

        for (uint256 i = 1; i < vars.totalNbOffers; i++) { //since the offer at index 0 is useless

            if(vars.missingAmount == 0) break;

            OfferVars memory varsOffer;

            varsOffer.availableUserBalance = _availableAmount(i, maxPrice, vars.expiryTime, clearExpired);
            if (varsOffer.availableUserBalance == 0) continue; //Offer is not available or not in the required parameters
            if (varsOffer.availableUserBalance < minRequiredAmount) continue; //Offer has an available amount smaller than the required minimum

            varsOffer.toBuyAmount = varsOffer.availableUserBalance > vars.missingAmount ? vars.missingAmount : varsOffer.availableUserBalance;

            (varsOffer.delegator, varsOffer.offerPrice, varsOffer.offerminPercent,) = warden.offers(i);

            varsOffer.boostFeeAmount = (varsOffer.toBuyAmount * varsOffer.offerPrice * vars.boostDuration) / UNIT;

            varsOffer.boostPercent = (varsOffer.toBuyAmount * MAX_PCT) / votingEscrow.balanceOf(varsOffer.delegator);
            if(varsOffer.boostPercent < vars.wardenMinRequiredPercent || varsOffer.boostPercent < varsOffer.offerminPercent) continue; // Offer available percent is udner Warden's minimum required percent

            varsOffer.newTokenId = warden.buyDelegationBoost(varsOffer.delegator, receiver, varsOffer.boostPercent, duration, varsOffer.boostFeeAmount);

            require(varsOffer.newTokenId != 0, "Boost buy fail");

            vars.missingAmount -= varsOffer.toBuyAmount;
            vars.boughtAmount += uint256(delegationBoost.token_boost(varsOffer.newTokenId));
        }

        if(vars.boughtAmount < ((boostAmount * (MAX_PCT - acceptableSlippage)) / MAX_PCT)) 
            revert('Cannot match Order');

        //Return all unused feeTokens to the Buyer
        vars.endBalance = feeToken.balanceOf(address(this));
        feeToken.safeTransfer(msg.sender, (vars.endBalance - vars.previousBalance));

        return true;
    }


    function preSortedMultiBuy(
        address receiver,
        uint256 duration,
        uint256 boostAmount,
        uint256 maxPrice,
        uint256 minRequiredAmount, //minimum size of the Boost to buy, smaller will be skipped
        uint256 totalFeesAmount,
        uint256 acceptableSlippage, //BPS
        bool clearExpired,
        uint256[] memory sortedOfferIndexes
    ) external returns (bool) {
        return _sortedMultiBuy(
        receiver,
        duration,
        boostAmount,
        maxPrice,
        minRequiredAmount,
        totalFeesAmount,
        acceptableSlippage,
        clearExpired,
        sortedOfferIndexes
        );
    }

    function sortingMultiBuy(
        address receiver,
        uint256 duration,
        uint256 boostAmount,
        uint256 maxPrice,
        uint256 minRequiredAmount, //minimum size of the Boost to buy, smaller will be skipped
        uint256 totalFeesAmount,
        uint256 acceptableSlippage, //BPS
        bool clearExpired
    ) external returns (bool) {

        uint256[] memory sortedOfferIndexes = _quickSortOffers();

        return _sortedMultiBuy(
        receiver,
        duration,
        boostAmount,
        maxPrice,
        minRequiredAmount,
        totalFeesAmount,
        acceptableSlippage,
        clearExpired,
        sortedOfferIndexes
        );
    }



    function _sortedMultiBuy(
        address receiver,
        uint256 duration,
        uint256 boostAmount,
        uint256 maxPrice,
        uint256 minRequiredAmount, //minimum size of the Boost to buy, smaller will be skipped
        uint256 totalFeesAmount,
        uint256 acceptableSlippage, //BPS
        bool clearExpired,
        uint256[] memory sortedOfferIndexes
    ) internal returns(bool) {
        require(
            receiver != address(0),
            "Zero address"
        );
        require(boostAmount != 0 && totalFeesAmount != 0 && acceptableSlippage != 0, "Null value");
        require(maxPrice != 0, "Null price");


        MultiBuyVars memory vars;

        vars.boostDuration = duration * 1 weeks;
        vars.weeksDuration = duration;
        require(vars.boostDuration >= warden.minDelegationTime(), "Duration too short");
        require(((boostAmount * maxPrice * vars.boostDuration) / UNIT) <= totalFeesAmount, "Not Enough Fees");

        require(sortedOfferIndexes.length != 0, "Empty Array");

        vars.boostEndTime = block.timestamp + vars.boostDuration;
        vars.expiryTime = (vars.boostEndTime / WEEK) * WEEK;
        vars.expiryTime = (vars.expiryTime < vars.boostEndTime)
            ? ((vars.boostEndTime + WEEK) / WEEK) * WEEK
            : vars.expiryTime;

        vars.previousBalance = feeToken.balanceOf(address(this));

        // Pull the given token amount ot this contract (must be approved beforehand)
        feeToken.safeTransferFrom(msg.sender, address(this), totalFeesAmount);

        //Set the approval to 0, then set it to totalFeesAmount (CRV : race condition)
        if(feeToken.allowance(address(this), address(warden)) != 0) feeToken.safeApprove(address(warden), 0);
        feeToken.safeApprove(address(warden), totalFeesAmount);

        vars.missingAmount = boostAmount;
        vars.boughtAmount = 0;

        vars.wardenMinRequiredPercent = warden.minPercRequired();

        for (uint256 i = 0; i < sortedOfferIndexes.length; i++) { //since the offer at index 0 is useless

            require(sortedOfferIndexes[i] != 0 && sortedOfferIndexes[i] < warden.offersIndex(), "BoostOffer does not exist");

            if(vars.missingAmount == 0) break;

            OfferVars memory varsOffer;

            varsOffer.availableUserBalance = _availableAmount(sortedOfferIndexes[i], maxPrice, vars.expiryTime, clearExpired);
            if (varsOffer.availableUserBalance == 0) continue; //Offer is not available or not in the required parameters
            if (varsOffer.availableUserBalance < minRequiredAmount) continue; //Offer has an available amount smaller than the required minimum

            varsOffer.toBuyAmount = varsOffer.availableUserBalance > vars.missingAmount ? vars.missingAmount : varsOffer.availableUserBalance;

            (varsOffer.delegator, varsOffer.offerPrice, varsOffer.offerminPercent,) = warden.offers(sortedOfferIndexes[i]);

            varsOffer.boostFeeAmount = (varsOffer.toBuyAmount * varsOffer.offerPrice * vars.boostDuration) / UNIT;

            varsOffer.boostPercent = (varsOffer.toBuyAmount * MAX_PCT) / votingEscrow.balanceOf(varsOffer.delegator);
            if(varsOffer.boostPercent < vars.wardenMinRequiredPercent || varsOffer.boostPercent < varsOffer.offerminPercent) continue; // Offer available percent is udner Warden's minimum required percent

            varsOffer.newTokenId = warden.buyDelegationBoost(varsOffer.delegator, receiver, varsOffer.boostPercent, vars.weeksDuration, varsOffer.boostFeeAmount);

            require(varsOffer.newTokenId != 0, "Boost buy fail");

            vars.missingAmount -= varsOffer.toBuyAmount;
            vars.boughtAmount += uint256(delegationBoost.token_boost(varsOffer.newTokenId));
            
        }

        if(vars.boughtAmount < ((boostAmount * (MAX_PCT - acceptableSlippage)) / MAX_PCT)) 
            revert('Cannot match Order');

        //Return all unused feeTokens to the Buyer
        vars.endBalance = feeToken.balanceOf(address(this));
        feeToken.safeTransfer(msg.sender, (vars.endBalance - vars.previousBalance));

        return true;
    }

    function getSortedOffers() external view returns(uint[] memory) { //For tests
        return _quickSortOffers();
    }

    struct OfferInfos {
        address user;
        uint256 price;
    }

    function _quickSortOffers() internal view returns(uint[] memory){
        //Need to build up an array with values from 1 to OfferIndex    => Need to find a better way to do it
        //To then sort the offers by price
        uint256 totalNbOffers = warden.offersIndex();

        OfferInfos[] memory offersList = new OfferInfos[](totalNbOffers - 1);
        for(uint256 i = 0; i < offersList.length; i++){ //Because the 0 index is an empty Offer
            (offersList[i].user, offersList[i].price,,) = warden.offers(i + 1);
        }

        _quickSort(offersList, int(0), int(offersList.length - 1));

        uint256[] memory sortedOffers = new uint256[](totalNbOffers - 1);
        for(uint256 i = 0; i < offersList.length; i++){
            sortedOffers[i] = warden.userIndex(offersList[i].user);
        }

        return sortedOffers;
    }

    function _quickSort(OfferInfos[] memory offersList, int left, int right) internal view {
        int i = left;
        int j = right;
        if(i==j) return;
        OfferInfos memory pivot = offersList[uint(left + (right - left) / 2)];
        while (i <= j) {
            while (offersList[uint(i)].price < pivot.price) i++;
            while (pivot.price < offersList[uint(j)].price) j--;
            if (i <= j) {
                (offersList[uint(i)], offersList[uint(j)]) = (offersList[uint(j)], offersList[uint(i)]);
                i++;
                j--;
            }
        }
        if (left < j)
            _quickSort(offersList, left, j);
        if (i < right)
            _quickSort(offersList, i, right);
    }

    
    function _availableAmount(
        uint256 offerIndex,
        uint256 maxPrice,
        uint256 expiryTime,
        bool clearExpired
    ) internal view returns (uint256) {
        (
            address delegator,
            uint256 offerPrice,
            uint256 minPerc,
            uint256 maxPerc
        ) = warden.offers(offerIndex);

        if (offerPrice > maxPrice) return 0; //Price of the Offer is over the maxPrice given

        if (!delegationBoost.isApprovedForAll(delegator, address(warden))) return 0; //Warden cannot create the Boost

        if (expiryTime >= votingEscrow.locked__end(delegator)) return 0; //veCRV locks ends before wanted duration

        uint256 userBalance = votingEscrow.balanceOf(delegator);

        // Total amount currently delegated
        uint256 delegatedBalance = delegationBoost.delegated_boost(delegator);

        // Percent of delegator balance not allowed to delegate (as set by maxPerc in the BoostOffer)
        uint256 blockedBalance = (userBalance * (MAX_PCT - maxPerc)) / MAX_PCT;

        uint256 availableBalance = userBalance - blockedBalance;

        uint256 minBoostAmount = (userBalance * minPerc) / MAX_PCT;


        if(!clearExpired) { //If we don't want to take Offer with Boost to clear (lesser gas cost)
            if(availableBalance > delegatedBalance){
                if(minBoostAmount > (availableBalance - delegatedBalance)) return 0;

                return (availableBalance - delegatedBalance);
            }

            return 0;
        }

        uint256 currentBoostsNumber = delegationBoost.total_minted(delegator);
        uint256 potentialCancelableBalance = 0;
        if(currentBoostsNumber > 0){
            uint256 currentTime = block.timestamp;

            // Loop over the delegator current boosts to find expired ones
            for (uint256 i = 0; i < currentBoostsNumber; i++) {
                uint256 tokenId = delegationBoost.token_of_delegator_by_index(
                    delegator,
                    i
                );
                uint256 cancelTime = delegationBoost.token_cancel_time(tokenId);

                if (cancelTime < currentTime) {
                    int256 boost = delegationBoost.token_boost(tokenId);
                    uint256 absolute_boost = boost >= 0 ? uint256(boost) : uint256(-boost);
                    potentialCancelableBalance += absolute_boost;
                }
            }
        }

        // Cannot cancel enough Boosts amounts to reach free the account availableBalance
        if (availableBalance < (delegatedBalance - potentialCancelableBalance)) return 0;
        // If canceling the tokens can free enough to delegate
        if (minBoostAmount <= (availableBalance - (delegatedBalance - potentialCancelableBalance))) {
            return (availableBalance - (delegatedBalance - potentialCancelableBalance));
        }

        return 0; //fallback => not enough availableBalance to propose the minimum Boost Amount allowed

    }

    function recoverERC20(address token, uint256 amount) external onlyOwner returns(bool) {
        IERC20(token).safeTransfer(owner(), amount);

        return true;
    }

}