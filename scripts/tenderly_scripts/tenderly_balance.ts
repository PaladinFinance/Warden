export {};
const hre = require("hardhat");
const axios = require("axios");

require("dotenv").config();

async function main() {

    const deployer = (await hre.ethers.getSigners())[0];

    console.log("Sending some ETH to ", deployer.address)

    console.log('- Connecting to a Tenderly Fork');

    const network = hre.tenderly.network();

    await network.setFork(process.env.TENDERLY_FORK_ID);
    await network.setHead(process.env.TENDERLY_HEAD_ID);

    let resp_data = (await axios.post(
        "https://api.tenderly.co/api/v1/account/" + process.env.TENDERLY_USERNAME + "/project/" + process.env.TENDERLY_PROJECT + "/fork/" + network.getFork() + "/balance", 
        {
            "accounts": [deployer.address],
		    "amount": 1000,
        },
        {
            headers: {
                "X-Access-Key": process.env.TENDERLY_ACCESS_KEY
            }
        }
    )).data

    console.log(resp_data)

    const postDeployHead = network.getHead()

    console.log("New Tenderly Head ID", postDeployHead)

}


main()
.then(() => {
    process.exit(0);
})
.catch(error => {
    console.error(error);
    process.exit(1);
});