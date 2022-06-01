const hre = require("hardhat");
import { ethers, network } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { Warden } from "../../typechain/Warden";
import { IERC20 } from "../../typechain/IERC20";
import { IERC20__factory } from "../../typechain/factories/IERC20__factory";
import { IVotingEscrow } from "../../typechain/IVotingEscrow";
import { IVotingEscrowStateOracle } from "../../typechain/IVotingEscrowStateOracle";
import { IVotingEscrow__factory } from "../../typechain/factories/IVotingEscrow__factory";
import { IVotingEscrowDelegation } from "../../typechain/IVotingEscrowDelegation";
import { IVotingEscrowDelegation__factory } from "../../typechain/factories/IVotingEscrowDelegation__factory";
import { IVotingEscrowStateOracle__factory } from "../../typechain/factories/IVotingEscrowStateOracle__factory";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { ContractFactory } from "@ethersproject/contracts";
import { BigNumber } from "@ethersproject/bignumber";

import {
    advanceTime,
    getERC20,
    resetFork,
    getVeHolders,
    setBlockhash,
    setHolderSidechainBalance,
} from "../utils/utils";

require("dotenv").config();

const { CHAINID, TOKEN_ADDRESS, VOTING_ESCROW_ADDRESS, BOOST_DELEGATION_ADDRESS, BIG_HOLDER, VE_LOCKING_TIME, REWARD_TOKEN_ADDRESS, REWARD_HOLDER } = require("../utils/constants");



chai.use(solidity);
const { expect } = chai;
const { provider } = ethers;

const chainId = network.config.chainId;

const WEEK = 7 * 86400;
const UNIT = ethers.utils.parseEther('1')

let wardenFactory: ContractFactory

const baseDropPerVote = ethers.utils.parseEther('0.0005')
const minDropPerVote = ethers.utils.parseEther('0.0001')

const targetPurchaseAmount = ethers.utils.parseEther('5000')

let network_name = "Ethereum"
if (chainId === 137) network_name = "Polygon"
if (chainId === 43114) network_name = "Avalanche"
if (chainId === 250) network_name = "Fantom"
if (chainId === 10) network_name = "Optimism"
if (chainId === 42161) network_name = "Arbitrum"


describe('Warden rewards tests - part 2 - ' + network_name + ' version', () => {
    let admin: SignerWithAddress
    let reserveManager: SignerWithAddress
    let priceManager: SignerWithAddress
    let delegator: SignerWithAddress
    let receiver: SignerWithAddress
    let externalUser: SignerWithAddress

    let warden: Warden

    let feeToken: IERC20
    let veToken: IVotingEscrow
    let delegationBoost: IVotingEscrowDelegation

    let rewardToken: IERC20

    const price_per_vote = BigNumber.from(4.25 * 1e8)

    const base_advised_price = BigNumber.from(1.25 * 1e8)

    const total_reward_amount = ethers.utils.parseEther('20000');
    const expiry_time = 0 // so Warden will use the lock end instead

    const lock_amount = ethers.utils.parseEther('15000');

    before(async () => {
        await resetFork(chainId);

        [admin, reserveManager, priceManager, delegator, receiver, externalUser] = await ethers.getSigners();

        if(chainId !== 1){
            [delegator] = await getVeHolders(admin, 1)
        }

        wardenFactory = await ethers.getContractFactory("Warden");

        const fee_token_amount = ethers.utils.parseEther('35000');

        feeToken = IERC20__factory.connect(TOKEN_ADDRESS[chainId], provider);

        veToken = IVotingEscrow__factory.connect(VOTING_ESCROW_ADDRESS[chainId], provider);

        delegationBoost = IVotingEscrowDelegation__factory.connect(BOOST_DELEGATION_ADDRESS[chainId], provider);

        rewardToken = IERC20__factory.connect(REWARD_TOKEN_ADDRESS[chainId], provider);

        await getERC20(admin, BIG_HOLDER[chainId], feeToken, delegator.address, fee_token_amount);

        await getERC20(admin, REWARD_HOLDER[chainId], rewardToken, admin.address, ethers.utils.parseEther('2500000'));

        if (chainId === 1) {
            await feeToken.connect(delegator).approve(veToken.address, 0);
            await feeToken.connect(delegator).approve(veToken.address, ethers.constants.MaxUint256);
            const locked_balance = (await veToken.locked(delegator.address)).amount
            const lock_time = (await ethers.provider.getBlock(ethers.provider.blockNumber)).timestamp + VE_LOCKING_TIME
            if (locked_balance.eq(0)) {
                await veToken.connect(delegator).create_lock(lock_amount, lock_time);
            } else if (locked_balance.lt(lock_amount)) {
                await veToken.connect(delegator).increase_amount(lock_amount.sub(locked_balance));
                await veToken.connect(delegator).increase_unlock_time(lock_time);
            } else {
                await veToken.connect(delegator).increase_unlock_time(lock_time);
            }

            await feeToken.connect(delegator).transfer(receiver.address, fee_token_amount.sub(lock_amount));
        }
        else {
            let stateOracle: IVotingEscrowStateOracle
            stateOracle = IVotingEscrowStateOracle__factory.connect(VOTING_ESCROW_ADDRESS[chainId], provider);

            await setBlockhash(admin, stateOracle)

            await setHolderSidechainBalance(admin, stateOracle, delegator)

            await feeToken.connect(delegator).transfer(receiver.address, fee_token_amount);
        }

    })

    const resetVeLock = async (force: boolean = false) => {
        if (chainId !== 1) return

        const current_ts = BigNumber.from((await ethers.provider.getBlock(ethers.provider.blockNumber)).timestamp)
        const lock_time = (current_ts.add(VE_LOCKING_TIME)).div(WEEK).mul(WEEK)
        const current_unlock_time = await veToken.locked__end(delegator.address)

        if (current_unlock_time.lt(lock_time)) {
            const new_current_ts = (await ethers.provider.getBlock(ethers.provider.blockNumber)).timestamp
            if (current_unlock_time.lte(new_current_ts)) {
                await veToken.connect(delegator).withdraw()
                await veToken.connect(delegator).create_lock(lock_amount, (BigNumber.from(new_current_ts).add(VE_LOCKING_TIME)).div(WEEK).mul(WEEK));
            }
            else if (force) {
                await veToken.connect(delegator).increase_unlock_time(lock_time);
            }
        }
    }


    beforeEach(async () => {

        warden = (await wardenFactory.connect(admin).deploy(
            feeToken.address,
            veToken.address,
            delegationBoost.address,
            500, //5%
            1000, //10%
            base_advised_price
        )) as Warden;
        await warden.deployed();

        await delegationBoost.connect(delegator).setApprovalForAll(warden.address, true);

        await rewardToken.connect(admin).transfer(warden.address, total_reward_amount)

        await resetVeLock();

    });


    it(' should be deployed & have correct parameters', async () => {
        expect(warden.address).to.properAddress

        const warden_feeToken = await warden.feeToken();
        const warden_votingEscrow = await warden.votingEscrow();
        const warden_delegationBoost = await warden.delegationBoost();
        const warden_feeReserveRatio = await warden.feeReserveRatio();
        const warden_minPercRequired = await warden.minPercRequired();
        const warden_reserveAmount = await warden.reserveAmount();
        const warden_reserveManager = await warden.reserveManager();

        expect(warden_feeToken).to.be.eq(feeToken.address);
        expect(warden_votingEscrow).to.be.eq(veToken.address);
        expect(warden_delegationBoost).to.be.eq(delegationBoost.address);
        expect(warden_feeReserveRatio).to.be.eq(500);
        expect(warden_minPercRequired).to.be.eq(1000);
        expect(warden_reserveAmount).to.be.eq(0);
        expect(warden_reserveManager).to.be.eq(ethers.constants.AddressZero);

        // Since constructor created an ampty BoostOffer at index 0
        // to use index 0 as unregistered users in the userIndex mapping
        const warden_offersIndex = await warden.offersIndex();
        const warden_offers_0 = await warden.offers(0);

        expect(warden_offersIndex).to.be.eq(1);

        expect(warden_offers_0.user).to.be.eq(ethers.constants.AddressZero);
        expect(warden_offers_0.pricePerVote).to.be.eq(0);
        expect(warden_offers_0.minPerc).to.be.eq(0);
        expect(warden_offers_0.maxPerc).to.be.eq(0);

        expect(await warden.advisedPrice()).to.be.eq(base_advised_price);

        // Reward state:
        const warden_nextUpdatePeriod = await warden.nextUpdatePeriod();
        const warden_baseWeeklyDropPerVote = await warden.baseWeeklyDropPerVote();
        const warden_minWeeklyDropPerVote = await warden.minWeeklyDropPerVote();
        const warden_targetPurchaseAmount = await warden.targetPurchaseAmount();
        const warden_extraPaidPast = await warden.extraPaidPast();
        const warden_remainingRewardPastPeriod = await warden.remainingRewardPastPeriod();
        const warden_rewardToken = await warden.rewardToken();

        expect(warden_nextUpdatePeriod).to.be.eq(0);
        expect(warden_baseWeeklyDropPerVote).to.be.eq(0);
        expect(warden_minWeeklyDropPerVote).to.be.eq(0);
        expect(warden_targetPurchaseAmount).to.be.eq(0);
        expect(warden_extraPaidPast).to.be.eq(0);
        expect(warden_remainingRewardPastPeriod).to.be.eq(0);
        expect(warden_rewardToken).to.be.eq(ethers.constants.AddressZero);

        const current_block = await ethers.provider.getBlock(await ethers.provider.getBlockNumber())
        const current_period = BigNumber.from(current_block.timestamp).div(WEEK).mul(WEEK)

        expect(await warden.periodRewardIndex(current_period.sub(WEEK))).to.be.eq(0);
        expect(await warden.periodRewardIndex(current_period)).to.be.eq(0);
        expect(await warden.periodRewardIndex(current_period.add(WEEK))).to.be.eq(0);

        expect(await warden.periodDropPerVote(current_period.sub(WEEK))).to.be.eq(0);
        expect(await warden.periodDropPerVote(current_period)).to.be.eq(0);
        expect(await warden.periodDropPerVote(current_period.add(WEEK))).to.be.eq(0);

        expect(await warden.periodPurchasedAmount(current_period.sub(WEEK))).to.be.eq(0);
        expect(await warden.periodPurchasedAmount(current_period)).to.be.eq(0);
        expect(await warden.periodPurchasedAmount(current_period.add(WEEK))).to.be.eq(0);

        expect(await warden.periodEndPurchasedDecrease(current_period.sub(WEEK))).to.be.eq(0);
        expect(await warden.periodEndPurchasedDecrease(current_period)).to.be.eq(0);
        expect(await warden.periodEndPurchasedDecrease(current_period.add(WEEK))).to.be.eq(0);

        expect(await warden.periodPurchasedDecreaseChanges(current_period.sub(WEEK))).to.be.eq(0);
        expect(await warden.periodPurchasedDecreaseChanges(current_period)).to.be.eq(0);
        expect(await warden.periodPurchasedDecreaseChanges(current_period.add(WEEK))).to.be.eq(0);


        expect(await warden.getUserPurchasedBoosts(delegator.address)).to.be.empty

        expect(await warden.currentPeriod()).to.be.eq(current_period);

    });


    describe('purchase Boost', async () => {

        const min_perc = 2000
        const max_perc = 10000

        const max_duration = 10

        const buy_percent = 4000
        const duration = 2

        const buy_percent2 = 2500
        const duration2 = 3

        let fee_amount: BigNumber;

        const bruteForceBoostRewards = async (boostID: BigNumber) => {

            const boost_purchase = await warden.purchasedBoosts(boostID)

            const start_ts = boost_purchase.startTimestamp
            const end_ts = boost_purchase.endTimestamp

            const duration_seconds = end_ts.sub(start_ts)

            const boost_decrease = boost_purchase.amount.div(duration_seconds)

            let boost_amount = boost_purchase.amount

            let total_rewards = BigNumber.from(0)

            const start_period = start_ts.div(WEEK).mul(WEEK)

            const second_period = start_period.add(WEEK)

            const time_diff = second_period.sub(start_ts)

            let end_period_boost_amount = boost_amount.sub(boost_decrease.mul(time_diff))

            let period_boost_amount = end_period_boost_amount.add(boost_decrease.add(boost_decrease.mul(time_diff)).div(2))

            let rewards = (
                (await warden.periodRewardIndex(second_period)).sub(boost_purchase.startIndex)
            ).mul(period_boost_amount).div(UNIT)

            total_rewards = total_rewards.add(rewards)

            boost_amount = end_period_boost_amount

            for (let i = 0; i < duration_seconds.div(WEEK).toNumber(); i++) {

                let period = start_period.add(WEEK * (1 + i))

                let next_period = period.add(WEEK)

                let period_decrease = boost_decrease.mul(WEEK)

                end_period_boost_amount = boost_amount.sub(period_decrease)

                period_boost_amount = end_period_boost_amount.add(boost_decrease.add(period_decrease).div(2))

                rewards = (
                    (await warden.periodRewardIndex(next_period)).sub(await warden.periodRewardIndex(period))
                ).mul(period_boost_amount).div(UNIT)

                total_rewards = total_rewards.add(rewards)

                boost_amount = end_period_boost_amount

            }

            return total_rewards
        }

        beforeEach(async () => {

            await warden.connect(admin).startRewardDistribution(
                rewardToken.address,
                baseDropPerVote,
                minDropPerVote,
                targetPurchaseAmount
            )

            await warden.connect(delegator).register(price_per_vote, max_duration, expiry_time, min_perc, max_perc, false);

            await feeToken.connect(receiver).approve(warden.address, ethers.constants.MaxUint256)

            await advanceTime(WEEK)

        });

        it(' should write the correct PurchasedBoost struct', async () => {

            fee_amount = await warden.estimateFees(delegator.address, buy_percent, duration)
            const buy_tx = await warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, buy_percent, duration, fee_amount)
            const token_id = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1)
            );

            const current_period = await warden.currentPeriod()

            const period_index = await warden.periodRewardIndex(current_period)
            const period_drop = await warden.periodDropPerVote(current_period)

            const tx_block = (await buy_tx).blockNumber

            const delegator_balance = await veToken.balanceOf(delegator.address, { blockTag: tx_block })
            const boost_amount = delegator_balance.mul(buy_percent).div(10000)

            const expected_start_timestamp = BigNumber.from((await ethers.provider.getBlock(tx_block || 0)).timestamp)
            let expected_end_timestamp = current_period.add(WEEK * duration)
            if (expected_end_timestamp.sub(expected_start_timestamp).lt(BigNumber.from(duration).mul(WEEK))) {
                expected_end_timestamp = expected_end_timestamp.add(WEEK)
            }

            const expected_start_index = period_index.add(
                period_drop.mul(expected_start_timestamp.sub(current_period)).div(WEEK)
            )

            const boost_purchased = await warden.purchasedBoosts(token_id)

            expect(boost_purchased.amount).to.be.eq(boost_amount);
            expect(boost_purchased.startIndex).to.be.eq(expected_start_index);
            expect(boost_purchased.startTimestamp).to.be.eq(expected_start_timestamp);
            expect(boost_purchased.endTimestamp).to.be.eq(expected_end_timestamp);
            expect(boost_purchased.buyer).to.be.eq(receiver.address);
            expect(boost_purchased.claimed).to.be.false

            const user_purchased_boosts = await warden.getUserPurchasedBoosts(receiver.address)

            expect(user_purchased_boosts[user_purchased_boosts.length - 1]).to.be.eq(token_id)

            // Cancel Boost by receiver (so delegator is available for later tests)
            await delegationBoost.connect(receiver).cancel_boost(token_id)

        });

        it(' should update the periodPurchases mappings correctly', async () => {

            const current_period = await warden.currentPeriod()

            fee_amount = await warden.estimateFees(delegator.address, buy_percent, duration)
            const buy_tx = await warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, buy_percent, duration, fee_amount)
            const token_id = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1)
            );

            const tx_block = (await buy_tx).blockNumber

            const delegator_balance = await veToken.balanceOf(delegator.address, { blockTag: tx_block })
            const boost_amount = delegator_balance.mul(buy_percent).div(10000)

            const expected_start_timestamp = BigNumber.from((await ethers.provider.getBlock(tx_block || 0)).timestamp)
            let expected_end_timestamp = current_period.add(WEEK * duration)
            if (expected_end_timestamp.sub(expected_start_timestamp).lt(BigNumber.from(duration).mul(WEEK))) {
                expected_end_timestamp = expected_end_timestamp.add(WEEK)
            }

            const boost_weekly_decrease = boost_amount.mul(WEEK).div(expected_end_timestamp.sub(expected_start_timestamp))

            const next_period = current_period.add(WEEK)

            const first_period_decrease = boost_weekly_decrease.mul(next_period.sub(expected_start_timestamp)).div(WEEK)

            expect(await warden.periodPurchasedAmount(current_period)).to.be.eq(boost_amount);
            expect(await warden.periodEndPurchasedDecrease(current_period)).to.be.eq(first_period_decrease);
            expect(await warden.periodPurchasedDecreaseChanges(next_period)).to.be.eq(first_period_decrease);
            expect(await warden.periodEndPurchasedDecrease(next_period)).to.be.eq(boost_weekly_decrease);
            expect(await warden.periodPurchasedDecreaseChanges(expected_end_timestamp)).to.be.eq(boost_weekly_decrease);

            // Cancel Boost by receiver (so delegator is available for later tests)
            await delegationBoost.connect(receiver).cancel_boost(token_id)

        });

        it(' should give 0 rewards if the Boost is not expired', async () => {

            fee_amount = await warden.estimateFees(delegator.address, buy_percent, duration)
            await warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, buy_percent, duration, fee_amount)
            const token_id = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1)
            );

            expect(await warden.getBoostReward(token_id)).to.be.eq(0)

            // Cancel Boost by receiver (so delegator is available for later tests)
            await delegationBoost.connect(receiver).cancel_boost(token_id)

        });

        it(' should give 0 rewards if the period is not updated', async () => {

            fee_amount = await warden.estimateFees(delegator.address, buy_percent, duration)
            await warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, buy_percent, duration, fee_amount)
            const token_id = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1)
            );

            await advanceTime(WEEK * (duration + 2))

            await expect(
                warden.getBoostReward(token_id)
            ).to.be.revertedWith('RewardsNotUpdated')

            // Cancel Boost by receiver (so delegator is available for later tests)
            await delegationBoost.connect(receiver).cancel_boost(token_id)

        });

        it(' should gives the correct amount of rewards', async () => {

            fee_amount = await warden.estimateFees(delegator.address, buy_percent, duration)
            await warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, buy_percent, duration, fee_amount)
            const token_id = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1)
            );

            await advanceTime(WEEK * (duration + 2))

            await warden.connect(admin).updateRewardState()

            const expected_rewards = await bruteForceBoostRewards(token_id)

            expect(await warden.getBoostReward(token_id)).to.be.eq(expected_rewards)

            // Cancel Boost by receiver (so delegator is available for later tests)
            await delegationBoost.connect(receiver).cancel_boost(token_id)

        });

        it(' should give the correct amount of rewards for 2 Boosts (same start period)', async () => {

            fee_amount = await warden.estimateFees(delegator.address, buy_percent, duration)
            await warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, buy_percent, duration, fee_amount)
            const token_id = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1)
            );

            fee_amount = await warden.estimateFees(delegator.address, buy_percent, duration)

            await feeToken.connect(receiver).transfer(externalUser.address, fee_amount)

            await feeToken.connect(externalUser).approve(warden.address, ethers.constants.MaxUint256)

            await warden.connect(externalUser).buyDelegationBoost(delegator.address, externalUser.address, buy_percent2, duration2, fee_amount)
            const token_id2 = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1)
            );

            await advanceTime(WEEK * (duration2 + 2))

            await warden.connect(admin).updateRewardState()

            const expected_rewards = await bruteForceBoostRewards(token_id)

            expect(await warden.getBoostReward(token_id)).to.be.eq(expected_rewards)

            const expected_rewards2 = await bruteForceBoostRewards(token_id2)

            expect(await warden.getBoostReward(token_id2)).to.be.eq(expected_rewards2)

            // Cancel Boost by receiver (so delegator is available for later tests)
            await delegationBoost.connect(receiver).cancel_boost(token_id)
            await delegationBoost.connect(externalUser).cancel_boost(token_id2)


            // check on a period it is the same than calculated as to distribute
            const boost1 = await warden.purchasedBoosts(token_id)
            const boost2 = await warden.purchasedBoosts(token_id2)


            const start_period = boost1.startTimestamp.div(WEEK).mul(WEEK)
            const target_period = start_period.add(WEEK)

            const target_period_distributed_amount = (await warden.periodPurchasedAmount(target_period)).mul(
                await warden.periodDropPerVote(target_period)
            ).div(UNIT)

            const boost1_amount_decrease = boost1.amount.div(boost1.endTimestamp.sub(boost1.startTimestamp))

            const boost1_start_target_period_amount = boost1.amount.sub(boost1_amount_decrease.mul(target_period.sub(boost1.startTimestamp)))
            const boost1_end_target_period_amount = boost1_start_target_period_amount.sub(boost1_amount_decrease.mul(WEEK))

            const boost1_target_period_amount = boost1_end_target_period_amount.add(boost1_amount_decrease.add(boost1_amount_decrease.mul(WEEK)).div(2))

            const boost1_target_period_reward = (
                (await warden.periodRewardIndex(target_period.add(WEEK))).sub(await warden.periodRewardIndex(target_period))
            ).mul(boost1_target_period_amount).div(UNIT)


            const boost2_amount_decrease = boost2.amount.div(boost2.endTimestamp.sub(boost2.startTimestamp))

            const boost2_start_target_period_amount = boost2.amount.sub(boost2_amount_decrease.mul(target_period.sub(boost2.startTimestamp)))
            const boost2_end_target_period_amount = boost2_start_target_period_amount.sub(boost2_amount_decrease.mul(WEEK))

            const boost2_target_period_amount = boost2_end_target_period_amount.add(boost2_amount_decrease.add(boost2_amount_decrease.mul(WEEK)).div(2))

            const boost2_target_period_reward = (
                (await warden.periodRewardIndex(target_period.add(WEEK))).sub(await warden.periodRewardIndex(target_period))
            ).mul(boost2_target_period_amount).div(UNIT)

            expect(boost1_target_period_reward.add(boost2_target_period_reward)).to.be.lte(target_period_distributed_amount)

        });

        it(' should give the correct amount of rewards for 2 Boosts (different start period)', async () => {

            fee_amount = await warden.estimateFees(delegator.address, buy_percent, duration)
            await warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, buy_percent, duration, fee_amount)
            const token_id = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1)
            );

            await advanceTime(WEEK)

            fee_amount = await warden.estimateFees(delegator.address, buy_percent, duration)

            await feeToken.connect(receiver).transfer(externalUser.address, fee_amount)

            await feeToken.connect(externalUser).approve(warden.address, ethers.constants.MaxUint256)

            await warden.connect(externalUser).buyDelegationBoost(delegator.address, externalUser.address, buy_percent2, duration2, fee_amount)
            const token_id2 = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1)
            );

            await advanceTime(WEEK * (duration2 + 2))

            await warden.connect(admin).updateRewardState()

            const expected_rewards = await bruteForceBoostRewards(token_id)

            expect(await warden.getBoostReward(token_id)).to.be.eq(expected_rewards)

            const expected_rewards2 = await bruteForceBoostRewards(token_id2)

            expect(await warden.getBoostReward(token_id2)).to.be.eq(expected_rewards2)

            // Cancel Boost by receiver (so delegator is available for later tests)
            await delegationBoost.connect(receiver).cancel_boost(token_id)
            await delegationBoost.connect(externalUser).cancel_boost(token_id2)

        });

        it(' should set the periodPurchases back to 0 after Boost is over (1 Boost)', async () => {

            const buy_duration = 4

            fee_amount = await warden.estimateFees(delegator.address, buy_percent, buy_duration)
            await warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, buy_percent, buy_duration, fee_amount)
            const token_id = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1)
            );

            const current_ts = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp

            const end_timestamp = (await warden.purchasedBoosts(token_id)).endTimestamp

            await advanceTime(end_timestamp.sub(current_ts).add(WEEK).toNumber())

            await warden.updateRewardState()

            expect(await warden.periodPurchasedAmount(end_timestamp.add(WEEK))).to.be.lte(10);
            expect(await warden.periodEndPurchasedDecrease(end_timestamp.add(WEEK))).to.be.lte(0);

            // Cancel Boost by receiver (so delegator is available for later tests)
            await delegationBoost.connect(receiver).cancel_boost(token_id)

        });


        it(' should set the periodPurchases back to 0 after Boost is over (2 Boost)', async () => {

            fee_amount = await warden.estimateFees(delegator.address, buy_percent, duration)
            await warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, buy_percent, duration, fee_amount)
            const token_id = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1)
            );

            await advanceTime(WEEK)

            fee_amount = await warden.estimateFees(delegator.address, buy_percent, duration)

            await feeToken.connect(receiver).transfer(externalUser.address, fee_amount)

            await feeToken.connect(externalUser).approve(warden.address, ethers.constants.MaxUint256)

            await warden.connect(externalUser).buyDelegationBoost(delegator.address, externalUser.address, buy_percent2, duration2, fee_amount)
            const token_id2 = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1)
            );

            const current_ts = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp

            const end_timestamp = (await warden.purchasedBoosts(token_id2)).endTimestamp

            await advanceTime(end_timestamp.sub(current_ts).add(WEEK).toNumber())

            await warden.updateRewardState()

            expect(await warden.periodPurchasedAmount(end_timestamp.add(WEEK))).to.be.lte(10);
            expect(await warden.periodPurchasedDecreaseChanges(end_timestamp.add(WEEK))).to.be.eq(0);


            // Cancel Boost by receiver (so delegator is available for later tests)
            await delegationBoost.connect(receiver).cancel_boost(token_id)
            await delegationBoost.connect(externalUser).cancel_boost(token_id2)

        });

    });


    describe('claim rewards', async () => {

        const min_perc = 2000
        const max_perc = 10000

        const max_duration = 10

        const buy_percent = 3500
        const duration = 2

        const buy_percent2 = 2000
        const duration2 = 3

        let fee_amount: BigNumber;

        let token_id: BigNumber;

        beforeEach(async () => {

            await warden.connect(admin).startRewardDistribution(
                rewardToken.address,
                baseDropPerVote,
                minDropPerVote,
                targetPurchaseAmount
            )
            await resetVeLock(true)

            await warden.connect(delegator).register(price_per_vote, max_duration, expiry_time, min_perc, max_perc, false);

            await feeToken.connect(receiver).approve(warden.address, ethers.constants.MaxUint256)

            await advanceTime(WEEK)

            fee_amount = await warden.estimateFees(delegator.address, buy_percent, duration)
            await warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, buy_percent, duration, fee_amount)
            token_id = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1)
            );

            await advanceTime(WEEK * (duration + 2))

            await warden.connect(admin).updateRewardState()

            // Cancel Boost by receiver (so delegator is available for later tests)
            await delegationBoost.connect(receiver).cancel_boost(token_id)

        });

        it(' should send the rewards correctly', async () => {

            const old_user_balance = await rewardToken.balanceOf(receiver.address)
            const old_warden_balance = await rewardToken.balanceOf(warden.address)

            const reward_amount = await warden.getBoostReward(token_id)

            const claim_tx = await warden.connect(receiver).claimBoostReward(token_id)

            await expect(claim_tx)
                .to.emit(warden, 'ClaimReward')
                .withArgs(token_id, receiver.address, reward_amount);

            const new_user_balance = await rewardToken.balanceOf(receiver.address)
            const new_warden_balance = await rewardToken.balanceOf(warden.address)

            expect(new_user_balance).to.be.eq(old_user_balance.add(reward_amount))
            expect(new_warden_balance).to.be.eq(old_warden_balance.sub(reward_amount))

            expect(
                (await warden.purchasedBoosts(token_id)).claimed
            ).to.be.true

        });

        it(' should not allow to claim the rewards twice', async () => {

            await warden.connect(receiver).claimBoostReward(token_id)

            await expect(
                warden.connect(receiver).claimBoostReward(token_id)
            ).to.be.revertedWith('AlreadyClaimed');

        });

        it(' should block if caller is not he buyer', async () => {

            await expect(
                warden.connect(externalUser).claimBoostReward(token_id)
            ).to.be.revertedWith('NotBoostBuyer');

        });

        it(' should fail if no rewards for the Boost', async () => {

            await expect(
                warden.connect(receiver).claimBoostReward(token_id.add(5))
            ).to.be.revertedWith('BoostRewardsNull');

        });

        it(' should fail the Boost is not expired yet', async () => {

            await advanceTime(WEEK)

            fee_amount = await warden.estimateFees(delegator.address, buy_percent, duration)

            await feeToken.connect(receiver).transfer(externalUser.address, fee_amount)

            await feeToken.connect(externalUser).approve(warden.address, ethers.constants.MaxUint256)

            await warden.connect(externalUser).buyDelegationBoost(delegator.address, externalUser.address, buy_percent2, duration2, fee_amount)
            const token_id2 = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1)
            );

            await expect(
                warden.connect(externalUser).claimBoostReward(token_id2)
            ).to.be.revertedWith('CannotClaim');

            // Cancel Boost by receiver (so delegator is available for later tests)
            await delegationBoost.connect(externalUser).cancel_boost(token_id2)

        });

        it(' should update the reward state and allow to claim', async () => {

            await advanceTime(WEEK)

            fee_amount = await warden.estimateFees(delegator.address, buy_percent, duration)

            await feeToken.connect(receiver).transfer(externalUser.address, fee_amount)

            await feeToken.connect(externalUser).approve(warden.address, ethers.constants.MaxUint256)

            await warden.connect(externalUser).buyDelegationBoost(delegator.address, externalUser.address, buy_percent2, duration2, fee_amount)
            const token_id2 = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1)
            );

            await advanceTime(WEEK * (duration2 + 2))

            const prev_balance = await rewardToken.balanceOf(externalUser.address)

            const claim_tx = await warden.connect(externalUser).claimBoostReward(token_id2)

            const new_balance = await rewardToken.balanceOf(externalUser.address)

            const amount_received = new_balance.sub(prev_balance)

            await expect(claim_tx)
                .to.emit(warden, 'ClaimReward')
                .withArgs(token_id2, externalUser.address, amount_received);

            // Cancel Boost by receiver (so delegator is available for later tests)
            await delegationBoost.connect(externalUser).cancel_boost(token_id2)

        });

        it(' should do a multi claim for multiple boosts', async () => {

            await advanceTime(WEEK)

            fee_amount = await warden.estimateFees(delegator.address, buy_percent, duration)

            await warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, buy_percent2, duration2, fee_amount)
            const token_id2 = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1)
            );

            await advanceTime(WEEK * (duration2 + 2))

            await warden.connect(admin).updateRewardState()

            const old_user_balance = await rewardToken.balanceOf(receiver.address)
            const old_warden_balance = await rewardToken.balanceOf(warden.address)

            const reward_amount = await warden.getBoostReward(token_id)
            const reward_amount2 = await warden.getBoostReward(token_id2)

            const claim_tx = await warden.connect(receiver).claimMultipleBoostReward(
                [token_id, token_id2]
            )

            await expect(claim_tx)
                .to.emit(warden, 'ClaimReward')
                .withArgs(token_id, receiver.address, reward_amount);

            await expect(claim_tx)
                .to.emit(warden, 'ClaimReward')
                .withArgs(token_id2, receiver.address, reward_amount2);

            const new_user_balance = await rewardToken.balanceOf(receiver.address)
            const new_warden_balance = await rewardToken.balanceOf(warden.address)

            expect(new_user_balance).to.be.eq(old_user_balance.add(reward_amount.add(reward_amount2)))
            expect(new_warden_balance).to.be.eq(old_warden_balance.sub(reward_amount.add(reward_amount2)))

            expect(
                (await warden.purchasedBoosts(token_id)).claimed
            ).to.be.true

            expect(
                (await warden.purchasedBoosts(token_id2)).claimed
            ).to.be.true

            // Cancel Boost by receiver (so delegator is available for later tests)
            await delegationBoost.connect(externalUser).cancel_boost(token_id2)

        });

    });


    describe('Admin functions', async () => {

        const new_baseDropPerVote = ethers.utils.parseEther('0.00025')
        const bad_baseDropPerVote = ethers.utils.parseEther('0.00005')

        const new_minDropPerVote = ethers.utils.parseEther('0.0001')
        const bad_minDropPerVote = ethers.utils.parseEther('0.01')

        const new_targetPurchaseAmount = ethers.utils.parseEther('750000')

        describe('setBaseWeeklyDropPerVote', async () => {

            beforeEach(async () => {

                await warden.connect(admin).startRewardDistribution(
                    rewardToken.address,
                    baseDropPerVote,
                    minDropPerVote,
                    targetPurchaseAmount
                )

            });

            it(' should update the parameter correctly', async () => {

                await warden.connect(admin).setBaseWeeklyDropPerVote(new_baseDropPerVote)

                expect(await warden.baseWeeklyDropPerVote()).to.be.eq(new_baseDropPerVote)

            });

            it(' should fail if given incorrect parameters', async () => {

                await expect(
                    warden.connect(admin).setBaseWeeklyDropPerVote(0)
                ).to.be.reverted

                await expect(
                    warden.connect(admin).setBaseWeeklyDropPerVote(bad_baseDropPerVote)
                ).to.be.reverted

            });

            it(' should only be callable by admin', async () => {

                await expect(
                    warden.connect(delegator).setBaseWeeklyDropPerVote(new_baseDropPerVote)
                ).to.be.revertedWith('Ownable: caller is not the owner')

            });

        });

        describe('setMinWeeklyDropPerVote', async () => {

            beforeEach(async () => {

                await warden.connect(admin).startRewardDistribution(
                    rewardToken.address,
                    baseDropPerVote,
                    minDropPerVote,
                    targetPurchaseAmount
                )

            });

            it(' should update the parameter correctly', async () => {

                await warden.connect(admin).setMinWeeklyDropPerVote(new_minDropPerVote)

                expect(await warden.minWeeklyDropPerVote()).to.be.eq(new_minDropPerVote)

            });

            it(' should fail if given incorrect parameters', async () => {

                await expect(
                    warden.connect(admin).setMinWeeklyDropPerVote(0)
                ).to.be.reverted

                await expect(
                    warden.connect(admin).setMinWeeklyDropPerVote(bad_minDropPerVote)
                ).to.be.reverted

            });

            it(' should only be callable by admin', async () => {

                await expect(
                    warden.connect(delegator).setMinWeeklyDropPerVote(new_minDropPerVote)
                ).to.be.revertedWith('Ownable: caller is not the owner')

            });

        });

        describe('setTargetPurchaseAmount', async () => {

            beforeEach(async () => {

                await warden.connect(admin).startRewardDistribution(
                    rewardToken.address,
                    baseDropPerVote,
                    minDropPerVote,
                    targetPurchaseAmount
                )

            });

            it(' should update the parameter correctly', async () => {

                await warden.connect(admin).setTargetPurchaseAmount(new_targetPurchaseAmount)

                expect(await warden.targetPurchaseAmount()).to.be.eq(new_targetPurchaseAmount)

            });

            it(' should fail if given incorrect parameters', async () => {

                await expect(
                    warden.connect(admin).setTargetPurchaseAmount(0)
                ).to.be.reverted

            });

            it(' should only be callable by admin', async () => {

                await expect(
                    warden.connect(delegator).setTargetPurchaseAmount(new_targetPurchaseAmount)
                ).to.be.revertedWith('Ownable: caller is not the owner')

            });

        });

    });

});