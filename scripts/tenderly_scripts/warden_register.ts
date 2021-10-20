export { };
const hre = require("hardhat");

const ethers = hre.ethers;

require("dotenv").config();

const {
    WARDEN_ADDRESS,
    WARDEN_LENS_ADDRESS
} = require('../utils/tenderly_params');


async function main() {

    const deployer = (await hre.ethers.getSigners())[0];

    console.log('Registering in Warden  ...')

    const Warden = await ethers.getContractFactory("Warden");

    const warden = Warden.attach(WARDEN_ADDRESS);

    await warden.register(ethers.utils.parseEther('0.05'), 1000, 7500, { gasLimit: 8000000 })

    const offersIndex = await warden.offersIndex()
    console.log(await warden.offers(offersIndex.sub(1)))
}


main()
    .then(() => {
        process.exit(0);
    })
    .catch(error => {
        console.error(error);
        process.exit(1);
    });