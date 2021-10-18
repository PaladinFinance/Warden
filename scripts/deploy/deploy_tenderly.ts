export { };
const hre = require("hardhat");

const ethers = hre.ethers;

require("dotenv").config();

const {
    FEE_TOKEN_ADDRESS,
    VOTING_ESCROW_ADDRESS,
    DELEGATION_BOOST_ADDRESS,
    FEE_RATIO,
    MIN_PERCENT_REQUIRED
} = require('../utils/main_params');


async function main() {

    const deployer = (await hre.ethers.getSigners())[0];

    const network = hre.tenderly.network();

    const provider = new ethers.providers.Web3Provider(network)
    ethers.provider = provider

    console.log('- Connecting to a Tenderly Fork');
    await network.setFork(process.env.TENDERLY_FORK_ID);
    await network.setHead(process.env.TENDERLY_HEAD_ID);

    console.log('Deploying Warden  ...')

    const Warden = await ethers.getContractFactory("Warden");
    const Lens = await ethers.getContractFactory("WardenLens");



    const warden = await Warden.deploy(
        FEE_TOKEN_ADDRESS,
        VOTING_ESCROW_ADDRESS,
        DELEGATION_BOOST_ADDRESS,
        FEE_RATIO,
        MIN_PERCENT_REQUIRED
    );
    await warden.deployed();

    console.log('Warden : ')
    console.log(warden.address)



    const lens = await Lens.deploy(
        VOTING_ESCROW_ADDRESS,
        DELEGATION_BOOST_ADDRESS,
        warden.address
    );
    await lens.deployed();

    console.log('Warden Lens : ')
    console.log(lens.address)



    await warden.deployTransaction.wait(5);
    await lens.deployTransaction.wait(5);



    await network.verify({
        address: warden.address,
        name: "Warden"
    });

    await network.verify({
        address: lens.address,
        name: "WardenLens"
    });

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