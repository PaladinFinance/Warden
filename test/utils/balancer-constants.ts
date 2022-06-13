import { ethers } from "hardhat";

export enum CHAINID {
    ETH_MAINNET = 1,
}

export const BLOCK_NUMBER = {
    [CHAINID.ETH_MAINNET]: 14928310,
};

export const TOKEN_ADDRESS = {
    [CHAINID.ETH_MAINNET]: "0xba100000625a3754423978a60c9317c58a424e3D", //here : BAL
}

export const VOTING_ESCROW_ADDRESS = {
    [CHAINID.ETH_MAINNET]: "0xC128a9954e6c874eA3d62ce62B468bA073093F25", //here : veBAL
}

export const BOOST_DELEGATION_ADDRESS = {
    [CHAINID.ETH_MAINNET]: "0xB496FF44746A8693A060FafD984Da41B253f6790", //here : veBoost for veBAL
}

export const BIG_HOLDER = {
    [CHAINID.ETH_MAINNET]: "0x10a19e7ee7d7f8a52822f6817de8ea18204f2e4f", //here : BAL holder
}

export const BPT_TOKEN_ADDRESS = {
    [CHAINID.ETH_MAINNET]: "0x5c6Ee304399DBdB9C8Ef030aB642B10820DB8F56", //here : B-80BAL-20WETH
}

export const BPT_TOKEN_HOLDER = {
    [CHAINID.ETH_MAINNET]: "0x849d52316331967b6ff1198e5e32a0eb168d039d", //here : B-80BAL-20WETH holder
}

export const REWARD_TOKEN_ADDRESS = {
    [CHAINID.ETH_MAINNET]: "0xAB846Fb6C81370327e784Ae7CbB6d6a6af6Ff4BF", //here : PAL
}

export const REWARD_HOLDER = {
    [CHAINID.ETH_MAINNET]: "0x0792dcb7080466e4bbc678bdb873fe7d969832b8", //PAL holder (multisig)
}

export const VE_LOCKING_TIME = Math.floor((86400 * 365) / (86400 * 7)) * (86400 * 7)
