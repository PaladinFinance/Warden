import { ethers } from "ethers";
import { CHAINID } from "./constants";

require("dotenv").config();

export const TEST_URI = {
    [CHAINID.ETH_MAINNET]: "https://eth-mainnet.alchemyapi.io/v2/" + (process.env.ALCHEMY_API_KEY || ''),
};