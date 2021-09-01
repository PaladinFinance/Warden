import { ethers } from "hardhat";

const TOKEN_ADDRESS = "0xD533a949740bb3306d119CC777fa900bA034cd52"; //here : CRV

const VOTING_ESCROW_ADDRESS = "0x5f3b5DfEb7B28CDbD7FAba78963EE202a494e2A2"; //here : veCRV

const BOOST_DELEGATION_ADDRESS = "0xc620aaFD6Caa3Cb7566e54176dD2ED1A81d05655"; //here : veBoost for veCRV

const BIG_HOLDER = "0x7a16fF8270133F063aAb6C9977183D9e72835428"; //here : CRV holder

const VECRV_LOCKING_TIME = Math.floor((86400 * 365 * 4) / (86400 * 7)) * (86400 * 7)

module.exports = {
    TOKEN_ADDRESS,
    VOTING_ESCROW_ADDRESS,
    BOOST_DELEGATION_ADDRESS,
    BIG_HOLDER,
    VECRV_LOCKING_TIME
};