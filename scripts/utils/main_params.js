const { ethers } = require("hardhat");


const FEE_TOKEN_ADDRESS =  "0xD533a949740bb3306d119CC777fa900bA034cd52"

const VOTING_ESCROW_ADDRESS =  "0x5f3b5DfEb7B28CDbD7FAba78963EE202a494e2A2"

const DELEGATION_BOOST_ADDRESS = ""
// old veBoost 0xd30DD0B919cB4012b3AdD78f6Dcb6eb7ef225Ac8

const FEE_RATIO = 500 // 5%

const MIN_PERCENT_REQUIRED = 1000 //10%


//Deploys

const WARDEN_ADDRESS = "0x2e2f6aece0B7Caa7D3BfDFb2728F50b4e211F1eB"

const WARDEN_LENS_ADDRESS = "0xe0be968a0D6Bba03720DfDB2F3d4b3ED0083b4c7"

module.exports = {
    FEE_TOKEN_ADDRESS,
    VOTING_ESCROW_ADDRESS,
    DELEGATION_BOOST_ADDRESS,
    FEE_RATIO,
    MIN_PERCENT_REQUIRED,
    WARDEN_ADDRESS,
    WARDEN_LENS_ADDRESS,
};