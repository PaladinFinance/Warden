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
    MIN_PERCENT_REQUIRED,
    WARDEN_ADDRESS
} = require(param_file_path);


async function main() {

    console.log('Deploying WardenLens  ...')

    const deployer = (await hre.ethers.getSigners())[0];

    const Lens = await ethers.getContractFactory("WardenLens");



    const lens = await Lens.deploy(
        VOTING_ESCROW_ADDRESS,
        DELEGATION_BOOST_ADDRESS,
        WARDEN_ADDRESS
    );
    await lens.deployed();

    console.log('Warden Lens : ')
    console.log(lens.address)



    await lens.deployTransaction.wait(30);


    await hre.run("verify:verify", {
        address: lens.address,
        constructorArguments: [
            VOTING_ESCROW_ADDRESS,
            DELEGATION_BOOST_ADDRESS,
            WARDEN_ADDRESS
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