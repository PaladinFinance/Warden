import { ethers } from "ethers";
import { CHAINID } from "./constants";

require("dotenv").config();

export const TEST_URI = {
    [CHAINID.ETH_MAINNET]: "https://eth-mainnet.alchemyapi.io/v2/" + (process.env.ALCHEMY_API_KEY || ''),
    [CHAINID.AVAX]: "https://api.avax.network/ext/bc/C/rpc",
    [CHAINID.POLYGON]: "https://polygon-mainnet.g.alchemy.com/v2/" + (process.env.POLYGON_ALCHEMY_API_KEY || ''),
    [CHAINID.FANTOM]: "https://rpc.ftm.tools/",
    [CHAINID.OPTIMISM]: "https://opt-mainnet.g.alchemy.com/v2/" + (process.env.OPTIMISM_ALCHEMY_API_KEY || ''),
    [CHAINID.ARBITRUM]: "https://arb-mainnet.g.alchemy.com/v2/" + (process.env.ARBITRUM_ALCHEMY_API_KEY || ''),
};