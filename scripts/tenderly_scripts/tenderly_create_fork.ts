export {};
const hre = require("hardhat");
const axios = require("axios");

require("dotenv").config();

async function main() {

    const network = hre.tenderly.network();

    console.log('Creating a new Tenderly Fork');
    await network.initializeFork();

    console.log("Fork ID : ", network.getFork())
    console.log("Header ID : ", network.getHead())

}


main()
.then(() => {
    process.exit(0);
})
.catch(error => {
    console.error(error);
    process.exit(1);
});