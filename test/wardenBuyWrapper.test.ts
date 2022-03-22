const hre = require("hardhat");
import { ethers, waffle } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { Warden } from "../typechain/Warden";
import { WardenBuyWrapper } from "../typechain/WardenBuyWrapper";
import { IERC20 } from "../typechain/IERC20";
import { IERC20__factory } from "../typechain/factories/IERC20__factory";
import { IVotingEscrow } from "../typechain/IVotingEscrow";
import { IVotingEscrow__factory } from "../typechain/factories/IVotingEscrow__factory";
import { IVotingEscrowDelegation } from "../typechain/IVotingEscrowDelegation";
import { IVotingEscrowDelegation__factory } from "../typechain/factories/IVotingEscrowDelegation__factory";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { ContractFactory } from "@ethersproject/contracts";
import { BigNumber } from "@ethersproject/bignumber";

import {
    advanceTime,
    getERC20,
} from "./utils/utils";

const { TOKEN_ADDRESS, VOTING_ESCROW_ADDRESS, BOOST_DELEGATION_ADDRESS, BIG_HOLDER, VECRV_LOCKING_TIME } = require("./utils/constant");


chai.use(solidity);
const { expect } = chai;
const { provider } = ethers;

const unit = ethers.utils.parseEther('1')
const BPS = 10000

let wardenFactory: ContractFactory
let buyWrapperFactory: ContractFactory


describe('Warden BuyWrapper contract tests', () => {
    let admin: SignerWithAddress
    let delegator: SignerWithAddress
    let receiver: SignerWithAddress
    let externalUser: SignerWithAddress

    let warden: Warden
    let buyWrapper: WardenBuyWrapper

    let CRV: IERC20
    let veCRV: IVotingEscrow
    let delegationBoost: IVotingEscrowDelegation

    const price_per_vote = BigNumber.from(8.25 * 1e10) // ~ 50CRV for a 1000 veCRV boost for a week


    before(async () => {
        [admin, delegator, receiver, externalUser] = await ethers.getSigners();

        wardenFactory = await ethers.getContractFactory("Warden");
        buyWrapperFactory = await ethers.getContractFactory("WardenBuyWrapper");

        const crv_amount = ethers.utils.parseEther('5000');
        const lock_amount = ethers.utils.parseEther('1000');

        CRV = IERC20__factory.connect(TOKEN_ADDRESS, provider);

        veCRV = IVotingEscrow__factory.connect(VOTING_ESCROW_ADDRESS, provider);

        delegationBoost = IVotingEscrowDelegation__factory.connect(BOOST_DELEGATION_ADDRESS, provider);

        await getERC20(admin, BIG_HOLDER, CRV, delegator.address, crv_amount);

        if(!(await CRV.allowance(delegator.address, veCRV.address)).eq(0)){
            await CRV.connect(delegator).approve(veCRV.address, 0);
        }
        await CRV.connect(delegator).approve(veCRV.address, crv_amount);
        const locked_balance = (await veCRV.locked(delegator.address)).amount
        const lock_time = (await ethers.provider.getBlock(ethers.provider.blockNumber)).timestamp + VECRV_LOCKING_TIME
        if(locked_balance.eq(0)){
            await veCRV.connect(delegator).create_lock(lock_amount, lock_time);
        } else if(locked_balance.lt(lock_amount)) {
            await veCRV.connect(delegator).increase_amount(lock_amount.sub(locked_balance));
            await veCRV.connect(delegator).increase_unlock_time(lock_time);
        } else {
            await veCRV.connect(delegator).increase_unlock_time(lock_time);
        }

        await CRV.connect(delegator).transfer(receiver.address, crv_amount.sub(lock_amount));

    });


    beforeEach(async () => {

        warden = (await wardenFactory.connect(admin).deploy(
            CRV.address,
            veCRV.address,
            delegationBoost.address,
            500, //5%
            1000 //10%
        )) as Warden;
        await warden.deployed();

        buyWrapper = (await buyWrapperFactory.connect(admin).deploy(
            CRV.address,
            veCRV.address,
            delegationBoost.address,
            warden.address
        )) as WardenBuyWrapper;
        await buyWrapper.deployed();

        await delegationBoost.connect(delegator).setApprovalForAll(warden.address, true);
    });

    it(' should be deployed & have correct parameters', async () => {
        expect(buyWrapper.address).to.properAddress

        const multiBuy_feeToken = await buyWrapper.feeToken();
        const multiBuy_votingEscrow = await buyWrapper.votingEscrow();
        const multiBuy_delegationBoost = await buyWrapper.delegationBoost();
        const multiBuy_warden = await buyWrapper.warden();

        expect(multiBuy_feeToken).to.be.eq(CRV.address);
        expect(multiBuy_votingEscrow).to.be.eq(veCRV.address);
        expect(multiBuy_delegationBoost).to.be.eq(delegationBoost.address);
        expect(multiBuy_warden).to.be.eq(warden.address);

    });

    describe('buyDelegationBoost', async () => {

        const min_perc = 2000
        const max_perc = 10000

        const buy_percent = 5000

        let fee_amount: BigNumber;

        const updated_max_perc = 8000

        const wrong_min_perc = 1500
        const wrong_max_perc = 9000

        const under_min_required_perc = 500
        const over_max_perc = 10100

        const duration = 2
        const wrong_duration = 0

        const one_week = 7 * 86400;

        beforeEach(async () => {

            await warden.connect(delegator).register(price_per_vote, min_perc, max_perc);

            fee_amount = await warden.estimateFees(delegator.address, buy_percent, duration)

            await CRV.connect(receiver).approve(buyWrapper.address, ethers.constants.MaxUint256)

        });

        it(' should create a Boost from the delegator to the caller', async () => {

            const old_balance = await CRV.balanceOf(receiver.address)

            const buy_tx = await buyWrapper.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, buy_percent, duration, fee_amount)

            const new_balance = await CRV.balanceOf(receiver.address)

            const token_id = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1)
            );

            const tx_timestamp = (await ethers.provider.getBlock((await buy_tx).blockNumber || 0)).timestamp

            const boost_expire_time = await delegationBoost.token_expiry(token_id)
            const boost_cancel_time = await delegationBoost.token_cancel_time(token_id)

            const paidFees = old_balance.sub(new_balance)

            await expect(buy_tx)
                .to.emit(warden, 'BoostPurchase')
                .withArgs(
                    delegator.address,
                    receiver.address,
                    token_id,
                    buy_percent,
                    price_per_vote,
                    paidFees,
                    boost_expire_time
                );

            expect(paidFees).to.be.lt(fee_amount)

            const tx_block = (await buy_tx).blockNumber

            const boost_amount = await delegationBoost.token_boost(token_id, { blockTag: tx_block })

            const veCRV_balance_receiver = await veCRV.balanceOf(receiver.address, { blockTag: tx_block })
            const veCRV_balance_delegator = await veCRV.balanceOf(delegator.address, { blockTag: tx_block })
            const veCRV_adjusted_receiver = await delegationBoost.adjusted_balance_of(receiver.address, { blockTag: tx_block })
            const veCRV_adjusted_delegator = await delegationBoost.adjusted_balance_of(delegator.address, { blockTag: tx_block })

            expect(boost_amount).not.to.be.eq(0)
            expect(boost_expire_time).to.be.gte(tx_timestamp + (duration * one_week)) //since there might be "bonus days" because of the veBoost rounding down on expire_time
            expect(boost_cancel_time).to.be.eq(tx_timestamp + (duration * one_week))

            expect(veCRV_adjusted_receiver).to.be.eq(veCRV_balance_receiver.add(boost_amount))
            expect(veCRV_adjusted_delegator).to.be.eq(veCRV_balance_delegator.sub(boost_amount))

            // Cancel Boost by receiver (so delegator is available for later tests)
            await delegationBoost.connect(receiver).cancel_boost(token_id)

        });

        it(' should return all unused fees after the purchase', async () => {

            const old_balance = await CRV.balanceOf(buyWrapper.address)

            await buyWrapper.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, buy_percent, duration, fee_amount)

            const new_balance = await CRV.balanceOf(buyWrapper.address)

            const token_id = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1)
            );

            expect(new_balance).to.be.eq(old_balance)

            // Cancel Boost by receiver (so delegator is available for later tests)
            await delegationBoost.connect(receiver).cancel_boost(token_id)

        });

        it(' should fail if given 0x000...000 as parameter', async () => {

            await expect(
                buyWrapper.connect(receiver).buyDelegationBoost(ethers.constants.AddressZero, receiver.address, buy_percent, duration, fee_amount)
            ).to.be.revertedWith('Warden: Zero address')

            await expect(
                buyWrapper.connect(receiver).buyDelegationBoost(delegator.address, ethers.constants.AddressZero, buy_percent, duration, fee_amount)
            ).to.be.revertedWith('Warden: Zero address')

        });

        it(' should fail if wanted delegator is not registered', async () => {

            await expect(
                buyWrapper.connect(receiver).buyDelegationBoost(externalUser.address, receiver.address, buy_percent, duration, fee_amount)
            ).to.be.revertedWith('Warden: Not registered')

        });

        it(' should fail if percent is invalid', async () => {

            await expect(
                buyWrapper.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, under_min_required_perc, duration, fee_amount)
            ).to.be.revertedWith('Warden: Percent under min required')

            await expect(
                buyWrapper.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, over_max_perc, duration, fee_amount)
            ).to.be.revertedWith('Warden: Percent over 100')

        });

        it(' should fail if asked percent does not match Offer', async () => {

            await warden.connect(delegator).updateOffer(price_per_vote, min_perc, updated_max_perc);

            await expect(
                buyWrapper.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, wrong_min_perc, duration, fee_amount)
            ).to.be.revertedWith('Warden: Percent out of Offer bounds')

            await expect(
                buyWrapper.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, wrong_max_perc, duration, fee_amount)
            ).to.be.revertedWith('Warden: Percent out of Offer bounds')

        });

        it(' should fail if asked duration is less than minimum required', async () => {

            await expect(
                buyWrapper.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, buy_percent, wrong_duration, fee_amount)
            ).to.be.revertedWith('Warden: Duration too short')

        });

        it(' should fail if allowed fee amount is 0 or does not cover the Boost duration', async () => {

            await expect(
                buyWrapper.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, buy_percent, duration, 0)
            ).to.be.revertedWith('Warden: No fees')

            await expect(
                buyWrapper.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, buy_percent, duration, fee_amount.div(2))
            ).to.be.revertedWith('Warden: Fees do not cover Boost duration')

        });

        it(' should fail if contract has not enough allowance for the fee token', async () => {

            await CRV.connect(receiver).approve(buyWrapper.address, 0)

            await expect(
                buyWrapper.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, buy_percent, duration, fee_amount)
            ).to.be.reverted

        });

        it(' should fail if wanted delegator did not approve Warden', async () => {

            await delegationBoost.connect(delegator).setApprovalForAll(warden.address, false);

            await expect(
                buyWrapper.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, buy_percent, duration, fee_amount)
            ).to.be.revertedWith('Warden: Cannot delegate')

        });

        it(' should fail is caller cannot pay the fees', async () => {

            await expect(
                buyWrapper.connect(externalUser).buyDelegationBoost(delegator.address, receiver.address, buy_percent, duration, fee_amount)
            ).to.be.reverted

        });

        it(' should fail if 1 Boost already bought and 2nd Boost percent is out of delegator Offer', async () => {

            await warden.connect(delegator).updateOffer(price_per_vote, min_perc, updated_max_perc);

            await CRV.connect(receiver).approve(warden.address, ethers.constants.MaxUint256)

            await warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, buy_percent, duration, fee_amount)

            const token_id_1 = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1)
            );

            const boost_2_percent = 5000

            await CRV.connect(receiver).transfer(externalUser.address, fee_amount)

            await CRV.connect(externalUser).approve(buyWrapper.address, ethers.constants.MaxUint256)

            await expect(
                buyWrapper.connect(externalUser).buyDelegationBoost(delegator.address, receiver.address, boost_2_percent, duration, fee_amount)
            ).to.be.revertedWith('Warden: Cannot delegate')

            // Cancel Boost by receiver (so delegator is available for later tests)
            await delegationBoost.connect(receiver).cancel_boost(token_id_1)

        });

        it(' should buy a 2nd Boost if the parameters are correct and the delegators Offer allow it', async () => {

            await buyWrapper.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, buy_percent, duration, fee_amount)

            const token_id_1 = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1)
            );

            const boost_2_percent = 5000

            await buyWrapper.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, boost_2_percent, duration, fee_amount)

            const token_id_2 = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1)
            );

            expect(await delegationBoost.token_boost(token_id_2)).not.to.be.eq(0)

            // Cancel Boost by receiver (so delegator is available for later tests)
            await delegationBoost.connect(receiver).cancel_boost(token_id_1)
            await delegationBoost.connect(receiver).cancel_boost(token_id_2)

        });

        it(' should allow to cancel a past Boost to buy from same delegator', async () => {

            const bigger_percent = 8000
            const bigger_fee_amount = await warden.estimateFees(delegator.address, bigger_percent, duration)

            const buy_1_tx = await buyWrapper.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, bigger_percent, duration, bigger_fee_amount)

            const token_id_1 = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1)
            );

            const boost_cancel_time = await delegationBoost.token_cancel_time(token_id_1)
            const tx_timestamp = (await ethers.provider.getBlock((await buy_1_tx).blockNumber || 0)).timestamp
            await advanceTime(boost_cancel_time.sub(tx_timestamp).toNumber())

            const boost_2_percent = 5000

            await buyWrapper.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, boost_2_percent, duration, fee_amount)

            const token_id_2 = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1)
            );

            expect(await delegationBoost.token_boost(token_id_2)).not.to.be.eq(0)

            // Cancel Boost by receiver (so delegator is available for later tests)
            await delegationBoost.connect(receiver).cancel_boost(token_id_1)
            await delegationBoost.connect(receiver).cancel_boost(token_id_2)

        });

        it(' should buy a 2nd Boost if the 1st one is canceled by Receiver', async () => {

            await buyWrapper.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, buy_percent, duration, fee_amount)

            const token_id_1 = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1)
            );

            await delegationBoost.connect(receiver).cancel_boost(token_id_1)

            const boost_2_percent = 5000

            await buyWrapper.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, boost_2_percent, duration, fee_amount)

            const token_id_2 = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1)
            );

            expect(await delegationBoost.token_boost(token_id_2)).not.to.be.eq(0)

            // Cancel Boost by receiver (so delegator is available for later tests)
            await delegationBoost.connect(receiver).cancel_boost(token_id_2)

        });

        it(' should clear the expired Boosts from delegator before purchase', async () => {

            const lower_buy_percent = 2500

            await CRV.connect(receiver).approve(warden.address, ethers.constants.MaxUint256)

            await warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, lower_buy_percent, duration, fee_amount)

            const token_id_1 = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1)
            );

            await advanceTime((duration + 3) * one_week)

            await expect(
                warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, lower_buy_percent, duration, fee_amount)
            ).to.be.reverted

            const old_balance = await CRV.balanceOf(receiver.address)

            const buy_tx = await buyWrapper.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, lower_buy_percent, duration, fee_amount)

            const token_id_2 = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1)
            );

            const tx_timestamp = (await ethers.provider.getBlock((await buy_tx).blockNumber || 0)).timestamp

            const boost_expire_time = await delegationBoost.token_expiry(token_id_2)
            const boost_cancel_time = await delegationBoost.token_cancel_time(token_id_2)

            const new_balance = await CRV.balanceOf(receiver.address)

            const paidFees = old_balance.sub(new_balance)

            expect(paidFees).to.be.lt(fee_amount)

            const tx_block = (await buy_tx).blockNumber

            const boost_amount = await delegationBoost.token_boost(token_id_2, { blockTag: tx_block })

            const veCRV_balance_receiver = await veCRV.balanceOf(receiver.address, { blockTag: tx_block })
            const veCRV_balance_delegator = await veCRV.balanceOf(delegator.address, { blockTag: tx_block })
            const veCRV_adjusted_receiver = await delegationBoost.adjusted_balance_of(receiver.address, { blockTag: tx_block })
            const veCRV_adjusted_delegator = await delegationBoost.adjusted_balance_of(delegator.address, { blockTag: tx_block })

            expect(boost_amount).not.to.be.eq(0)
            expect(boost_expire_time).to.be.gte(tx_timestamp + (duration * one_week)) //since there might be "bonus days" because of the veBoost rounding down on expire_time
            expect(boost_cancel_time).to.be.eq(tx_timestamp + (duration * one_week))

            expect(veCRV_adjusted_receiver).to.be.eq(veCRV_balance_receiver.add(boost_amount))
            expect(veCRV_adjusted_delegator).to.be.eq(veCRV_balance_delegator.sub(boost_amount))

            // Cancel Boost by receiver (so delegator is available for later tests)
            await delegationBoost.connect(receiver).cancel_boost(token_id_2)

        });

    });

});