// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;


/** @title Custom Interface for Curve VotingEscrow contract  */
interface IVotingEscrow {
    
    function balanceOf(address _account) external view returns (uint256);

}