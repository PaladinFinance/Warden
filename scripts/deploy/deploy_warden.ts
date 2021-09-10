export { };
const hre = require("hardhat");

const ethers = hre.ethers;

const network = hre.network.name;

const params_path = () => {
    if (network === 'kovan') {
        return '../utils/kovan_params'
    }
    else {
        return '../utils/main_params'
    }
}

const param_file_path = params_path();

const {
    FEE_TOKEN_ADDRESS,
    VOTING_ESCROW_ADDRESS,
    DELEGATION_BOOST_ADDRESS,
    FEE_RATIO,
    MIN_PERCENT_REQUIRED
} = require(param_file_path);


async function main() {

    console.log('Deploying Warden  ...')

    const deployer = (await hre.ethers.getSigners())[0];

    const Warden = await ethers.getContractFactory("Warden");
    const Utils = await ethers.getContractFactory("WardenUtils");



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



    const utils = await Utils.deploy(
        VOTING_ESCROW_ADDRESS,
        DELEGATION_BOOST_ADDRESS,
        warden.address
    );
    await utils.deployed();

    console.log('Warden Utils : ')
    console.log(utils.address)



    await warden.deployTransaction.wait(5);
    await utils.deployTransaction.wait(5);



    await hre.run("verify:verify", {
        address: warden.address,
        constructorArguments: [
            FEE_TOKEN_ADDRESS,
            VOTING_ESCROW_ADDRESS,
            DELEGATION_BOOST_ADDRESS,
            FEE_RATIO,
            MIN_PERCENT_REQUIRED
        ],
    });

    await hre.run("verify:verify", {
        address: utils.address,
        constructorArguments: [
            VOTING_ESCROW_ADDRESS,
            DELEGATION_BOOST_ADDRESS,
            warden.address
        ],
    });

}


main()
    .then(() => {
        process.exit(0);
    })
    .catch(error => {
        console.error(error);
        process.exit(1);
    });