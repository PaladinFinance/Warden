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
    WARDEN_ADDRESS
} = require(param_file_path);


async function main() {

    console.log('Deploying WardenBuyWrapper  ...')

    const deployer = (await hre.ethers.getSigners())[0];

    const BuyWrapper = await ethers.getContractFactory("WardenBuyWrapper");



    const wrapper = await BuyWrapper.deploy(
        FEE_TOKEN_ADDRESS,
        VOTING_ESCROW_ADDRESS,
        DELEGATION_BOOST_ADDRESS,
        WARDEN_ADDRESS
    );
    await wrapper.deployed();

    console.log('Warden BuyWrapper : ')
    console.log(wrapper.address)



    await wrapper.deployTransaction.wait(30);


    await hre.run("verify:verify", {
        address: wrapper.address,
        constructorArguments: [
            FEE_TOKEN_ADDRESS,
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