const { ethers } = require("hardhat");

const POOLS = {
    COMP: "",
    UNI: "",
    AAVE: "",
    STKAAVE: ""
}

const ADMIN_ADDRESS = "0x26D756D057513a43b89735CBd581d5B6eD1b0711"; //Kovan temp address

const SCORE_BLOCK = 0; //max block used to fetch airdrop data, change to 0 to use latest block

const AIRDROP_AMOUNT = 1500000;

const REMOVED_ADDRESSES = [
    "0x26D756D057513a43b89735CBd581d5B6eD1b0711", //Kovan admin address
]


module.exports = {
    POOLS,
    ADMIN_ADDRESS,
    SCORE_BLOCK,
    REMOVED_ADDRESSES,
    AIRDROP_AMOUNT
};