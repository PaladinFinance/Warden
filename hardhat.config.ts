import { HardhatUserConfig } from "hardhat/types";

import "@nomiclabs/hardhat-waffle";
import "@typechain/hardhat";
import "hardhat-contract-sizer";
import "@nomiclabs/hardhat-etherscan";
import "solidity-coverage";
import "hardhat-gas-reporter";
import '@tenderly/hardhat-tenderly';

require("dotenv").config();


const config: HardhatUserConfig = {
  defaultNetwork: "hardhat",
  solidity: {
    compilers: [
      {
        version: "0.8.4",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200
          },
        }
      }
    ],
  },
  contractSizer: {
    alphaSort: true,
    runOnCompile: true,
    disambiguatePaths: false,
  },
  networks: {
    hardhat: {
      forking: {
        url: "https://eth-mainnet.alchemyapi.io/v2/" + (process.env.ALCHEMY_API_KEY || ''),
        blockNumber: 14706474
      }
    },
    mainnet: {
      url: process.env.MAINNET_URI,
      accounts: [process.env.MAINNET_PRIVATE_KEY || ''],
    },
    kovan: {
      url: process.env.KOVAN_URI,
      accounts: [process.env.KOVAN_PRIVATE_KEY || ''],
    },
    tenderly: {
      url: "https://rpc.tenderly.co/fork/" + (process.env.TENDERLY_FORK_ID || ''),
      accounts: [process.env.MAINNET_PRIVATE_KEY || ''],
    }
  },
  mocha: {
    timeout: 0
  },
  etherscan: {
    // Your API key for Etherscan
    // Obtain one at https://etherscan.io/
    apiKey: process.env.ETHERSCAN_API_KEY || ''
  },
  typechain: {
    outDir: "typechain",
    target: "ethers-v5"
  },
  gasReporter: {
    enabled: false
  },
  tenderly: {
    project: process.env.TENDERLY_PROJECT || '',
    username: process.env.TENDERLY_USERNAME || '',
    forkNetwork: '1', //Network id of the network we want to fork
  }
};

export default config;
