const hre = require("hardhat");
import { ethers, waffle } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { Warden } from "../../typechain/Warden";
import { IERC20 } from "../../typechain/IERC20";
import { IERC20__factory } from "../../typechain/factories/IERC20__factory";
import { IVotingEscrow } from "../../typechain/IVotingEscrow";
import { IVotingEscrow__factory } from "../../typechain/factories/IVotingEscrow__factory";
import { IVotingEscrowDelegation } from "../../typechain/IVotingEscrowDelegation";
import { IVotingEscrowDelegation__factory } from "../../typechain/factories/IVotingEscrowDelegation__factory";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { ContractFactory } from "@ethersproject/contracts";
import { BigNumber } from "@ethersproject/bignumber";

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
const UNIT =ethers.utils.parseEther('1')

let wardenFactory: ContractFactory

const baseDropPerVote = ethers.utils.parseEther('0.005')
const minDropPerVote = ethers.utils.parseEther('0.001')

const targetPurchaseAmount = ethers.utils.parseEther('500000')


describe('Warden rewards tests', () => {
    let admin: SignerWithAddress
    let reserveManager: SignerWithAddress
    let priceManager: SignerWithAddress
    let delegator: SignerWithAddress
    let receiver: SignerWithAddress
    let externalUser: SignerWithAddress

    let warden: Warden

    let CRV: IERC20
    let veCRV: IVotingEscrow
    let delegationBoost: IVotingEscrowDelegation

    let rewardToken: IERC20

    const price_per_vote = BigNumber.from(8.25 * 1e10) // ~ 50CRV for a 1000 veCRV boost for a week

    const base_advised_price = BigNumber.from(1.25 * 1e10)

    const total_reward_amount = ethers.utils.parseEther('20000');

    before(async () => {
        await resetFork();

        [admin, reserveManager, priceManager, delegator, receiver, externalUser] = await ethers.getSigners();

        wardenFactory = await ethers.getContractFactory("Warden");

        const crv_amount = ethers.utils.parseEther('4000000');
        const lock_amount = ethers.utils.parseEther('2500000');

        CRV = IERC20__factory.connect(TOKEN_ADDRESS, provider);

        veCRV = IVotingEscrow__factory.connect(VOTING_ESCROW_ADDRESS, provider);

        delegationBoost = IVotingEscrowDelegation__factory.connect(BOOST_DELEGATION_ADDRESS, provider);

        rewardToken = IERC20__factory.connect(PAL_TOKEN_ADDRESS, provider);

        await getERC20(admin, BIG_HOLDER, CRV, delegator.address, crv_amount);

        await getERC20(admin, PAL_HOLDER, rewardToken, admin.address, ethers.utils.parseEther('2500000'));

        await CRV.connect(delegator).approve(veCRV.address, 0);
        await CRV.connect(delegator).approve(veCRV.address, crv_amount);
        const locked_balance = (await veCRV.locked(delegator.address)).amount
        const lock_time = (await ethers.provider.getBlock(ethers.provider.blockNumber)).timestamp + VECRV_LOCKING_TIME
        if (locked_balance.eq(0)) {
            await veCRV.connect(delegator).create_lock(lock_amount, lock_time);
        } else if (locked_balance.lt(lock_amount)) {
            await veCRV.connect(delegator).increase_amount(lock_amount.sub(locked_balance));
            await veCRV.connect(delegator).increase_unlock_time(lock_time);
        } else {
            await veCRV.connect(delegator).increase_unlock_time(lock_time);
        }

        await CRV.connect(delegator).transfer(receiver.address, crv_amount.sub(lock_amount));

    })


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

        await delegationBoost.connect(delegator).setApprovalForAll(warden.address, true);

        await rewardToken.connect(admin).transfer(warden.address, total_reward_amount)
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

        expect(warden_feeToken).to.be.eq(CRV.address);
        expect(warden_votingEscrow).to.be.eq(veCRV.address);
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


    describe('rewards not initialized', async () => {

        const min_perc = 2000
        const max_perc = 10000

        const max_duration = 10

        const buy_percent = 5000
        const duration = 2

        let fee_amount: BigNumber;

        beforeEach(async () => {

            await CRV.connect(receiver).approve(warden.address, ethers.constants.MaxUint256)

        });

        it(' should not update the reward state', async () => {

            await warden.connect(delegator).updateRewardState()

            expect(await warden.nextUpdatePeriod()).to.be.eq(0);
            expect(await warden.extraPaidPast()).to.be.eq(0);
            expect(await warden.remainingRewardPastPeriod()).to.be.eq(0);

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

        });

        it(' should not update the reward state through other methods', async () => {

            await warden.connect(delegator).register(price_per_vote, max_duration, min_perc, max_perc, false);

            let current_block = await ethers.provider.getBlock(await ethers.provider.getBlockNumber())
            let current_period = BigNumber.from(current_block.timestamp).div(WEEK).mul(WEEK)

            expect(await warden.nextUpdatePeriod()).to.be.eq(0);
            expect(await warden.extraPaidPast()).to.be.eq(0);
            expect(await warden.remainingRewardPastPeriod()).to.be.eq(0);

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

            fee_amount = await warden.estimateFees(delegator.address, buy_percent, duration)
            await warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, buy_percent, duration, fee_amount)
            const token_id = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1)
            );

            expect(await warden.nextUpdatePeriod()).to.be.eq(0);
            expect(await warden.extraPaidPast()).to.be.eq(0);
            expect(await warden.remainingRewardPastPeriod()).to.be.eq(0);

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

            await advanceTime(WEEK * 2)
            await warden.connect(delegator)["claim()"]()

            current_block = await ethers.provider.getBlock(await ethers.provider.getBlockNumber())
            current_period = BigNumber.from(current_block.timestamp).div(WEEK).mul(WEEK)

            expect(await warden.nextUpdatePeriod()).to.be.eq(0);
            expect(await warden.extraPaidPast()).to.be.eq(0);
            expect(await warden.remainingRewardPastPeriod()).to.be.eq(0);

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

            await warden.connect(delegator).quit()

            expect(await warden.nextUpdatePeriod()).to.be.eq(0);
            expect(await warden.extraPaidPast()).to.be.eq(0);
            expect(await warden.remainingRewardPastPeriod()).to.be.eq(0);

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

            // Cancel Boost by receiver (so delegator is available for later tests)
            await delegationBoost.connect(receiver).cancel_boost(token_id)

        });

        it(' should not write Boost Purchases', async () => {

            await warden.connect(delegator).register(price_per_vote, max_duration, min_perc, max_perc, false);

            fee_amount = await warden.estimateFees(delegator.address, buy_percent, duration)
            
            await warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, buy_percent, duration, fee_amount)
            
            const token_id = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1)
            );

            const current_block = await ethers.provider.getBlock(await ethers.provider.getBlockNumber())
            const current_period = BigNumber.from(current_block.timestamp).div(WEEK).mul(WEEK)

            const boost_purchase = await warden.purchasedBoosts(token_id)

            expect(boost_purchase.amount).to.be.eq(0);
            expect(boost_purchase.startIndex).to.be.eq(0);
            expect(boost_purchase.startTimestamp).to.be.eq(0);
            expect(boost_purchase.endTimestamp).to.be.eq(0);

            expect(boost_purchase.buyer).to.be.eq(ethers.constants.AddressZero);

            expect(boost_purchase.claimed).to.be.false

            expect(await warden.periodPurchasedAmount(current_period)).to.be.eq(0);

            expect(await warden.periodEndPurchasedDecrease(current_period.add(WEEK))).to.be.eq(0);

            expect(await warden.periodPurchasedDecreaseChanges(boost_purchase.endTimestamp)).to.be.eq(0);

        });

        it(' should block claims', async () => {

            await expect(
                warden.connect(receiver).claimBoostReward(12)
            ).to.be.revertedWith('Warden: reward not started')

        });

    });


    describe('startRewardDistribution', async () => {

        it(' should set the correct parameters', async () => {

            await warden.connect(admin).startRewardDistribution(
                rewardToken.address,
                baseDropPerVote,
                minDropPerVote,
                targetPurchaseAmount
            )

            const current_block = await ethers.provider.getBlock(await ethers.provider.getBlockNumber())
            const current_period = BigNumber.from(current_block.timestamp).div(WEEK).mul(WEEK)

            const start_period = current_period.add(WEEK)

            expect(await warden.nextUpdatePeriod()).to.be.eq(start_period);
            expect(await warden.extraPaidPast()).to.be.eq(0);
            expect(await warden.remainingRewardPastPeriod()).to.be.eq(0);

            expect(await warden.baseWeeklyDropPerVote()).to.be.eq(baseDropPerVote);
            expect(await warden.minWeeklyDropPerVote()).to.be.eq(minDropPerVote);
            expect(await warden.targetPurchaseAmount()).to.be.eq(targetPurchaseAmount);

            expect(await warden.rewardToken()).to.be.eq(rewardToken.address);

            expect(await warden.periodRewardIndex(current_period.sub(WEEK))).to.be.eq(0);
            expect(await warden.periodRewardIndex(current_period)).to.be.eq(0);
            expect(await warden.periodRewardIndex(current_period.add(WEEK))).to.be.eq(0);

            expect(await warden.periodDropPerVote(current_period.sub(WEEK))).to.be.eq(0);
            expect(await warden.periodDropPerVote(current_period)).to.be.eq(0);
            expect(await warden.periodDropPerVote(start_period)).to.be.eq(baseDropPerVote);

            expect(await warden.periodPurchasedAmount(current_period.sub(WEEK))).to.be.eq(0);
            expect(await warden.periodPurchasedAmount(current_period)).to.be.eq(0);
            expect(await warden.periodPurchasedAmount(current_period.add(WEEK))).to.be.eq(0);

            expect(await warden.periodEndPurchasedDecrease(current_period.sub(WEEK))).to.be.eq(0);
            expect(await warden.periodEndPurchasedDecrease(current_period)).to.be.eq(0);
            expect(await warden.periodEndPurchasedDecrease(current_period.add(WEEK))).to.be.eq(0);

            expect(await warden.periodPurchasedDecreaseChanges(current_period.sub(WEEK))).to.be.eq(0);
            expect(await warden.periodPurchasedDecreaseChanges(current_period)).to.be.eq(0);
            expect(await warden.periodPurchasedDecreaseChanges(current_period.add(WEEK))).to.be.eq(0);

        });

        it(' should only allow to initialize once', async () => {

            await warden.connect(admin).startRewardDistribution(
                rewardToken.address,
                baseDropPerVote,
                minDropPerVote,
                targetPurchaseAmount
            )

            await expect(
                warden.connect(admin).startRewardDistribution(
                    rewardToken.address,
                    baseDropPerVote,
                    minDropPerVote,
                    targetPurchaseAmount
                )
            ).to.be.revertedWith('Warden: already started')

        });

        it(' should only be callable by admin', async () => {

            await expect(
                warden.connect(delegator).startRewardDistribution(
                    rewardToken.address,
                    baseDropPerVote,
                    minDropPerVote,
                    targetPurchaseAmount
                )
            ).to.be.revertedWith('Ownable: caller is not the owner')

        });

        it(' should allow to update the period', async () => {

            const current_block = await ethers.provider.getBlock(await ethers.provider.getBlockNumber())
            const current_period = BigNumber.from(current_block.timestamp).div(WEEK).mul(WEEK)

            await warden.connect(admin).startRewardDistribution(
                rewardToken.address,
                baseDropPerVote,
                minDropPerVote,
                targetPurchaseAmount
            )

            await advanceTime(WEEK * 2) //1 to get to the period start, 1 to go to the next period to update

            await warden.connect(admin).updateRewardState()

            const start_period = current_period.add(WEEK)
            const next_period = start_period.add(WEEK)

            expect(await warden.currentPeriod()).to.be.eq(next_period);

            const undistributed_rewards = targetPurchaseAmount.mul(baseDropPerVote).div(UNIT)
            
            expect(await warden.nextUpdatePeriod()).to.be.eq(next_period);
            expect(await warden.extraPaidPast()).to.be.eq(0);
            expect(await warden.remainingRewardPastPeriod()).to.be.eq(undistributed_rewards);

            const weekly_drop = targetPurchaseAmount.mul(baseDropPerVote).div(UNIT)
            const estimated_drop = weekly_drop.add(undistributed_rewards).mul(UNIT).div(targetPurchaseAmount)

            expect(await warden.periodDropPerVote(start_period)).to.be.eq(baseDropPerVote);
            expect(await warden.periodDropPerVote(next_period)).to.be.eq(estimated_drop);

            expect(await warden.periodRewardIndex(start_period)).to.be.eq(0);
            expect(await warden.periodRewardIndex(next_period)).to.be.eq(
                (await warden.periodRewardIndex(start_period)).add(baseDropPerVote)
            );

            expect(await warden.periodPurchasedAmount(start_period)).to.be.eq(0);
            expect(await warden.periodPurchasedAmount(next_period)).to.be.eq(0);

            expect(await warden.periodEndPurchasedDecrease(start_period)).to.be.eq(0);
            expect(await warden.periodEndPurchasedDecrease(next_period)).to.be.eq(0);

            expect(await warden.periodPurchasedDecreaseChanges(start_period)).to.be.eq(0);
            expect(await warden.periodPurchasedDecreaseChanges(next_period)).to.be.eq(0);

        });

    });


    describe('updateRewardState', async () => {
        
        const min_perc = 2000
        const max_perc = 10000

        const max_duration = 10

        const buy_percent = 5000
        const duration = 2

        let fee_amount: BigNumber;

        beforeEach(async () => {

            await warden.connect(admin).startRewardDistribution(
                rewardToken.address,
                baseDropPerVote,
                minDropPerVote,
                targetPurchaseAmount
            )

            await CRV.connect(receiver).approve(warden.address, ethers.constants.MaxUint256)

            await advanceTime(WEEK)

        });

        it(' update 1 period', async () => {

            const current_block = await ethers.provider.getBlock(await ethers.provider.getBlockNumber())
            const current_period = BigNumber.from(current_block.timestamp).div(WEEK).mul(WEEK)

            await advanceTime(WEEK)

            await warden.connect(admin).updateRewardState()

            const next_period = current_period.add(WEEK)

            expect(await warden.currentPeriod()).to.be.eq(next_period);

            const undistributed_rewards = targetPurchaseAmount.mul(baseDropPerVote).div(UNIT)
            
            expect(await warden.nextUpdatePeriod()).to.be.eq(next_period);
            expect(await warden.extraPaidPast()).to.be.eq(0);
            expect(await warden.remainingRewardPastPeriod()).to.be.eq(undistributed_rewards);

            const weekly_drop = targetPurchaseAmount.mul(baseDropPerVote).div(UNIT)
            const estimated_drop = weekly_drop.add(undistributed_rewards).mul(UNIT).div(targetPurchaseAmount)

            expect(await warden.periodDropPerVote(current_period)).to.be.eq(baseDropPerVote);
            expect(await warden.periodDropPerVote(next_period)).to.be.eq(estimated_drop);

            expect(await warden.periodRewardIndex(current_period)).to.be.eq(0);
            expect(await warden.periodRewardIndex(next_period)).to.be.eq(
                (await warden.periodRewardIndex(current_period)).add(baseDropPerVote)
            );

        });

        it(' update 2 period', async () => {

            const current_block = await ethers.provider.getBlock(await ethers.provider.getBlockNumber())
            const current_period = BigNumber.from(current_block.timestamp).div(WEEK).mul(WEEK)

            await advanceTime(WEEK * 2)

            await warden.connect(admin).updateRewardState()

            const next_period = current_period.add(WEEK)
            const next_period2 = current_period.add(WEEK * 2)

            expect(await warden.currentPeriod()).to.be.eq(next_period2);

            const undistributed_rewards = targetPurchaseAmount.mul(baseDropPerVote).div(UNIT).mul(2)
            
            expect(await warden.nextUpdatePeriod()).to.be.eq(next_period2);
            expect(await warden.extraPaidPast()).to.be.eq(0);
            expect(await warden.remainingRewardPastPeriod()).to.be.eq(undistributed_rewards);

            const weekly_drop = targetPurchaseAmount.mul(baseDropPerVote).div(UNIT)
            const estimated_drop = weekly_drop.add(weekly_drop).mul(UNIT).div(targetPurchaseAmount)
            const estimated_drop2 = weekly_drop.add(undistributed_rewards).mul(UNIT).div(targetPurchaseAmount)

            expect(await warden.periodDropPerVote(current_period)).to.be.eq(baseDropPerVote);
            expect(await warden.periodDropPerVote(next_period)).to.be.eq(estimated_drop);
            expect(await warden.periodDropPerVote(next_period2)).to.be.eq(estimated_drop2);

            expect(await warden.periodRewardIndex(current_period)).to.be.eq(0);
            expect(await warden.periodRewardIndex(next_period)).to.be.eq(
                (await warden.periodRewardIndex(current_period)).add(baseDropPerVote)
            );
            expect(await warden.periodRewardIndex(next_period2)).to.be.eq(
                (await warden.periodRewardIndex(next_period)).add(estimated_drop)
            );

        });

        it(' update 10 periods', async () => {

            const current_block = await ethers.provider.getBlock(await ethers.provider.getBlockNumber())
            const current_period = BigNumber.from(current_block.timestamp).div(WEEK).mul(WEEK)

            await advanceTime(WEEK * 10)

            await warden.connect(admin).updateRewardState()

            expect(await warden.currentPeriod()).to.be.eq(current_period.add(WEEK * 10));
            
            expect(await warden.nextUpdatePeriod()).to.be.eq(current_period.add(WEEK * 10));

            let period = current_period
            let next_period = period.add(WEEK)

            let prev_index = BigNumber.from(0)
            let prev_drop_per_vote = baseDropPerVote

            let undistributed_amount = BigNumber.from(0)
            let extra_paid = BigNumber.from(0)

            const weekly_drop = targetPurchaseAmount.mul(baseDropPerVote).div(UNIT)

            for(let i = 0; i < 10; i++){

                undistributed_amount = undistributed_amount.add(targetPurchaseAmount.mul(baseDropPerVote).div(UNIT)) 

                const estimated_drop = weekly_drop.add(undistributed_amount).mul(UNIT).div(targetPurchaseAmount)

                expect(await warden.periodDropPerVote(period)).to.be.eq(prev_drop_per_vote);
                expect(await warden.periodDropPerVote(next_period)).to.be.eq(estimated_drop);

                expect(await warden.periodRewardIndex(period)).to.be.eq(prev_index);
                expect(await warden.periodRewardIndex(next_period)).to.be.eq(
                    (prev_index).add(prev_drop_per_vote)
                );

                prev_index = (prev_index).add(prev_drop_per_vote)
                prev_drop_per_vote = estimated_drop

                period = next_period
                next_period = period.add(WEEK)

            }
            
            expect(await warden.extraPaidPast()).to.be.eq(extra_paid);
            expect(await warden.remainingRewardPastPeriod()).to.be.eq(undistributed_amount);


        });

        it(' only updates 100 periods at a time', async () => {

            const current_block = await ethers.provider.getBlock(await ethers.provider.getBlockNumber())
            const current_period = BigNumber.from(current_block.timestamp).div(WEEK).mul(WEEK)

            await advanceTime(WEEK * 150)

            await warden.connect(admin).updateRewardState()

            expect(await warden.currentPeriod()).to.be.eq(current_period.add(WEEK * 150));

            let period = current_period
            let next_period = period.add(WEEK)

            let prev_index = BigNumber.from(0)
            let prev_drop_per_vote = baseDropPerVote

            let undistributed_amount = BigNumber.from(0)
            let extra_paid = BigNumber.from(0)

            const weekly_drop = targetPurchaseAmount.mul(baseDropPerVote).div(UNIT)
            
            expect(await warden.nextUpdatePeriod()).to.be.eq(current_period.add(WEEK * 100));

            for(let i = 0; i < 100; i++){

                undistributed_amount = undistributed_amount.add(targetPurchaseAmount.mul(baseDropPerVote).div(UNIT)) 

                const estimated_drop = weekly_drop.add(undistributed_amount).mul(UNIT).div(targetPurchaseAmount)

                expect(await warden.periodDropPerVote(period)).to.be.eq(prev_drop_per_vote);
                expect(await warden.periodDropPerVote(next_period)).to.be.eq(estimated_drop);

                expect(await warden.periodRewardIndex(period)).to.be.eq(prev_index);
                expect(await warden.periodRewardIndex(next_period)).to.be.eq(
                    (prev_index).add(prev_drop_per_vote)
                );

                prev_index = (prev_index).add(prev_drop_per_vote)
                prev_drop_per_vote = estimated_drop

                period = next_period
                next_period = period.add(WEEK)

            }
            
            expect(await warden.extraPaidPast()).to.be.eq(extra_paid);
            expect(await warden.remainingRewardPastPeriod()).to.be.eq(undistributed_amount);

            // check the 101 & 102 are not updated
            expect(await warden.periodDropPerVote(next_period.add(WEEK))).to.be.eq(0);
            expect(await warden.periodDropPerVote(next_period.add(WEEK * 2))).to.be.eq(0);

            expect(await warden.periodRewardIndex(next_period.add(WEEK))).to.be.eq(0);
            expect(await warden.periodRewardIndex(next_period.add(WEEK * 2))).to.be.eq(0);


            await warden.connect(admin).updateRewardState()
            
            expect(await warden.nextUpdatePeriod()).to.be.eq(current_period.add(WEEK * 150));

            for(let i = 0; i < 50; i++){

                undistributed_amount = undistributed_amount.add(targetPurchaseAmount.mul(baseDropPerVote).div(UNIT)) 

                const estimated_drop = weekly_drop.add(undistributed_amount).mul(UNIT).div(targetPurchaseAmount)

                expect(await warden.periodDropPerVote(period)).to.be.eq(prev_drop_per_vote);
                expect(await warden.periodDropPerVote(next_period)).to.be.eq(estimated_drop);

                expect(await warden.periodRewardIndex(period)).to.be.eq(prev_index);
                expect(await warden.periodRewardIndex(next_period)).to.be.eq(
                    (prev_index).add(prev_drop_per_vote)
                );

                prev_index = (prev_index).add(prev_drop_per_vote)
                prev_drop_per_vote = estimated_drop

                period = next_period
                next_period = period.add(WEEK)

            }
            
            expect(await warden.extraPaidPast()).to.be.eq(extra_paid);
            expect(await warden.remainingRewardPastPeriod()).to.be.eq(undistributed_amount);

        });

        it(' should also be updated by other methods', async () => {

            const current_block = await ethers.provider.getBlock(await ethers.provider.getBlockNumber())
            const current_period = BigNumber.from(current_block.timestamp).div(WEEK).mul(WEEK)

            await advanceTime(WEEK)

            let period = current_period
            let next_period = period.add(WEEK)

            let prev_index = BigNumber.from(0)
            let prev_drop_per_vote = baseDropPerVote

            let undistributed_amount = BigNumber.from(0)
            let extra_paid = BigNumber.from(0)

            let estimated_drop = BigNumber.from(0)
            let period_purchased_amount = BigNumber.from(0)

            const weekly_drop = targetPurchaseAmount.mul(baseDropPerVote).div(UNIT)

            await warden.connect(delegator).register(price_per_vote, max_duration, min_perc, max_perc, false);

            undistributed_amount = undistributed_amount.add(targetPurchaseAmount.mul(baseDropPerVote).div(UNIT)) 

            estimated_drop = weekly_drop.add(undistributed_amount).mul(UNIT).div(targetPurchaseAmount)

            expect(await warden.periodDropPerVote(period)).to.be.eq(prev_drop_per_vote);
            expect(await warden.periodDropPerVote(next_period)).to.be.eq(estimated_drop);

            expect(await warden.periodRewardIndex(period)).to.be.eq(prev_index);
            expect(await warden.periodRewardIndex(next_period)).to.be.eq(
                (prev_index).add(prev_drop_per_vote)
            );

            prev_index = (prev_index).add(prev_drop_per_vote)
            prev_drop_per_vote = estimated_drop

            period = next_period
            next_period = period.add(WEEK)
            
            expect(await warden.extraPaidPast()).to.be.eq(extra_paid);
            expect(await warden.remainingRewardPastPeriod()).to.be.eq(undistributed_amount);

            await advanceTime(WEEK)

            fee_amount = await warden.estimateFees(delegator.address, buy_percent, duration)
            const buy_tx = await warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, buy_percent, duration, fee_amount)
            const token_id = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1)
            );

            period_purchased_amount = (await warden.periodPurchasedAmount(period)).mul(prev_drop_per_vote).div(UNIT)

            if(period_purchased_amount.lte(weekly_drop)){
                let not_disitrubted = weekly_drop.sub(period_purchased_amount)

                if(!extra_paid.eq(0)){
                    if(not_disitrubted.gte(extra_paid)){
                        not_disitrubted = not_disitrubted.sub(extra_paid)
                        extra_paid = BigNumber.from(0)
                    }
                    else{
                        extra_paid = extra_paid.sub(not_disitrubted)
                        not_disitrubted = BigNumber.from(0)
                    }
                }
                undistributed_amount = undistributed_amount.add(not_disitrubted)
            } else {
                let extra_disitrubted = period_purchased_amount.sub(weekly_drop)

                if(!undistributed_amount.eq(0)){
                    if(extra_disitrubted.gte(undistributed_amount)){
                        extra_disitrubted = extra_disitrubted.sub(undistributed_amount)
                        undistributed_amount = BigNumber.from(0)
                    }
                    else{
                        undistributed_amount = undistributed_amount.sub(extra_disitrubted)
                        extra_disitrubted = BigNumber.from(0)
                    }
                }
                extra_paid = extra_paid.add(extra_disitrubted)
            }

            estimated_drop = weekly_drop.add(undistributed_amount).sub(extra_paid).mul(UNIT).div(targetPurchaseAmount)

            expect(await warden.periodDropPerVote(period)).to.be.eq(prev_drop_per_vote);
            expect(await warden.periodDropPerVote(next_period)).to.be.eq(estimated_drop);

            expect(await warden.periodRewardIndex(period)).to.be.eq(prev_index);
            expect(await warden.periodRewardIndex(next_period)).to.be.eq(
                (prev_index).add(prev_drop_per_vote)
            );

            prev_index = (prev_index).add(prev_drop_per_vote)
            prev_drop_per_vote = estimated_drop

            period = next_period
            next_period = period.add(WEEK)
            
            expect(await warden.extraPaidPast()).to.be.eq(extra_paid);
            expect(await warden.remainingRewardPastPeriod()).to.be.eq(undistributed_amount);

            await advanceTime(WEEK)

            await warden.connect(delegator)["claim()"]()

            period_purchased_amount = (await warden.periodPurchasedAmount(period)).mul(prev_drop_per_vote).div(UNIT)

            if(period_purchased_amount.lte(weekly_drop)){
                let not_disitrubted = weekly_drop.sub(period_purchased_amount)

                if(!extra_paid.eq(0)){
                    if(not_disitrubted.gte(extra_paid)){
                        not_disitrubted = not_disitrubted.sub(extra_paid)
                        extra_paid = BigNumber.from(0)
                    }
                    else{
                        extra_paid = extra_paid.sub(not_disitrubted)
                        not_disitrubted = BigNumber.from(0)
                    }
                }
                undistributed_amount = undistributed_amount.add(not_disitrubted)
            } else {
                let extra_disitrubted = period_purchased_amount.sub(weekly_drop)

                if(!undistributed_amount.eq(0)){
                    if(extra_disitrubted.gte(undistributed_amount)){
                        extra_disitrubted = extra_disitrubted.sub(undistributed_amount)
                        undistributed_amount = BigNumber.from(0)
                    }
                    else{
                        undistributed_amount = undistributed_amount.sub(extra_disitrubted)
                        extra_disitrubted = BigNumber.from(0)
                    }
                }
                extra_paid = extra_paid.add(extra_disitrubted)
            }

            estimated_drop = weekly_drop.add(undistributed_amount).sub(extra_paid).mul(UNIT).div(targetPurchaseAmount)

            expect(await warden.periodDropPerVote(period)).to.be.eq(prev_drop_per_vote);
            expect(await warden.periodDropPerVote(next_period)).to.be.eq(estimated_drop);

            expect(await warden.periodRewardIndex(period)).to.be.eq(prev_index);
            expect(await warden.periodRewardIndex(next_period)).to.be.eq(
                (prev_index).add(prev_drop_per_vote)
            );

            prev_index = (prev_index).add(prev_drop_per_vote)
            prev_drop_per_vote = estimated_drop

            period = next_period
            next_period = period.add(WEEK)
            
            expect(await warden.extraPaidPast()).to.be.eq(extra_paid);
            expect(await warden.remainingRewardPastPeriod()).to.be.eq(undistributed_amount);

            await advanceTime(WEEK)

            await warden.connect(delegator).quit()

            period_purchased_amount = (await warden.periodPurchasedAmount(period)).mul(prev_drop_per_vote).div(UNIT)

            if(period_purchased_amount.lte(weekly_drop)){
                let not_disitrubted = weekly_drop.sub(period_purchased_amount)

                if(!extra_paid.eq(0)){
                    if(not_disitrubted.gte(extra_paid)){
                        not_disitrubted = not_disitrubted.sub(extra_paid)
                        extra_paid = BigNumber.from(0)
                    }
                    else{
                        extra_paid = extra_paid.sub(not_disitrubted)
                        not_disitrubted = BigNumber.from(0)
                    }
                }
                undistributed_amount = undistributed_amount.add(not_disitrubted)
            } else {
                let extra_disitrubted = period_purchased_amount.sub(weekly_drop)

                if(!undistributed_amount.eq(0)){
                    if(extra_disitrubted.gte(undistributed_amount)){
                        extra_disitrubted = extra_disitrubted.sub(undistributed_amount)
                        undistributed_amount = BigNumber.from(0)
                    }
                    else{
                        undistributed_amount = undistributed_amount.sub(extra_disitrubted)
                        extra_disitrubted = BigNumber.from(0)
                    }
                }
                extra_paid = extra_paid.add(extra_disitrubted)
            }

            estimated_drop = weekly_drop.add(undistributed_amount).sub(extra_paid).mul(UNIT).div(targetPurchaseAmount)

            expect(await warden.periodDropPerVote(period)).to.be.eq(prev_drop_per_vote);
            expect(await warden.periodDropPerVote(next_period)).to.be.eq(estimated_drop);

            expect(await warden.periodRewardIndex(period)).to.be.eq(prev_index);
            expect(await warden.periodRewardIndex(next_period)).to.be.eq(
                (prev_index).add(prev_drop_per_vote)
            );

            prev_index = (prev_index).add(prev_drop_per_vote)
            prev_drop_per_vote = estimated_drop

            period = next_period
            next_period = period.add(WEEK)
            
            expect(await warden.extraPaidPast()).to.be.eq(extra_paid);
            expect(await warden.remainingRewardPastPeriod()).to.be.eq(undistributed_amount);

            // Cancel Boost by receiver (so delegator is available for later tests)
            await delegationBoost.connect(receiver).cancel_boost(token_id)

        });

    });


    describe('drop per period updates', async () => {
        
        const min_perc = 1000
        const max_perc = 10000

        const max_duration = 10

        let fee_amount: BigNumber;

        const new_targetPurchaseAmount = ethers.utils.parseEther('150000')

        beforeEach(async () => {

            await warden.connect(admin).startRewardDistribution(
                rewardToken.address,
                baseDropPerVote,
                minDropPerVote,
                new_targetPurchaseAmount
            )

            await warden.connect(delegator).register(price_per_vote, max_duration, min_perc, max_perc, false);

            await CRV.connect(receiver).approve(warden.address, ethers.constants.MaxUint256)

            await advanceTime(WEEK)

        });

        it(' if too much bought, reduce the drop per vote', async () => {

            const objective_amount = await warden.targetPurchaseAmount()

            const current_remaining = await warden.remainingRewardPastPeriod()
            const current_extra = await warden.extraPaidPast()

            const needed_amount = objective_amount.add(objective_amount.div(2)).add(current_remaining).sub(current_extra)

            const delegator_balance = await veCRV.balanceOf(delegator.address)

            const buy_percent = needed_amount.mul(10000).div(delegator_balance)
            const duration = 3

            const current_period = await warden.currentPeriod()

            fee_amount = await warden.estimateFees(delegator.address, buy_percent, duration)
            await warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, buy_percent, duration, fee_amount)
            const token_id = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1)
            );

            const real_boost_amount = (await warden.purchasedBoosts(token_id)).amount

            const weekly_drop = objective_amount.mul(
                await warden.baseWeeklyDropPerVote()
            ).div(UNIT)
            const over_paid_amount = real_boost_amount.mul(await warden.periodDropPerVote(current_period)).div(UNIT).sub(weekly_drop)

            const expected_new_drop = weekly_drop.add(current_remaining).sub(current_extra).sub(over_paid_amount).mul(UNIT).div(objective_amount)

            await advanceTime(WEEK)

            await warden.connect(admin).updateRewardState()

            expect(await warden.periodDropPerVote(current_period.add(WEEK))).to.be.eq(expected_new_drop)

            // Cancel Boost by receiver (so delegator is available for later tests)
            await delegationBoost.connect(receiver).cancel_boost(token_id)

        });

        it(' if way too much bought, use the minDropPerVote', async () => {

            const objective_amount = await warden.targetPurchaseAmount()

            const current_remaining = await warden.remainingRewardPastPeriod()
            const current_extra = await warden.extraPaidPast()

            const needed_amount = objective_amount.add(objective_amount).add(current_remaining).sub(current_extra)

            const delegator_balance = await veCRV.balanceOf(delegator.address)

            const buy_percent = needed_amount.mul(10000).div(delegator_balance)
            const duration = 3

            const current_period = await warden.currentPeriod()

            fee_amount = await warden.estimateFees(delegator.address, buy_percent, duration)
            await warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, buy_percent, duration, fee_amount)
            const token_id = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1)
            );

            await advanceTime(WEEK)

            await warden.connect(admin).updateRewardState()

            expect(await warden.periodDropPerVote(current_period.add(WEEK))).to.be.eq(
                await warden.minWeeklyDropPerVote()
            )

            // Cancel Boost by receiver (so delegator is available for later tests)
            await delegationBoost.connect(receiver).cancel_boost(token_id)

        });

        it(' if not enough, increase the drop per vote', async () => {

            const objective_amount = await warden.targetPurchaseAmount()

            const current_remaining = await warden.remainingRewardPastPeriod()
            const current_extra = await warden.extraPaidPast()

            const needed_amount = objective_amount.sub(objective_amount.div(2)).add(current_remaining).sub(current_extra)

            const delegator_balance = await veCRV.balanceOf(delegator.address)

            const buy_percent = needed_amount.mul(10000).div(delegator_balance)
            const duration = 3

            const current_period = await warden.currentPeriod()

            fee_amount = await warden.estimateFees(delegator.address, buy_percent, duration)
            await warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, buy_percent, duration, fee_amount)
            const token_id = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1)
            );

            const real_boost_amount = (await warden.purchasedBoosts(token_id)).amount

            const weekly_drop = objective_amount.mul(
                await warden.baseWeeklyDropPerVote()
            ).div(UNIT)
            const under_paid_amount = weekly_drop.sub(real_boost_amount.mul(await warden.periodDropPerVote(current_period)).div(UNIT))

            const expected_new_drop = weekly_drop.add(current_remaining).sub(current_extra).add(under_paid_amount).mul(UNIT).div(objective_amount)

            await advanceTime(WEEK)

            await warden.connect(admin).updateRewardState()

            expect(await warden.periodDropPerVote(current_period.add(WEEK))).to.be.eq(expected_new_drop)

            // Cancel Boost by receiver (so delegator is available for later tests)
            await delegationBoost.connect(receiver).cancel_boost(token_id)

        });

        it(' under objective then over objective', async () => {

            const objective_amount = await warden.targetPurchaseAmount()

            let current_remaining = await warden.remainingRewardPastPeriod()
            let current_extra = await warden.extraPaidPast()

            let current_period = await warden.currentPeriod()
            let current_purchased_amount = await warden.periodPurchasedAmount(current_period)

            let needed_amount = objective_amount.div(4).sub(current_extra)

            let delegator_balance = await veCRV.balanceOf(delegator.address)

            let buy_percent = needed_amount.mul(10000).div(delegator_balance)
            let duration = 2

            fee_amount = await warden.estimateFees(delegator.address, buy_percent, duration)
            await warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, buy_percent, duration, fee_amount)
            const token_id = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1)
            );

            let real_boost_amount = (await warden.purchasedBoosts(token_id)).amount

            let weekly_drop = objective_amount.mul(
                await warden.baseWeeklyDropPerVote()
            ).div(UNIT)

            let under_paid_amount = weekly_drop.sub(real_boost_amount.mul(await warden.periodDropPerVote(current_period)).div(UNIT))

            let expected_new_drop = weekly_drop.add(current_remaining).sub(current_extra).add(under_paid_amount).mul(UNIT).div(objective_amount)

            await advanceTime(WEEK)

            await warden.connect(admin).updateRewardState()

            expect(await warden.periodDropPerVote(current_period.add(WEEK))).to.be.eq(expected_new_drop)

            // -----------------------------------------------------------------------------

            current_remaining = await warden.remainingRewardPastPeriod()
            current_extra = await warden.extraPaidPast()

            needed_amount = objective_amount.add(
                objective_amount.div(10)
            ).add(current_remaining).sub(current_extra)

            delegator_balance = await veCRV.balanceOf(delegator.address)

            buy_percent = needed_amount.mul(10000).div(delegator_balance)
            duration = 3

            current_period = await warden.currentPeriod()
            current_purchased_amount = await warden.periodPurchasedAmount(current_period)

            fee_amount = await warden.estimateFees(delegator.address, buy_percent, duration)
            await warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, buy_percent, duration, fee_amount)
            const token_id2 = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1)
            );

            real_boost_amount = (await warden.purchasedBoosts(token_id2)).amount

            weekly_drop = objective_amount.mul(
                await warden.baseWeeklyDropPerVote()
            ).div(UNIT)
            const over_paid_amount = real_boost_amount.add(current_purchased_amount).mul(await warden.periodDropPerVote(current_period)).div(UNIT).sub(weekly_drop)

            expected_new_drop = weekly_drop.add(current_remaining).sub(current_extra).sub(over_paid_amount).mul(UNIT).div(objective_amount)

            await advanceTime(WEEK)

            await warden.connect(admin).updateRewardState()

            expect(await warden.periodDropPerVote(current_period.add(WEEK))).to.be.eq(expected_new_drop)

            // Cancel Boost by receiver (so delegator is available for later tests)
            await delegationBoost.connect(receiver).cancel_boost(token_id)
            await delegationBoost.connect(receiver).cancel_boost(token_id2)

        });

        it(' over objective then under objective', async () => {

            const objective_amount = await warden.targetPurchaseAmount()

            let current_remaining = await warden.remainingRewardPastPeriod()
            let current_extra = await warden.extraPaidPast()

            let needed_amount = objective_amount.div(2).add(current_remaining).sub(current_extra)

            let delegator_balance = await veCRV.balanceOf(delegator.address)

            let buy_percent = needed_amount.mul(10000).div(delegator_balance)
            let duration = 2

            let current_period = await warden.currentPeriod()

            fee_amount = await warden.estimateFees(delegator.address, buy_percent, duration)
            await warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, buy_percent, duration, fee_amount)
            const token_id = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1)
            );

            let real_boost_amount = (await warden.purchasedBoosts(token_id)).amount

            let weekly_drop = objective_amount.mul(
                await warden.baseWeeklyDropPerVote()
            ).div(UNIT)
            let under_paid_amount = weekly_drop.sub(real_boost_amount.mul(await warden.periodDropPerVote(current_period)).div(UNIT))

            let expected_new_drop = weekly_drop.add(current_remaining).sub(current_extra).add(under_paid_amount).mul(UNIT).div(objective_amount)

            await advanceTime(WEEK)

            await warden.connect(admin).updateRewardState()

            expect(await warden.periodDropPerVote(current_period.add(WEEK))).to.be.eq(expected_new_drop)

            // -----------------------------------------------------------------------------

            current_remaining = await warden.remainingRewardPastPeriod()
            current_extra = await warden.extraPaidPast()

            current_period = await warden.currentPeriod()
            const current_purchased_amount = await warden.periodPurchasedAmount(current_period)

            weekly_drop = objective_amount.mul(
                await warden.baseWeeklyDropPerVote()
            ).div(UNIT)
            const over_paid_amount = current_purchased_amount.mul(await warden.periodDropPerVote(current_period)).div(UNIT).sub(weekly_drop)

            expected_new_drop = weekly_drop.add(current_remaining).sub(current_extra).sub(over_paid_amount).mul(UNIT).div(objective_amount)

            await advanceTime(WEEK)

            await warden.connect(admin).updateRewardState()

            expect(await warden.periodDropPerVote(current_period.add(WEEK))).to.be.eq(expected_new_drop)

            // Cancel Boost by receiver (so delegator is available for later tests)
            await delegationBoost.connect(receiver).cancel_boost(token_id)

        });

    });

});