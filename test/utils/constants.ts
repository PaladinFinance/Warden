import { ethers } from "hardhat";

export enum CHAINID {
    ETH_MAINNET = 1
}

export const BLOCK_NUMBER = {
    [CHAINID.ETH_MAINNET]: 14706474
};

export const TOKEN_ADDRESS = {
    [CHAINID.ETH_MAINNET]: "0xD533a949740bb3306d119CC777fa900bA034cd52", //here : CRV
}

export const VOTING_ESCROW_ADDRESS = {
    [CHAINID.ETH_MAINNET]: "0x5f3b5DfEb7B28CDbD7FAba78963EE202a494e2A2", //here : veCRV
}

export const BOOST_DELEGATION_ADDRESS = {
    [CHAINID.ETH_MAINNET]: "0xd30DD0B919cB4012b3AdD78f6Dcb6eb7ef225Ac8", //here : veBoost for veCRV
}

export const BIG_HOLDER = {
    [CHAINID.ETH_MAINNET]: "0x7a16fF8270133F063aAb6C9977183D9e72835428", //here : CRV holder
}

export const REWARD_TOKEN_ADDRESS = {
    [CHAINID.ETH_MAINNET]: "0xAB846Fb6C81370327e784Ae7CbB6d6a6af6Ff4BF", //here : PAL
}

export const REWARD_HOLDER = {
    [CHAINID.ETH_MAINNET]: "0x0792dcb7080466e4bbc678bdb873fe7d969832b8", //PAL holder (multisig)
}

export const VE_LOCKING_TIME = Math.floor((86400 * 365 * 4) / (86400 * 7)) * (86400 * 7)
