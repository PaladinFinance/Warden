const hre = require("hardhat");
import { ethers, waffle } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { Warden } from "../../typechain/Warden";
import { WardenMultiBuy } from "../../typechain/WardenMultiBuy";
import { IERC20 } from "../../typechain/IERC20";
import { IERC20__factory } from "../../typechain/factories/IERC20__factory";
import { IVotingEscrow } from "../../typechain/IVotingEscrow";
import { IVotingEscrow__factory } from "../../typechain/factories/IVotingEscrow__factory";
import { IVotingEscrowDelegation } from "../../typechain/IVotingEscrowDelegation";
import { IVotingEscrowDelegation__factory } from "../../typechain/factories/IVotingEscrowDelegation__factory";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { ContractFactory } from "@ethersproject/contracts";
import { BigNumber } from "@ethersproject/bignumber";
import { Event } from 'ethers';

import {
    advanceTime,
    getERC20,
    resetFork,
} from "../utils/utils";

const {
    TOKEN_ADDRESS,
    VOTING_ESCROW_ADDRESS,
    BOOST_DELEGATION_ADDRESS,
    BIG_HOLDER,
    VECRV_LOCKING_TIME,
    PAL_TOKEN_ADDRESS,
    PAL_HOLDER
} = require("../utils/constant");


chai.use(solidity);
const { expect } = chai;
const { provider } = ethers;

const WEEK = 7 * 86400;
const unit = ethers.utils.parseEther('1')
const BPS = 10000

let wardenFactory: ContractFactory
let multiBuyFactory: ContractFactory

const baseDropPerVote = ethers.utils.parseEther('0.005')
const minDropPerVote = ethers.utils.parseEther('0.001')

const targetPurchaseAmount = ethers.utils.parseEther('500000')


describe('Warden rewards tests - part 3', () => {
    

    let admin: SignerWithAddress
    let delegator1: SignerWithAddress
    let delegator2: SignerWithAddress
    let delegator3: SignerWithAddress
    let delegator4: SignerWithAddress
    let delegator5: SignerWithAddress
    let delegator6: SignerWithAddress
    let delegator7: SignerWithAddress
    let delegator8: SignerWithAddress
    let receiver: SignerWithAddress
    let receiver2: SignerWithAddress
    let externalUser: SignerWithAddress

    let warden: Warden
    let multiBuy: WardenMultiBuy

    let CRV: IERC20
    let veCRV: IVotingEscrow
    let delegationBoost: IVotingEscrowDelegation

    let rewardToken: IERC20

    const price_per_vote1 = BigNumber.from(8.25 * 1e10) // ~ 50CRV for a 1000 veCRV boost for a week
    const price_per_vote2 = BigNumber.from(41.25 * 1e10) // ~ 250CRV for a 1000 veCRV boost for a week
    const price_per_vote3 = BigNumber.from(16.5 * 1e10)
    const price_per_vote4 = BigNumber.from(16.5 * 1e8)
    const price_per_vote5 = BigNumber.from(12.375 * 1e10)
    const price_per_vote6 = BigNumber.from(8.25 * 1e11)
    const price_per_vote7 = BigNumber.from(41.25 * 1e10)
    const price_per_vote8 = BigNumber.from(33 * 1e10)

    const base_advised_price = BigNumber.from(7.25 * 1e10)

    const total_reward_amount = ethers.utils.parseEther('200000');

    before(async () => {
        await resetFork();

        [
            admin,
            delegator1,
            delegator2,
            delegator3,
            delegator4,
            delegator5,
            delegator6,
            delegator7,
            delegator8,
            receiver,
            receiver2,
            externalUser
        ] = await ethers.getSigners();

        wardenFactory = await ethers.getContractFactory("Warden");
        multiBuyFactory = await ethers.getContractFactory("WardenMultiBuy");

        const crv_amount = ethers.utils.parseEther('8000');
        const lock_amount = ethers.utils.parseEther('2000'); //change the lock amounts

        CRV = IERC20__factory.connect(TOKEN_ADDRESS, provider);

        veCRV = IVotingEscrow__factory.connect(VOTING_ESCROW_ADDRESS, provider);

        delegationBoost = IVotingEscrowDelegation__factory.connect(BOOST_DELEGATION_ADDRESS, provider);

        rewardToken = IERC20__factory.connect(PAL_TOKEN_ADDRESS, provider);

        await getERC20(admin, BIG_HOLDER, CRV, admin.address, crv_amount);

        await getERC20(admin, PAL_HOLDER, rewardToken, admin.address, ethers.utils.parseEther('25000000'));

        //split between all delegators
        await CRV.connect(admin).transfer(delegator1.address, ethers.utils.parseEther('200'));
        await CRV.connect(admin).transfer(delegator2.address, ethers.utils.parseEther('350'));
        await CRV.connect(admin).transfer(delegator3.address, ethers.utils.parseEther('275'));
        await CRV.connect(admin).transfer(delegator4.address, ethers.utils.parseEther('250'));
        await CRV.connect(admin).transfer(delegator5.address, ethers.utils.parseEther('100'));
        await CRV.connect(admin).transfer(delegator6.address, ethers.utils.parseEther('150'));
        await CRV.connect(admin).transfer(delegator7.address, ethers.utils.parseEther('500'));
        await CRV.connect(admin).transfer(delegator8.address, ethers.utils.parseEther('175'));

        await CRV.connect(delegator1).approve(veCRV.address, ethers.utils.parseEther('200'));
        await CRV.connect(delegator2).approve(veCRV.address, ethers.utils.parseEther('350'));
        await CRV.connect(delegator3).approve(veCRV.address, ethers.utils.parseEther('275'));
        await CRV.connect(delegator4).approve(veCRV.address, ethers.utils.parseEther('250'));
        await CRV.connect(delegator5).approve(veCRV.address, ethers.utils.parseEther('100'));
        await CRV.connect(delegator6).approve(veCRV.address, ethers.utils.parseEther('150'));
        await CRV.connect(delegator7).approve(veCRV.address, ethers.utils.parseEther('500'));
        await CRV.connect(delegator8).approve(veCRV.address, ethers.utils.parseEther('175'));

        const lock_time = (await ethers.provider.getBlock(ethers.provider.blockNumber)).timestamp + VECRV_LOCKING_TIME
        const one_week_lock_time = (await ethers.provider.getBlock(ethers.provider.blockNumber)).timestamp + Math.floor((86400 * 7) / (86400 * 7)) * (86400 * 7)

        await veCRV.connect(delegator1).create_lock(ethers.utils.parseEther('200'), lock_time);
        await veCRV.connect(delegator2).create_lock(ethers.utils.parseEther('350'), lock_time);
        await veCRV.connect(delegator3).create_lock(ethers.utils.parseEther('275'), lock_time);
        await veCRV.connect(delegator4).create_lock(ethers.utils.parseEther('250'), lock_time);
        await veCRV.connect(delegator5).create_lock(ethers.utils.parseEther('100'), one_week_lock_time);
        await veCRV.connect(delegator6).create_lock(ethers.utils.parseEther('150'), lock_time);
        await veCRV.connect(delegator7).create_lock(ethers.utils.parseEther('500'), lock_time);
        await veCRV.connect(delegator8).create_lock(ethers.utils.parseEther('175'), lock_time);

        await CRV.connect(admin).transfer(receiver.address, crv_amount.sub(lock_amount).sub(ethers.utils.parseEther('1000')));
        await CRV.connect(admin).transfer(receiver2.address, ethers.utils.parseEther('1000'));

    });


    beforeEach(async () => {

        warden = (await wardenFactory.connect(admin).deploy(
            CRV.address,
            veCRV.address,
            delegationBoost.address,
            500, //5%
            1000, //10%
            base_advised_price
        )) as Warden;
        await warden.deployed();

        multiBuy = (await multiBuyFactory.connect(admin).deploy(
            CRV.address,
            veCRV.address,
            delegationBoost.address,
            warden.address
        )) as WardenMultiBuy;
        await multiBuy.deployed();

        await delegationBoost.connect(delegator1).setApprovalForAll(warden.address, true);
        await delegationBoost.connect(delegator2).setApprovalForAll(warden.address, true);
        await delegationBoost.connect(delegator3).setApprovalForAll(warden.address, true);
        await delegationBoost.connect(delegator4).setApprovalForAll(warden.address, true);
        await delegationBoost.connect(delegator5).setApprovalForAll(warden.address, true);
        await delegationBoost.connect(delegator6).setApprovalForAll(warden.address, true);
        await delegationBoost.connect(delegator7).setApprovalForAll(warden.address, true);
        await delegationBoost.connect(delegator8).setApprovalForAll(warden.address, true);

        await warden.connect(delegator1).register(price_per_vote1, 10, 0, 2000, 10000, false);
        await warden.connect(delegator2).register(price_per_vote2, 8, 0, 1000, 8000, false);
        await warden.connect(delegator3).register(price_per_vote3, 9, 0, 1000, 10000, false);
        await warden.connect(delegator4).register(price_per_vote4, 11, 0, 1500, 9000, false);
        await warden.connect(delegator5).register(price_per_vote5, 7, 0, 1000, 10000, false);
        await warden.connect(delegator6).register(price_per_vote6, 8, 0, 5000, 5000, false);
        await warden.connect(delegator7).register(price_per_vote7, 10, 0, 2000, 10000, false);
        await warden.connect(delegator8).register(price_per_vote8, 9, 0, 1500, 7500, false);

        await CRV.connect(receiver).approve(multiBuy.address, ethers.constants.MaxUint256)

        await rewardToken.connect(admin).transfer(warden.address, total_reward_amount)

        await warden.connect(admin).startRewardDistribution(
            rewardToken.address,
            baseDropPerVote,
            minDropPerVote,
            targetPurchaseAmount
        )

        await advanceTime(WEEK)
    });

    describe('purchase multiple Boosts', async () => {

        const one_week = BigNumber.from(7 * 86400);
        const duration = 2

        const amount = ethers.utils.parseEther('700')
        
        const max_price = price_per_vote2

        const fee_amount = amount.mul(max_price).mul(one_week.mul(duration)).div(unit)

        const accepted_slippage = 10 // 0.1 %

        const minRequiredAmount = BigNumber.from(0)

        const preSorted_Offers_list = [7,8,1,4,6,2,5,3]

        it(' should write the correct PurchasedBoost structs', async () => {

            const buy_tx = await multiBuy.connect(receiver).preSortedMultiBuy(
                receiver.address,
                duration,
                amount,
                max_price,
                minRequiredAmount,
                fee_amount,
                accepted_slippage,
                false,
                preSorted_Offers_list
            )

            const tx_block = (await buy_tx).blockNumber

            const receipt = await buy_tx.wait()

            const iface = warden.interface;
            const topic = iface.getEventTopic('BoostPurchase')
            const buy_logs = receipt.logs.filter(x => x.topics.indexOf(topic) >= 0);
            const events = buy_logs.map((log) => (iface.parseLog(log)).args)

            let i = 0

            const current_period = await warden.currentPeriod()

            const period_index = await warden.periodRewardIndex(current_period)
            const period_drop = await warden.periodDropPerVote(current_period)

            const user_purchased_boosts = await warden.getUserPurchasedBoosts(receiver.address)

            const last_index = user_purchased_boosts.length

            // Get the users that emitted Boosts => Get the offers that have been used
            for(let e of events){

                let boost_delegator = e.delegator
                let boost_index = await warden.userIndex(boost_delegator)

                expect(boost_index.toNumber()).to.be.eq(preSorted_Offers_list[i])

                const delegator_balance = await veCRV.balanceOf(e.delegator, { blockTag: tx_block })
                const boost_amount = delegator_balance.mul(e.percent).div(10000)

                expect(boost_index.toNumber()).to.be.eq(preSorted_Offers_list[i])

                const expected_start_timestamp = BigNumber.from((await ethers.provider.getBlock(tx_block || 0)).timestamp)
                let expected_end_timestamp = current_period.add(WEEK * duration)
                if(expected_end_timestamp.sub(expected_start_timestamp).lt(BigNumber.from(duration).mul(WEEK))){
                    expected_end_timestamp = expected_end_timestamp.add(WEEK)
                }

                const expected_start_index = period_index.add(
                    period_drop.mul(expected_start_timestamp.sub(current_period)).div(WEEK)
                )

                const boost_purchased = await warden.purchasedBoosts(e.tokenId)

                expect(boost_purchased.amount).to.be.eq(boost_amount);
                expect(boost_purchased.startIndex).to.be.eq(expected_start_index);
                expect(boost_purchased.startTimestamp).to.be.eq(expected_start_timestamp);
                expect(boost_purchased.endTimestamp).to.be.eq(expected_end_timestamp);
                expect(boost_purchased.buyer).to.be.eq(receiver.address);
                expect(boost_purchased.claimed).to.be.false

                let purchase_index = last_index - (events.length - i)
                expect(user_purchased_boosts[purchase_index]).to.be.eq(e.tokenId)

                i++;

            }

            //close all the Boosts for next tests
            for(let e of events){
                await delegationBoost.connect(receiver).cancel_boost(e.tokenId)
            }
        });

    });

});