// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "./open-zeppelin/interfaces/IERC20.sol";
import "./open-zeppelin/libraries/SafeERC20.sol";
import "./Warden.sol";
import "./interfaces/IVotingEscrow.sol";
import "./interfaces/IVotingEscrowDelegation.sol";

/** @title Utils for the Warden contract  */
/// @author Paladin
contract WardenUtils {

    uint256 public constant UNIT = 1e18;
    uint256 public constant MAX_PCT = 10000;

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

    // Check if given delegator could delegate with his minPerc parameter used
    function canDelegate(address delegator) external view returns(bool) {
        ( , ,uint256 delegatorMinPerc, ) = warden.offers(warden.userIndex(delegator));
        uint256 balance = votingEscrow.balanceOf(delegator);
        return _canDelegate(delegator, (balance * delegatorMinPerc) / MAX_PCT);

    }

    function canDelegate(address delegator, uint256 percent) external view returns(bool) {
        uint256 balance = votingEscrow.balanceOf(delegator);
        return _canDelegate(delegator, (balance * percent) / MAX_PCT);
    }

    function _canDelegate(address delegator, uint256 amount) internal view returns(bool) {
        if (!delegationBoost.isApprovedForAll(delegator, address(this)))
            return false;

        // Delegator current balance
        uint256 balance = votingEscrow.balanceOf(delegator);
        // Total amount currently delegated
        uint256 delegatedBalance = delegationBoost.delegated_boost(delegator);

        ( , , ,uint256 delegatorMaxPerc) = warden.offers(warden.userIndex(delegator));

        // Percent of delegator balance not allowed to delegate (as set by maxPerc in the BoostOffer)
        uint256 blockedBalance = (balance * (MAX_PCT - delegatorMaxPerc)) /
            MAX_PCT;

        // Available Balance to delegate = VotingEscrow Balance - Delegated Balance - Blocked Balance
        uint256 availableBalance = balance - delegatedBalance - blockedBalance;
        if (amount <= availableBalance) return true;

        // Check if cancel expired Boosts could bring enough to delegate
        uint256 potentialBalance = availableBalance;

        uint256 nbTokens = delegationBoost.total_minted(delegator);
        uint256 currentTime = block.timestamp;

        // Loop over the delegator current boosts to find expired ones
        for (uint256 i = 0; i < nbTokens; i++) {
            uint256 tokenId = delegationBoost.token_of_delegator_by_index(
                delegator,
                i
            );
            uint256 cancelTime = delegationBoost.token_cancel_time(tokenId);

            if (cancelTime < currentTime) {
                int256 boost = delegationBoost.token_boost(tokenId);
                uint256 absolute_boost = boost >= 0 ? uint256(boost) : uint256(-boost);
                potentialBalance += absolute_boost;
            }
        }

        // If canceling the tokens can free enough to delegate
        if (amount <= potentialBalance) return true;

        return false;
    }

    //Base method for the beginning, if the list of users grows too big, will be useless
    function getAvailableDelegators() external view returns(address[] memory) {
        uint256 totalNbOffers = warden.offersIndex();

        address[] memory availableDelegators = new address[](totalNbOffers);
        uint256 availableIndex = 0;

        for(uint256 i = 0; i < totalNbOffers; i++){
            (address delegator , ,uint256 minPerc ,) = warden.offers(i);
            uint256 balance = votingEscrow.balanceOf(delegator);
            if(_canDelegate(delegator, (balance * minPerc) / MAX_PCT)){
                availableDelegators[availableIndex] = delegator;
                availableIndex++;
            }
        }

        return availableDelegators;
    }

}