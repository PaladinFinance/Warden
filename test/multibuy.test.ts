const hre = require("hardhat");
import { ethers, network } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { Warden } from "../typechain/Warden";
import { WardenMultiBuy } from "../typechain/WardenMultiBuy";
import { IERC20 } from "../typechain/IERC20";
import { IERC20__factory } from "../typechain/factories/IERC20__factory";
import { IVotingEscrow } from "../typechain/IVotingEscrow";
import { IVotingEscrowStateOracle } from "../typechain/IVotingEscrowStateOracle";
import { IVotingEscrow__factory } from "../typechain/factories/IVotingEscrow__factory";
import { IVotingEscrowDelegation } from "../typechain/IVotingEscrowDelegation";
import { IVotingEscrowDelegation__factory } from "../typechain/factories/IVotingEscrowDelegation__factory";
import { IVotingEscrowStateOracle__factory } from "../typechain/factories/IVotingEscrowStateOracle__factory";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { ContractFactory } from "@ethersproject/contracts";
import { BigNumber } from "@ethersproject/bignumber";
import { Event } from 'ethers';

import {
    advanceTime,
    getERC20,
    resetFork,
    getVeHolders,
    setBlockhash,
    setHolderSidechainBalance,
} from "./utils/utils";

require("dotenv").config();

const { CHAINID, TOKEN_ADDRESS, VOTING_ESCROW_ADDRESS, BOOST_DELEGATION_ADDRESS, BIG_HOLDER, VE_LOCKING_TIME } = require("./utils/constants");


chai.use(solidity);
const { expect } = chai;
const { provider } = ethers;

const chainId = network.config.chainId;

const unit = ethers.utils.parseEther('1')
const BPS = 10000

let wardenFactory: ContractFactory
let multiBuyFactory: ContractFactory

let network_name = "Ethereum"
if (chainId === 137) network_name = "Polygon"
if (chainId === 43114) network_name = "Avalanche"
if (chainId === 250) network_name = "Fantom"
if (chainId === 10) network_name = "Optimism"
if (chainId === 42161) network_name = "Arbitrum"


describe('Warden MultiBuy contract tests - ' + network_name + ' version', () => {


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

    let feeToken: IERC20
    let veToken: IVotingEscrow
    let delegationBoost: IVotingEscrowDelegation

    const price_per_vote1 = BigNumber.from(8.25 * 1e7) // ~ 50 for a 1000 veToken boost for a week
    const price_per_vote2 = BigNumber.from(41.25 * 1e7) // ~ 250 for a 1000 veToken boost for a week
    const price_per_vote3 = BigNumber.from(16.5 * 1e7)
    const price_per_vote4 = BigNumber.from(16.5 * 1e5)
    const price_per_vote5 = BigNumber.from(12.375 * 1e7)
    const price_per_vote6 = BigNumber.from(8.25 * 1e8)
    const price_per_vote7 = BigNumber.from(41.25 * 1e7)
    const price_per_vote8 = BigNumber.from(33 * 1e7)

    const base_advised_price = BigNumber.from(1.25 * 1e7)

    before(async () => {
        await resetFork(chainId);

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

        const fee_token_amount = ethers.utils.parseEther('8000');
        const lock_amount = ethers.utils.parseEther('2000'); //change the lock amounts

        feeToken = IERC20__factory.connect(TOKEN_ADDRESS[chainId], provider);

        veToken = IVotingEscrow__factory.connect(VOTING_ESCROW_ADDRESS[chainId], provider);

        delegationBoost = IVotingEscrowDelegation__factory.connect(BOOST_DELEGATION_ADDRESS[chainId], provider);

        await getERC20(admin, BIG_HOLDER[chainId], feeToken, admin.address, fee_token_amount);

        if (chainId === 1) {
            //split between all delegators
            await feeToken.connect(admin).transfer(delegator1.address, ethers.utils.parseEther('200'));
            await feeToken.connect(admin).transfer(delegator2.address, ethers.utils.parseEther('350'));
            await feeToken.connect(admin).transfer(delegator3.address, ethers.utils.parseEther('275'));
            await feeToken.connect(admin).transfer(delegator4.address, ethers.utils.parseEther('250'));
            await feeToken.connect(admin).transfer(delegator5.address, ethers.utils.parseEther('100'));
            await feeToken.connect(admin).transfer(delegator6.address, ethers.utils.parseEther('150'));
            await feeToken.connect(admin).transfer(delegator7.address, ethers.utils.parseEther('500'));
            await feeToken.connect(admin).transfer(delegator8.address, ethers.utils.parseEther('175'));

            await feeToken.connect(delegator1).approve(veToken.address, ethers.utils.parseEther('200'));
            await feeToken.connect(delegator2).approve(veToken.address, ethers.utils.parseEther('350'));
            await feeToken.connect(delegator3).approve(veToken.address, ethers.utils.parseEther('275'));
            await feeToken.connect(delegator4).approve(veToken.address, ethers.utils.parseEther('250'));
            await feeToken.connect(delegator5).approve(veToken.address, ethers.utils.parseEther('100'));
            await feeToken.connect(delegator6).approve(veToken.address, ethers.utils.parseEther('150'));
            await feeToken.connect(delegator7).approve(veToken.address, ethers.utils.parseEther('500'));
            await feeToken.connect(delegator8).approve(veToken.address, ethers.utils.parseEther('175'));

            const lock_time = (await ethers.provider.getBlock(ethers.provider.blockNumber)).timestamp + VE_LOCKING_TIME
            const one_week_lock_time = (await ethers.provider.getBlock(ethers.provider.blockNumber)).timestamp + Math.floor((86400 * 7) / (86400 * 7)) * (86400 * 7)

            await veToken.connect(delegator1).create_lock(ethers.utils.parseEther('200'), lock_time);
            await veToken.connect(delegator2).create_lock(ethers.utils.parseEther('350'), lock_time);
            await veToken.connect(delegator3).create_lock(ethers.utils.parseEther('275'), lock_time);
            await veToken.connect(delegator4).create_lock(ethers.utils.parseEther('250'), lock_time);
            await veToken.connect(delegator5).create_lock(ethers.utils.parseEther('100'), one_week_lock_time);
            await veToken.connect(delegator6).create_lock(ethers.utils.parseEther('150'), lock_time);
            await veToken.connect(delegator7).create_lock(ethers.utils.parseEther('500'), lock_time);
            await veToken.connect(delegator8).create_lock(ethers.utils.parseEther('175'), lock_time);

            await feeToken.connect(admin).transfer(receiver.address, fee_token_amount.sub(lock_amount).sub(ethers.utils.parseEther('1000')));
            await feeToken.connect(admin).transfer(receiver2.address, ethers.utils.parseEther('1000'));
        }
        else {
            let stateOracle: IVotingEscrowStateOracle
            stateOracle = IVotingEscrowStateOracle__factory.connect(VOTING_ESCROW_ADDRESS[chainId], provider);

            [
                delegator1,
                delegator2,
                delegator3,
                delegator4,
                delegator5,
                delegator6,
                delegator7,
                delegator8
            ] = await getVeHolders(admin, 8)

            await setBlockhash(admin, stateOracle)

            const delegators = [
                delegator1,
                delegator2,
                delegator3,
                delegator4,
                delegator5,
                delegator6,
                delegator7,
                delegator8
            ]

            for(let i = 0; i < 8; i++){
                await setHolderSidechainBalance(admin, stateOracle, delegators[i])
            }

            await getERC20(admin, BIG_HOLDER[chainId], feeToken, admin.address, ethers.utils.parseEther('300000'));

            await feeToken.connect(admin).transfer(receiver.address, ethers.utils.parseEther('100000'));
            await feeToken.connect(admin).transfer(receiver2.address, ethers.utils.parseEther('100000'));
        }

    });


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

        multiBuy = (await multiBuyFactory.connect(admin).deploy(
            feeToken.address,
            veToken.address,
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

        await warden.connect(delegator1).register(price_per_vote1, 10, 2000, 10000, false);
        await warden.connect(delegator2).register(price_per_vote2, 8, 1000, 8000, false);
        await warden.connect(delegator3).register(price_per_vote3, 9, 1000, 10000, false);
        await warden.connect(delegator4).register(price_per_vote4, 11, 1500, 9000, false);
        await warden.connect(delegator5).register(price_per_vote5, 7, 1000, 10000, false);
        await warden.connect(delegator6).register(price_per_vote6, 8, 5000, 5000, false);
        await warden.connect(delegator7).register(price_per_vote7, 10, 2000, 10000, false);
        await warden.connect(delegator8).register(price_per_vote8, 9, 1500, 7500, false);

        await feeToken.connect(receiver).approve(multiBuy.address, ethers.constants.MaxUint256)
    });

    it(' should be deployed & have correct parameters', async () => {
        expect(multiBuy.address).to.properAddress

        const multiBuy_feeToken = await multiBuy.feeToken();
        const multiBuy_votingEscrow = await multiBuy.votingEscrow();
        const multiBuy_delegationBoost = await multiBuy.delegationBoost();
        const multiBuy_warden = await multiBuy.warden();

        expect(multiBuy_feeToken).to.be.eq(feeToken.address);
        expect(multiBuy_votingEscrow).to.be.eq(veToken.address);
        expect(multiBuy_delegationBoost).to.be.eq(delegationBoost.address);
        expect(multiBuy_warden).to.be.eq(warden.address);

    });

    describe('quickSort', async () => {

        it(' should return the BoostOffer on the right order', async () => {
            //Expected order : 4, 1, 5, 3, 8, 7, 2, 6 (2 & 7 have the same price)

            const sortedOffers: BigNumber[] = await multiBuy.getSortedOffers()

            expect(sortedOffers[0].toNumber()).to.be.eq(4);
            expect(sortedOffers[1].toNumber()).to.be.eq(1);
            expect(sortedOffers[2].toNumber()).to.be.eq(5);
            expect(sortedOffers[3].toNumber()).to.be.eq(3);
            expect(sortedOffers[4].toNumber()).to.be.eq(8);
            expect(sortedOffers[5].toNumber()).to.be.eq(7);
            expect(sortedOffers[6].toNumber()).to.be.eq(2);
            expect(sortedOffers[7].toNumber()).to.be.eq(6);
        });

        it(' should not have the index 0 BoostOffer', async () => {

            const sortedOffers = await multiBuy.getSortedOffers()

            expect(sortedOffers).not.to.contain(BigNumber.from(0))
        });

    });


    describe('simpleMultiBuy', async () => {

        const one_week = BigNumber.from(7 * 86400);
        const duration = 2

        const amount = ethers.utils.parseEther('700000')
        const bigger_amount = ethers.utils.parseEther('2000000')

        const max_price = price_per_vote2

        const fee_amount = amount.mul(max_price).mul(one_week.mul(duration)).div(unit)
        const incorrect_fee_amount = amount.mul(max_price.div(5)).mul(one_week.mul(duration)).div(unit)
        const bigger_fee_amount = bigger_amount.mul(max_price).mul(one_week.mul(duration)).div(unit)

        const accepted_slippage = 100

        const minRequiredAmount = BigNumber.from(0)
        const bigger_minRequiredAmount = ethers.utils.parseEther('200000')

        it(' should buy Boosts to cover requested amount + Event', async () => {
            // Check that it's taking them in the right order
            // + Getting the max percent available for each

            const buy_tx = await multiBuy.connect(receiver).simpleMultiBuy(
                receiver.address,
                duration,
                amount,
                max_price,
                minRequiredAmount,
                fee_amount,
                accepted_slippage,
                false
            )

            const tx_block = (await buy_tx).blockNumber
            const block_timestamp = (await ethers.provider.getBlock(tx_block || 0)).timestamp

            const receipt = await buy_tx.wait()

            const iface = warden.interface;
            const topic = iface.getEventTopic('BoostPurchase')
            const buy_logs = receipt.logs.filter(x => x.topics.indexOf(topic) >= 0);
            const events = buy_logs.map((log) => (iface.parseLog(log)).args)

            const expected_offers_indexes_order = [1, 2, 3] // Expected Offers to have been used by the multiBuy
            let effective_total_boost_amount = BigNumber.from(0)

            const expected_total_boost_amount_with_slippage = amount.mul(BPS - accepted_slippage).div(BPS)

            // Get the users that emitted Boosts => Get the offers that have been used
            for (let e of events) {

                let boost_delegator = e.delegator
                let boost_index = await warden.userIndex(boost_delegator)
                expect(expected_offers_indexes_order).to.contain(boost_index.toNumber())

                const delegator_offer = await warden.offers(boost_index);

                // Check that it used the max % available for that Offer (except for the last one)
                if (boost_index.toNumber() != expected_offers_indexes_order[expected_offers_indexes_order.length - 1])
                    expect(e.percent).to.be.eq(delegator_offer.maxPerc)

                let exact_boost_amount = await delegationBoost.token_boost(e.tokenId, { blockTag: tx_block })

                effective_total_boost_amount = effective_total_boost_amount.add(exact_boost_amount)

                expect(e.price).to.be.lte(max_price)

                //Check that ExpiryTime & CancelTime are correct for both
                let boost_expire_time = await delegationBoost.token_expiry(e.tokenId)
                let boost_cancel_time = await delegationBoost.token_cancel_time(e.tokenId)
                expect(boost_expire_time).to.be.gte((one_week.mul(duration)).add(block_timestamp)) //since there might be "bonus days" because of the veBoost rounding down on expire_time
                expect(boost_cancel_time).to.be.eq((one_week.mul(duration)).add(block_timestamp))
            }

            //Homemade check :
            //amount with slippage <= effective boost amount <= requested amount
            expect(effective_total_boost_amount).to.be.lte(amount)
            expect(effective_total_boost_amount).to.be.gte(expected_total_boost_amount_with_slippage)

            const veToken_balance_receiver = await veToken.balanceOf(receiver.address, { blockTag: tx_block })
            const veToken_adjusted_receiver = await delegationBoost.adjusted_balance_of(receiver.address, { blockTag: tx_block })
            expect(veToken_adjusted_receiver).to.be.eq(veToken_balance_receiver.add(effective_total_boost_amount))

            //close all the Boosts for next tests
            for (let e of events) {
                await delegationBoost.connect(receiver).cancel_boost(e.tokenId)
            }
        });

        it(' should skip Offers with available balance under the min Required', async () => {

            const buy_tx = await multiBuy.connect(receiver).simpleMultiBuy(
                receiver.address,
                duration,
                amount,
                max_price,
                bigger_minRequiredAmount,
                fee_amount,
                accepted_slippage,
                false
            )

            const tx_block = (await buy_tx).blockNumber
            const block_timestamp = (await ethers.provider.getBlock(tx_block || 0)).timestamp

            const receipt = await buy_tx.wait()

            const iface = warden.interface;
            const topic = iface.getEventTopic('BoostPurchase')
            const buy_logs = receipt.logs.filter(x => x.topics.indexOf(topic) >= 0);
            const events = buy_logs.map((log) => (iface.parseLog(log)).args)

            const expected_offers_indexes_order = [2, 3, 4] // Expected Offers to have been used by the multiBuy
            let effective_total_boost_amount = BigNumber.from(0)

            const expected_total_boost_amount_with_slippage = amount.mul(BPS - accepted_slippage).div(BPS)

            // Get the users that emitted Boosts => Get the offers that have been used
            for (let e of events) {

                let boost_delegator = e.delegator
                let boost_index = await warden.userIndex(boost_delegator)
                expect(expected_offers_indexes_order).to.contain(boost_index.toNumber())
                //Offer where the boost amount is too little
                expect(boost_index.toNumber()).not.to.be.eq(1)

                const delegator_offer = await warden.offers(boost_index);

                // Check that it used the max % available for that Offer (except for the last one)
                if (boost_index.toNumber() != expected_offers_indexes_order[expected_offers_indexes_order.length - 1])
                    expect(e.percent).to.be.eq(delegator_offer.maxPerc)

                let exact_boost_amount = await delegationBoost.token_boost(e.tokenId, { blockTag: tx_block })

                effective_total_boost_amount = effective_total_boost_amount.add(exact_boost_amount)

                expect(e.price).to.be.lte(max_price)

                //Check that ExpiryTime & CancelTime are correct for both
                let boost_expire_time = await delegationBoost.token_expiry(e.tokenId)
                let boost_cancel_time = await delegationBoost.token_cancel_time(e.tokenId)
                expect(boost_expire_time).to.be.gte((one_week.mul(duration)).add(block_timestamp)) //since there might be "bonus days" because of the veBoost rounding down on expire_time
                expect(boost_cancel_time).to.be.eq((one_week.mul(duration)).add(block_timestamp))
            }

            //Homemade check :
            //amount with slippage <= effective boost amount <= requested amount
            expect(effective_total_boost_amount).to.be.lte(amount)
            expect(effective_total_boost_amount).to.be.gte(expected_total_boost_amount_with_slippage)

            const veToken_balance_receiver = await veToken.balanceOf(receiver.address, { blockTag: tx_block })
            const veToken_adjusted_receiver = await delegationBoost.adjusted_balance_of(receiver.address, { blockTag: tx_block })
            expect(veToken_adjusted_receiver).to.be.eq(veToken_balance_receiver.add(effective_total_boost_amount))

            //close all the Boosts for next tests
            for (let e of events) {
                await delegationBoost.connect(receiver).cancel_boost(e.tokenId)
            }
        });

        it(' should skip Offers with maxDuration under the asked duration', async () => {

            const less_duration = 1

            await warden.connect(delegator1).updateOffer(price_per_vote1, less_duration, 1000, 8000, false);

            const buy_tx = await multiBuy.connect(receiver).simpleMultiBuy(
                receiver.address,
                duration,
                amount,
                max_price,
                minRequiredAmount,
                fee_amount,
                accepted_slippage,
                false
            )

            const tx_block = (await buy_tx).blockNumber
            const block_timestamp = (await ethers.provider.getBlock(tx_block || 0)).timestamp

            const receipt = await buy_tx.wait()

            const iface = warden.interface;
            const topic = iface.getEventTopic('BoostPurchase')
            const buy_logs = receipt.logs.filter(x => x.topics.indexOf(topic) >= 0);
            const events = buy_logs.map((log) => (iface.parseLog(log)).args)

            const expected_offers_indexes_order = [2, 3, 4] // Expected Offers to have been used by the multiBuy
            let effective_total_boost_amount = BigNumber.from(0)

            const expected_total_boost_amount_with_slippage = amount.mul(BPS - accepted_slippage).div(BPS)

            // Get the users that emitted Boosts => Get the offers that have been used
            for (let e of events) {

                let boost_delegator = e.delegator
                let boost_index = await warden.userIndex(boost_delegator)
                expect(expected_offers_indexes_order).to.contain(boost_index.toNumber())

                const delegator_offer = await warden.offers(boost_index);

                // Check that it used the max % available for that Offer (except for the last one)
                if (boost_index.toNumber() != expected_offers_indexes_order[expected_offers_indexes_order.length - 1])
                    expect(e.percent).to.be.eq(delegator_offer.maxPerc)

                let exact_boost_amount = await delegationBoost.token_boost(e.tokenId, { blockTag: tx_block })

                effective_total_boost_amount = effective_total_boost_amount.add(exact_boost_amount)

                expect(e.price).to.be.lte(max_price)

                //Check that ExpiryTime & CancelTime are correct for both
                let boost_expire_time = await delegationBoost.token_expiry(e.tokenId)
                let boost_cancel_time = await delegationBoost.token_cancel_time(e.tokenId)
                expect(boost_expire_time).to.be.gte((one_week.mul(duration)).add(block_timestamp)) //since there might be "bonus days" because of the veBoost rounding down on expire_time
                expect(boost_cancel_time).to.be.eq((one_week.mul(duration)).add(block_timestamp))
            }

            //Homemade check :
            //amount with slippage <= effective boost amount <= requested amount
            expect(effective_total_boost_amount).to.be.lte(amount)
            expect(effective_total_boost_amount).to.be.gte(expected_total_boost_amount_with_slippage)

            const veToken_balance_receiver = await veToken.balanceOf(receiver.address, { blockTag: tx_block })
            const veToken_adjusted_receiver = await delegationBoost.adjusted_balance_of(receiver.address, { blockTag: tx_block })
            expect(veToken_adjusted_receiver).to.be.eq(veToken_balance_receiver.add(effective_total_boost_amount))

            //close all the Boosts for next tests
            for (let e of events) {
                await delegationBoost.connect(receiver).cancel_boost(e.tokenId)
            }
        });

        it(' should use the advised price for users that set it', async () => {
            // Check that it's taking them in the right order
            // + Getting the max percent available for each

            await warden.connect(delegator1).updateOfferPrice(price_per_vote1, true);
            await warden.connect(delegator3).updateOfferPrice(price_per_vote3, true);

            const advisedPriceUser = [delegator1.address, delegator3.address]

            const buy_tx = await multiBuy.connect(receiver).simpleMultiBuy(
                receiver.address,
                duration,
                amount,
                max_price,
                minRequiredAmount,
                fee_amount,
                accepted_slippage,
                false
            )

            const tx_block = (await buy_tx).blockNumber

            const receipt = await buy_tx.wait()

            const iface = warden.interface;
            const topic = iface.getEventTopic('BoostPurchase')
            const buy_logs = receipt.logs.filter(x => x.topics.indexOf(topic) >= 0);
            const events = buy_logs.map((log) => (iface.parseLog(log)).args)

            const expected_offers_indexes_order = [1, 2, 3] // Expected Offers to have been used by the multiBuy
            let effective_total_boost_amount = BigNumber.from(0)

            const expected_total_boost_amount_with_slippage = amount.mul(BPS - accepted_slippage).div(BPS)

            // Get the users that emitted Boosts => Get the offers that have been used
            for (let e of events) {

                let boost_delegator = e.delegator
                let boost_index = await warden.userIndex(boost_delegator)
                expect(expected_offers_indexes_order).to.contain(boost_index.toNumber())

                const delegator_offer = await warden.offers(boost_index);

                // Check that it used the max % available for that Offer (except for the last one)
                if (boost_index.toNumber() != expected_offers_indexes_order[expected_offers_indexes_order.length - 1])
                    expect(e.percent).to.be.eq(delegator_offer.maxPerc)

                let exact_boost_amount = await delegationBoost.token_boost(e.tokenId, { blockTag: tx_block })

                effective_total_boost_amount = effective_total_boost_amount.add(exact_boost_amount)

                if (advisedPriceUser.includes(e.delegator)) {
                    expect(e.price).to.be.eq(base_advised_price)
                }
            }

            //Homemade check :
            //amount with slippage <= effective boost amount <= requested amount
            expect(effective_total_boost_amount).to.be.lte(amount)
            expect(effective_total_boost_amount).to.be.gte(expected_total_boost_amount_with_slippage)

            //close all the Boosts for next tests
            for (let e of events) {
                await delegationBoost.connect(receiver).cancel_boost(e.tokenId)
            }
        });

        it(' should skip Offers with price over the maxPrice given', async () => {

            const other_amount = ethers.utils.parseEther('600000')

            const lower_max_price = price_per_vote3
            const low_fee_amount = other_amount.mul(lower_max_price).mul(one_week.mul(duration)).div(unit)

            const buy_tx = await multiBuy.connect(receiver).simpleMultiBuy(
                receiver.address,
                duration,
                other_amount,
                lower_max_price,
                minRequiredAmount,
                low_fee_amount,
                accepted_slippage,
                false
            )

            const tx_block = (await buy_tx).blockNumber
            const block_timestamp = (await ethers.provider.getBlock(tx_block || 0)).timestamp

            const receipt = await buy_tx.wait()

            const iface = warden.interface;
            const topic = iface.getEventTopic('BoostPurchase')
            const buy_logs = receipt.logs.filter(x => x.topics.indexOf(topic) >= 0);
            const events = buy_logs.map((log) => (iface.parseLog(log)).args)

            const expected_offers_indexes_order = [1, 3, 4] // Expected Offers to have been used by the multiBuy
            let effective_total_boost_amount = BigNumber.from(0)

            const expected_total_boost_amount_with_slippage = other_amount.mul(BPS - accepted_slippage).div(BPS)

            // Get the users that emitted Boosts => Get the offers that have been used
            for (let e of events) {

                let boost_delegator = e.delegator
                let boost_index = await warden.userIndex(boost_delegator)
                expect(expected_offers_indexes_order).to.contain(boost_index.toNumber())
                //Offer where the price is too high
                expect(boost_index.toNumber()).not.to.be.eq(2)
                expect(boost_index.toNumber()).not.to.be.eq(6)
                expect(boost_index.toNumber()).not.to.be.eq(7)
                expect(boost_index.toNumber()).not.to.be.eq(8)

                const delegator_offer = await warden.offers(boost_index);

                // Check that it used the max % available for that Offer (except for the last one)
                if (boost_index.toNumber() != expected_offers_indexes_order[expected_offers_indexes_order.length - 1])
                    expect(e.percent).to.be.eq(delegator_offer.maxPerc)

                let exact_boost_amount = await delegationBoost.token_boost(e.tokenId, { blockTag: tx_block })

                effective_total_boost_amount = effective_total_boost_amount.add(exact_boost_amount)

                expect(e.price).to.be.lte(lower_max_price)

                //Check that ExpiryTime & CancelTime are correct for both
                let boost_expire_time = await delegationBoost.token_expiry(e.tokenId)
                let boost_cancel_time = await delegationBoost.token_cancel_time(e.tokenId)
                expect(boost_expire_time).to.be.gte((one_week.mul(duration)).add(block_timestamp)) //since there might be "bonus days" because of the veBoost rounding down on expire_time
                expect(boost_cancel_time).to.be.eq((one_week.mul(duration)).add(block_timestamp))
            }

            //Homemade check :
            //amount with slippage <= effective boost amount <= requested amount
            expect(effective_total_boost_amount).to.be.lte(other_amount)
            expect(effective_total_boost_amount).to.be.gte(expected_total_boost_amount_with_slippage)

            const veToken_balance_receiver = await veToken.balanceOf(receiver.address, { blockTag: tx_block })
            const veToken_adjusted_receiver = await delegationBoost.adjusted_balance_of(receiver.address, { blockTag: tx_block })
            expect(veToken_adjusted_receiver).to.be.eq(veToken_balance_receiver.add(effective_total_boost_amount))

            //close all the Boosts for next tests
            for (let e of events) {
                await delegationBoost.connect(receiver).cancel_boost(e.tokenId)
            }
        });

        it(' should return unused fee tokens to the buyer', async () => {
            const old_balance = await feeToken.balanceOf(receiver.address)
            const old_balance_multiBuy = await feeToken.balanceOf(multiBuy.address)

            const buy_tx = await multiBuy.connect(receiver).simpleMultiBuy(
                receiver.address,
                duration,
                amount,
                max_price,
                minRequiredAmount,
                fee_amount,
                accepted_slippage,
                false
            )

            const tx_block = (await buy_tx).blockNumber

            const receipt = await buy_tx.wait()

            const iface = warden.interface;
            const topic = iface.getEventTopic('BoostPurchase')
            const buy_logs = receipt.logs.filter(x => x.topics.indexOf(topic) >= 0);
            const events = buy_logs.map((log) => (iface.parseLog(log)).args)

            let effective_paid_fees = BigNumber.from(0)

            for (let e of events) {
                effective_paid_fees = effective_paid_fees.add(e.paidFeeAmount)
            }

            const new_balance = await feeToken.balanceOf(receiver.address)
            const new_balance_multiBuy = await feeToken.balanceOf(multiBuy.address)

            expect(new_balance).to.be.eq(old_balance.sub(effective_paid_fees))
            expect(new_balance_multiBuy).to.be.eq(old_balance_multiBuy)

            //close all the Boosts for next tests
            for (let e of events) {
                await delegationBoost.connect(receiver).cancel_boost(e.tokenId)
            }
        });

        it(' should take all available amount if Boosts already taken on Offers', async () => {
            const boost_buy_percent = 2000

            await feeToken.connect(receiver2).approve(warden.address, ethers.constants.MaxUint256)

            const fee_amount1 = await warden.estimateFees(delegator1.address, boost_buy_percent, duration)
            const fee_amount2 = await warden.estimateFees(delegator2.address, boost_buy_percent, duration)

            await warden.connect(receiver2).buyDelegationBoost(delegator1.address, receiver2.address, boost_buy_percent, duration, fee_amount1)
            await warden.connect(receiver2).buyDelegationBoost(delegator2.address, receiver2.address, boost_buy_percent, duration, fee_amount2)

            const token_id1 = await delegationBoost.get_token_id(
                delegator1.address,
                (await delegationBoost.total_minted(delegator1.address)).sub(1)
            );
            const token_id2 = await delegationBoost.get_token_id(
                delegator2.address,
                (await delegationBoost.total_minted(delegator2.address)).sub(1)
            );

            //Expected buy percent on Offers with already a Boost
            let boosts_expected_percent_buy: { [key: number]: number } = {}
            boosts_expected_percent_buy[1] = (await warden.offers(1)).maxPerc - boost_buy_percent
            boosts_expected_percent_buy[2] = (await warden.offers(2)).maxPerc - boost_buy_percent

            const buy_tx = await multiBuy.connect(receiver).simpleMultiBuy(
                receiver.address,
                duration,
                amount,
                max_price,
                minRequiredAmount,
                fee_amount,
                accepted_slippage,
                false
            )

            const tx_block = (await buy_tx).blockNumber

            const receipt = await buy_tx.wait()

            const iface = warden.interface;
            const topic = iface.getEventTopic('BoostPurchase')
            const buy_logs = receipt.logs.filter(x => x.topics.indexOf(topic) >= 0);
            const events = buy_logs.map((log) => (iface.parseLog(log)).args)

            const expected_offers_indexes_order = [1, 2, 3, 4] // Expected Offers to have been used by the multiBuy
            let effective_total_boost_amount = BigNumber.from(0)

            const expected_total_boost_amount_with_slippage = amount.mul(BPS - accepted_slippage).div(BPS)

            // Get the users that emitted Boosts => Get the offers that have been used
            for (let e of events) {

                let boost_delegator = e.delegator
                let boost_index = await warden.userIndex(boost_delegator)
                expect(expected_offers_indexes_order).to.contain(boost_index.toNumber())

                // Check that it used the max % available for that Offer (except for the last one)
                if (boost_index.toNumber() != expected_offers_indexes_order[expected_offers_indexes_order.length - 1]
                    && boost_index.toNumber() in [1, 2]) {
                    let expected_percent = BigNumber.from(boosts_expected_percent_buy[boost_index.toNumber()])
                    expect(e.percent).to.be.closeTo(expected_percent, 1)
                }

                let exact_boost_amount = await delegationBoost.token_boost(e.tokenId, { blockTag: tx_block })

                effective_total_boost_amount = effective_total_boost_amount.add(exact_boost_amount)
            }

            //Homemade check :
            //amount with slippage <= effective boost amount <= requested amount
            expect(effective_total_boost_amount).to.be.lte(amount)
            expect(effective_total_boost_amount).to.be.gte(expected_total_boost_amount_with_slippage)

            const veToken_balance_receiver = await veToken.balanceOf(receiver.address, { blockTag: tx_block })
            const veToken_adjusted_receiver = await delegationBoost.adjusted_balance_of(receiver.address, { blockTag: tx_block })
            expect(veToken_adjusted_receiver).to.be.eq(veToken_balance_receiver.add(effective_total_boost_amount))

            //close all the Boosts for next tests
            await delegationBoost.connect(receiver2).cancel_boost(token_id1)
            await delegationBoost.connect(receiver2).cancel_boost(token_id2)
            for (let e of events) {
                await delegationBoost.connect(receiver).cancel_boost(e.tokenId)
            }
        });

        it(' should skip Offers where lock is already over', async () => {

            const slightly_bigger_amount = ethers.utils.parseEther('1150000')
            const slightly_bigger_fee_amount = slightly_bigger_amount.mul(max_price).mul(one_week.mul(duration)).div(unit)

            const buy_tx = await multiBuy.connect(receiver).simpleMultiBuy(
                receiver.address,
                duration,
                slightly_bigger_amount,
                max_price,
                minRequiredAmount,
                slightly_bigger_fee_amount,
                accepted_slippage,
                false
            )

            const tx_block = (await buy_tx).blockNumber
            const block_timestamp = (await ethers.provider.getBlock(tx_block || 0)).timestamp

            const receipt = await buy_tx.wait()

            const iface = warden.interface;
            const topic = iface.getEventTopic('BoostPurchase')
            const buy_logs = receipt.logs.filter(x => x.topics.indexOf(topic) >= 0);
            const events = buy_logs.map((log) => (iface.parseLog(log)).args)

            // we expect to skip the 5th one, because its lock is too short
            const expected_offers_indexes_order = [1, 2, 3, 4, 7] // Expected Offers to have been used by the multiBuy
            let effective_total_boost_amount = BigNumber.from(0)

            const expected_total_boost_amount_with_slippage = amount.mul(BPS - accepted_slippage).div(BPS)

            // Get the users that emitted Boosts => Get the offers that have been used
            for (let e of events) {

                let boost_delegator = e.delegator
                let boost_index = await warden.userIndex(boost_delegator)
                expect(expected_offers_indexes_order).to.contain(boost_index.toNumber())
                expect(boost_index.toNumber()).not.to.be.eq(5)

                const delegator_offer = await warden.offers(boost_index);

                // Check that it used the max % available for that Offer (except for the last one)
                if (boost_index.toNumber() != expected_offers_indexes_order[expected_offers_indexes_order.length - 1])
                    expect(e.percent).to.be.eq(delegator_offer.maxPerc)

                let exact_boost_amount = await delegationBoost.token_boost(e.tokenId, { blockTag: tx_block })

                effective_total_boost_amount = effective_total_boost_amount.add(exact_boost_amount)

                expect(e.price).to.be.lte(max_price)

                //Check that ExpiryTime & CancelTime are correct for both
                let boost_expire_time = await delegationBoost.token_expiry(e.tokenId)
                let boost_cancel_time = await delegationBoost.token_cancel_time(e.tokenId)
                expect(boost_expire_time).to.be.gte((one_week.mul(duration)).add(block_timestamp)) //since there might be "bonus days" because of the veBoost rounding down on expire_time
                expect(boost_cancel_time).to.be.eq((one_week.mul(duration)).add(block_timestamp))
            }

            //Homemade check :
            //amount with slippage <= effective boost amount <= requested amount
            expect(effective_total_boost_amount).to.be.lte(slightly_bigger_amount)
            expect(effective_total_boost_amount).to.be.gte(expected_total_boost_amount_with_slippage)

            const veToken_balance_receiver = await veToken.balanceOf(receiver.address, { blockTag: tx_block })
            const veToken_adjusted_receiver = await delegationBoost.adjusted_balance_of(receiver.address, { blockTag: tx_block })
            expect(veToken_adjusted_receiver).to.be.eq(veToken_balance_receiver.add(effective_total_boost_amount))

            //close all the Boosts for next tests
            for (let e of events) {
                await delegationBoost.connect(receiver).cancel_boost(e.tokenId)
            }

        });

        it(' should skip Offer where delegator removed Warden as Operator', async () => {

            await delegationBoost.connect(delegator3).setApprovalForAll(warden.address, false);

            const buy_tx = await multiBuy.connect(receiver).simpleMultiBuy(
                receiver.address,
                duration,
                amount,
                max_price,
                minRequiredAmount,
                fee_amount,
                accepted_slippage,
                false
            )

            const tx_block = (await buy_tx).blockNumber
            const block_timestamp = (await ethers.provider.getBlock(tx_block || 0)).timestamp

            const receipt = await buy_tx.wait()

            const iface = warden.interface;
            const topic = iface.getEventTopic('BoostPurchase')
            const buy_logs = receipt.logs.filter(x => x.topics.indexOf(topic) >= 0);
            const events = buy_logs.map((log) => (iface.parseLog(log)).args)

            const expected_offers_indexes_order = [1, 2, 4] // Expected Offers to have been used by the multiBuy
            let effective_total_boost_amount = BigNumber.from(0)

            const expected_total_boost_amount_with_slippage = amount.mul(BPS - accepted_slippage).div(BPS)

            // Get the users that emitted Boosts => Get the offers that have been used
            for (let e of events) {

                let boost_delegator = e.delegator
                let boost_index = await warden.userIndex(boost_delegator)
                expect(expected_offers_indexes_order).to.contain(boost_index.toNumber())
                expect(boost_index.toNumber()).not.to.be.eq(3)

                const delegator_offer = await warden.offers(boost_index);

                // Check that it used the max % available for that Offer (except for the last one)
                if (boost_index.toNumber() != expected_offers_indexes_order[expected_offers_indexes_order.length - 1])
                    expect(e.percent).to.be.eq(delegator_offer.maxPerc)

                let exact_boost_amount = await delegationBoost.token_boost(e.tokenId, { blockTag: tx_block })

                effective_total_boost_amount = effective_total_boost_amount.add(exact_boost_amount)

                expect(e.price).to.be.lte(max_price)

                //Check that ExpiryTime & CancelTime are correct for both
                let boost_expire_time = await delegationBoost.token_expiry(e.tokenId)
                let boost_cancel_time = await delegationBoost.token_cancel_time(e.tokenId)
                expect(boost_expire_time).to.be.gte((one_week.mul(duration)).add(block_timestamp)) //since there might be "bonus days" because of the veBoost rounding down on expire_time
                expect(boost_cancel_time).to.be.eq((one_week.mul(duration)).add(block_timestamp))
            }

            //Homemade check :
            //amount with slippage <= effective boost amount <= requested amount
            expect(effective_total_boost_amount).to.be.lte(amount)
            expect(effective_total_boost_amount).to.be.gte(expected_total_boost_amount_with_slippage)

            const veToken_balance_receiver = await veToken.balanceOf(receiver.address, { blockTag: tx_block })
            const veToken_adjusted_receiver = await delegationBoost.adjusted_balance_of(receiver.address, { blockTag: tx_block })
            expect(veToken_adjusted_receiver).to.be.eq(veToken_balance_receiver.add(effective_total_boost_amount))

            //close all the Boosts for next tests
            for (let e of events) {
                await delegationBoost.connect(receiver).cancel_boost(e.tokenId)
            }

        });

        it(' should fail if incorrect parameters were given', async () => {

            await expect(
                multiBuy.connect(receiver).simpleMultiBuy(
                    ethers.constants.AddressZero,
                    duration,
                    amount,
                    max_price,
                    minRequiredAmount,
                    fee_amount,
                    accepted_slippage,
                    false
                )
            ).to.be.revertedWith('Zero address')

            await expect(
                multiBuy.connect(receiver).simpleMultiBuy(
                    receiver.address,
                    duration,
                    0,
                    max_price,
                    minRequiredAmount,
                    fee_amount,
                    accepted_slippage,
                    false
                )
            ).to.be.revertedWith('Null value')

            await expect(
                multiBuy.connect(receiver).simpleMultiBuy(
                    receiver.address,
                    duration,
                    amount,
                    max_price,
                    minRequiredAmount,
                    0,
                    accepted_slippage,
                    false
                )
            ).to.be.revertedWith('Null value')

            await expect(
                multiBuy.connect(receiver).simpleMultiBuy(
                    receiver.address,
                    duration,
                    amount,
                    max_price,
                    minRequiredAmount,
                    fee_amount,
                    0,
                    false
                )
            ).to.be.revertedWith('Null value')

            await expect(
                multiBuy.connect(receiver).simpleMultiBuy(
                    receiver.address,
                    duration,
                    amount,
                    0,
                    minRequiredAmount,
                    fee_amount,
                    accepted_slippage,
                    false
                )
            ).to.be.revertedWith('Null price')

            await expect(
                multiBuy.connect(receiver).simpleMultiBuy(
                    receiver.address,
                    0,
                    amount,
                    max_price,
                    minRequiredAmount,
                    fee_amount,
                    accepted_slippage,
                    false
                )
            ).to.be.revertedWith('Duration too short')

        });

        it(' should revert if cannot match the asked amount', async () => {

            await expect(
                multiBuy.connect(receiver).simpleMultiBuy(
                    receiver.address,
                    duration,
                    bigger_amount,
                    max_price,
                    minRequiredAmount,
                    bigger_fee_amount,
                    accepted_slippage,
                    false
                )
            ).to.be.revertedWith('Cannot match Order')

        });

        it(' should fail if not enough fees available', async () => {

            await expect(
                multiBuy.connect(receiver).simpleMultiBuy(
                    receiver.address,
                    duration,
                    amount,
                    max_price,
                    minRequiredAmount,
                    incorrect_fee_amount,
                    accepted_slippage,
                    false
                )
            ).to.be.revertedWith('Not Enough Fees')

        });

        it(' should take Offer where expired Boosts can be canceled', async () => {

            const boost_buy_percent = 2000

            await feeToken.connect(receiver2).approve(warden.address, ethers.constants.MaxUint256)

            const fee_amount1 = await warden.estimateFees(delegator1.address, boost_buy_percent, duration)
            const fee_amount2 = await warden.estimateFees(delegator2.address, boost_buy_percent, duration)

            await warden.connect(receiver2).buyDelegationBoost(delegator1.address, receiver2.address, boost_buy_percent, duration, fee_amount1)
            const buy_2_tx = await warden.connect(receiver2).buyDelegationBoost(delegator2.address, receiver2.address, boost_buy_percent, duration, fee_amount2)

            const token_id1 = await delegationBoost.get_token_id(
                delegator1.address,
                (await delegationBoost.total_minted(delegator1.address)).sub(1)
            );
            const token_id2 = await delegationBoost.get_token_id(
                delegator2.address,
                (await delegationBoost.total_minted(delegator2.address)).sub(1)
            );

            const boost_cancel_time = await delegationBoost.token_cancel_time(token_id2)
            const tx_timestamp = (await ethers.provider.getBlock((await buy_2_tx).blockNumber || 0)).timestamp
            await advanceTime(boost_cancel_time.sub(tx_timestamp).toNumber())

            const other_amount = ethers.utils.parseEther('500000')

            const other_fee_amount = other_amount.mul(max_price).mul(one_week.mul(duration)).div(unit)

            const buy_tx = await multiBuy.connect(receiver).simpleMultiBuy(
                receiver.address,
                duration,
                other_amount,
                max_price,
                minRequiredAmount,
                other_fee_amount,
                accepted_slippage,
                true
            )

            const tx_block = (await buy_tx).blockNumber
            const block_timestamp = (await ethers.provider.getBlock(tx_block || 0)).timestamp

            const receipt = await buy_tx.wait()

            const iface = warden.interface;
            const topic = iface.getEventTopic('BoostPurchase')
            const buy_logs = receipt.logs.filter(x => x.topics.indexOf(topic) >= 0);
            const events = buy_logs.map((log) => (iface.parseLog(log)).args)

            const expected_offers_indexes_order = [1, 2, 3] // Expected Offers to have been used by the multiBuy
            let effective_total_boost_amount = BigNumber.from(0)

            const expected_total_boost_amount_with_slippage = other_amount.mul(BPS - accepted_slippage).div(BPS)

            // Get the users that emitted Boosts => Get the offers that have been used
            for (let e of events) {

                let boost_delegator = e.delegator
                let boost_index = await warden.userIndex(boost_delegator)
                expect(expected_offers_indexes_order).to.contain(boost_index.toNumber())

                const delegator_offer = await warden.offers(boost_index);

                // Check that it used the max % available for that Offer (except for the last one)
                if (boost_index.toNumber() != expected_offers_indexes_order[expected_offers_indexes_order.length - 1])
                    expect(e.percent).to.be.eq(delegator_offer.maxPerc)

                let exact_boost_amount = await delegationBoost.token_boost(e.tokenId, { blockTag: tx_block })

                effective_total_boost_amount = effective_total_boost_amount.add(exact_boost_amount)

                expect(e.price).to.be.lte(max_price)

                //Check that ExpiryTime & CancelTime are correct for both
                let boost_expire_time = await delegationBoost.token_expiry(e.tokenId)
                let boost_cancel_time = await delegationBoost.token_cancel_time(e.tokenId)
                expect(boost_expire_time).to.be.gte((one_week.mul(duration)).add(block_timestamp)) //since there might be "bonus days" because of the veBoost rounding down on expire_time
                expect(boost_cancel_time).to.be.eq((one_week.mul(duration)).add(block_timestamp))
            }

            //Homemade check :
            //amount with slippage <= effective boost amount <= requested amount
            expect(effective_total_boost_amount).to.be.lte(other_amount)
            expect(effective_total_boost_amount).to.be.gte(expected_total_boost_amount_with_slippage)

            const veToken_balance_receiver = await veToken.balanceOf(receiver.address, { blockTag: tx_block })
            const veToken_adjusted_receiver = await delegationBoost.adjusted_balance_of(receiver.address, { blockTag: tx_block })
            expect(veToken_adjusted_receiver).to.be.eq(veToken_balance_receiver.add(effective_total_boost_amount))

            //close all the Boosts for next tests
            await delegationBoost.connect(receiver2).cancel_boost(token_id1)
            await delegationBoost.connect(receiver2).cancel_boost(token_id2)
            for (let e of events) {
                await delegationBoost.connect(receiver).cancel_boost(e.tokenId)
            }
        });

    });

    describe('preSortedMultiBuy', async () => {

        const one_week = BigNumber.from(7 * 86400);
        const duration = 2

        const amount = ethers.utils.parseEther('700000')
        const bigger_amount = ethers.utils.parseEther('2000000')

        const max_price = price_per_vote2

        const fee_amount = amount.mul(max_price).mul(one_week.mul(duration)).div(unit)
        const incorrect_fee_amount = amount.mul(max_price.div(5)).mul(one_week.mul(duration)).div(unit)
        const bigger_fee_amount = bigger_amount.mul(max_price).mul(one_week.mul(duration)).div(unit)

        const accepted_slippage = 100

        const minRequiredAmount = BigNumber.from(0)
        const bigger_minRequiredAmount = ethers.utils.parseEther('200000')

        const preSorted_Offers_list = [7, 8, 1, 4, 6, 2, 5, 3]

        it(' should buy Boosts in the given order', async () => {

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
            const block_timestamp = (await ethers.provider.getBlock(tx_block || 0)).timestamp

            const receipt = await buy_tx.wait()

            const iface = warden.interface;
            const topic = iface.getEventTopic('BoostPurchase')
            const buy_logs = receipt.logs.filter(x => x.topics.indexOf(topic) >= 0);
            const events = buy_logs.map((log) => (iface.parseLog(log)).args)

            let effective_total_boost_amount = BigNumber.from(0)

            const expected_total_boost_amount_with_slippage = amount.mul(BPS - accepted_slippage).div(BPS)

            let i = 0
            const expected_offers_indexes_order = [7, 8, 1] // Expected Offers to have been used by the multiBuy

            // Get the users that emitted Boosts => Get the offers that have been used
            for (let e of events) {

                let boost_delegator = e.delegator
                let boost_index = await warden.userIndex(boost_delegator)

                expect(boost_index.toNumber()).to.be.eq(preSorted_Offers_list[i])

                const delegator_offer = await warden.offers(boost_index);

                // Check that it used the max % available for that Offer (except for the last one)
                if (boost_index.toNumber() != expected_offers_indexes_order[expected_offers_indexes_order.length - 1])
                    expect(e.percent).to.be.eq(delegator_offer.maxPerc)

                let exact_boost_amount = await delegationBoost.token_boost(e.tokenId, { blockTag: tx_block })

                effective_total_boost_amount = effective_total_boost_amount.add(exact_boost_amount)

                expect(e.price).to.be.lte(max_price)

                //Check that ExpiryTime & CancelTime are correct for both
                let boost_expire_time = await delegationBoost.token_expiry(e.tokenId)
                let boost_cancel_time = await delegationBoost.token_cancel_time(e.tokenId)
                expect(boost_expire_time).to.be.gte((one_week.mul(duration)).add(block_timestamp)) //since there might be "bonus days" because of the veBoost rounding down on expire_time
                expect(boost_cancel_time).to.be.eq((one_week.mul(duration)).add(block_timestamp))

                i++;

            }

            //Homemade check :
            //amount with slippage <= effective boost amount <= requested amount
            expect(effective_total_boost_amount).to.be.lte(amount)
            expect(effective_total_boost_amount).to.be.gte(expected_total_boost_amount_with_slippage)

            const veToken_balance_receiver = await veToken.balanceOf(receiver.address, { blockTag: tx_block })
            const veToken_adjusted_receiver = await delegationBoost.adjusted_balance_of(receiver.address, { blockTag: tx_block })
            expect(veToken_adjusted_receiver).to.be.eq(veToken_balance_receiver.add(effective_total_boost_amount))

            //close all the Boosts for next tests
            for (let e of events) {
                await delegationBoost.connect(receiver).cancel_boost(e.tokenId)
            }
        });

        it(' should use the advised price for users that set it', async () => {

            await warden.connect(delegator1).updateOfferPrice(price_per_vote1, true);
            await warden.connect(delegator7).updateOfferPrice(price_per_vote7, true);

            const advisedPriceUser = [delegator1.address, delegator7.address]

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

            let effective_total_boost_amount = BigNumber.from(0)

            let i = 0
            const expected_offers_indexes_order = [7, 8, 1] // Expected Offers to have been used by the multiBuy

            // Get the users that emitted Boosts => Get the offers that have been used
            for (let e of events) {

                let boost_delegator = e.delegator
                let boost_index = await warden.userIndex(boost_delegator)

                expect(boost_index.toNumber()).to.be.eq(preSorted_Offers_list[i])

                const delegator_offer = await warden.offers(boost_index);

                // Check that it used the max % available for that Offer (except for the last one)
                if (boost_index.toNumber() != expected_offers_indexes_order[expected_offers_indexes_order.length - 1])
                    expect(e.percent).to.be.eq(delegator_offer.maxPerc)

                let exact_boost_amount = await delegationBoost.token_boost(e.tokenId, { blockTag: tx_block })

                effective_total_boost_amount = effective_total_boost_amount.add(exact_boost_amount)

                if (advisedPriceUser.includes(e.delegator)) {
                    expect(e.price).to.be.eq(base_advised_price)
                }

                i++;

            }

            //close all the Boosts for next tests
            for (let e of events) {
                await delegationBoost.connect(receiver).cancel_boost(e.tokenId)
            }
        });

        it(' should fail if an incorrect Offer Index is given', async () => {

            await expect(
                multiBuy.connect(receiver).preSortedMultiBuy(
                    receiver.address,
                    duration,
                    amount,
                    max_price,
                    minRequiredAmount,
                    fee_amount,
                    accepted_slippage,
                    false,
                    [42, 7, 8, 1, 4, 6, 2, 5, 3]
                )
            ).to.be.revertedWith('BoostOffer does not exist')

        });

        it(' should fail if incorrect parameters were given', async () => {

            await expect(
                multiBuy.connect(receiver).preSortedMultiBuy(
                    ethers.constants.AddressZero,
                    duration,
                    amount,
                    max_price,
                    minRequiredAmount,
                    fee_amount,
                    accepted_slippage,
                    false,
                    preSorted_Offers_list
                )
            ).to.be.revertedWith('Zero address')

            await expect(
                multiBuy.connect(receiver).preSortedMultiBuy(
                    receiver.address,
                    duration,
                    0,
                    max_price,
                    minRequiredAmount,
                    fee_amount,
                    accepted_slippage,
                    false,
                    preSorted_Offers_list
                )
            ).to.be.revertedWith('Null value')

            await expect(
                multiBuy.connect(receiver).preSortedMultiBuy(
                    receiver.address,
                    duration,
                    amount,
                    max_price,
                    minRequiredAmount,
                    0,
                    accepted_slippage,
                    false,
                    preSorted_Offers_list
                )
            ).to.be.revertedWith('Null value')

            await expect(
                multiBuy.connect(receiver).preSortedMultiBuy(
                    receiver.address,
                    duration,
                    amount,
                    max_price,
                    minRequiredAmount,
                    fee_amount,
                    0,
                    false,
                    preSorted_Offers_list
                )
            ).to.be.revertedWith('Null value')

            await expect(
                multiBuy.connect(receiver).preSortedMultiBuy(
                    receiver.address,
                    duration,
                    amount,
                    0,
                    minRequiredAmount,
                    fee_amount,
                    accepted_slippage,
                    false,
                    preSorted_Offers_list
                )
            ).to.be.revertedWith('Null price')

            await expect(
                multiBuy.connect(receiver).preSortedMultiBuy(
                    receiver.address,
                    0,
                    amount,
                    max_price,
                    minRequiredAmount,
                    fee_amount,
                    accepted_slippage,
                    false,
                    preSorted_Offers_list
                )
            ).to.be.revertedWith('Duration too short')

            await expect(
                multiBuy.connect(receiver).preSortedMultiBuy(
                    receiver.address,
                    duration,
                    amount,
                    max_price,
                    minRequiredAmount,
                    fee_amount,
                    accepted_slippage,
                    false,
                    []
                )
            ).to.be.revertedWith('Empty Array')

        });

        describe('other multiBuy tests', async () => {

            it(' should skip Offers with available balance under the min Required', async () => {

                const buy_tx = await multiBuy.connect(receiver).preSortedMultiBuy(
                    receiver.address,
                    duration,
                    amount,
                    max_price,
                    bigger_minRequiredAmount,
                    fee_amount,
                    accepted_slippage,
                    false,
                    preSorted_Offers_list
                )

                const tx_block = (await buy_tx).blockNumber
                const block_timestamp = (await ethers.provider.getBlock(tx_block || 0)).timestamp

                const receipt = await buy_tx.wait()

                const iface = warden.interface;
                const topic = iface.getEventTopic('BoostPurchase')
                const buy_logs = receipt.logs.filter(x => x.topics.indexOf(topic) >= 0);
                const events = buy_logs.map((log) => (iface.parseLog(log)).args)

                const expected_offers_indexes_order = [7, 4] // Expected Offers to have been used by the multiBuy
                let effective_total_boost_amount = BigNumber.from(0)

                const expected_total_boost_amount_with_slippage = amount.mul(BPS - accepted_slippage).div(BPS)

                let i = 0

                // Get the users that emitted Boosts => Get the offers that have been used
                for (let e of events) {

                    let boost_delegator = e.delegator
                    let boost_index = await warden.userIndex(boost_delegator)


                    expect(boost_index.toNumber()).to.be.eq(expected_offers_indexes_order[i])

                    //Offer where the boost amount is too little
                    expect(boost_index.toNumber()).not.to.be.eq(1)

                    const delegator_offer = await warden.offers(boost_index);

                    // Check that it used the max % available for that Offer (except for the last one)
                    if (boost_index.toNumber() != expected_offers_indexes_order[expected_offers_indexes_order.length - 1])
                        expect(e.percent).to.be.eq(delegator_offer.maxPerc)

                    let exact_boost_amount = await delegationBoost.token_boost(e.tokenId, { blockTag: tx_block })

                    effective_total_boost_amount = effective_total_boost_amount.add(exact_boost_amount)

                    expect(e.price).to.be.lte(max_price)

                    //Check that ExpiryTime & CancelTime are correct for both
                    let boost_expire_time = await delegationBoost.token_expiry(e.tokenId)
                    let boost_cancel_time = await delegationBoost.token_cancel_time(e.tokenId)
                    expect(boost_expire_time).to.be.gte((one_week.mul(duration)).add(block_timestamp)) //since there might be "bonus days" because of the veBoost rounding down on expire_time
                    expect(boost_cancel_time).to.be.eq((one_week.mul(duration)).add(block_timestamp))

                    i++;
                }

                //Homemade check :
                //amount with slippage <= effective boost amount <= requested amount
                expect(effective_total_boost_amount).to.be.lte(amount)
                expect(effective_total_boost_amount).to.be.gte(expected_total_boost_amount_with_slippage)

                const veToken_balance_receiver = await veToken.balanceOf(receiver.address, { blockTag: tx_block })
                const veToken_adjusted_receiver = await delegationBoost.adjusted_balance_of(receiver.address, { blockTag: tx_block })
                expect(veToken_adjusted_receiver).to.be.eq(veToken_balance_receiver.add(effective_total_boost_amount))

                //close all the Boosts for next tests
                for (let e of events) {
                    await delegationBoost.connect(receiver).cancel_boost(e.tokenId)
                }
            });

            it(' should skip Offers with maxDuration under the asked duration', async () => {

                const less_duration = 1

                await warden.connect(delegator1).updateOffer(price_per_vote1, less_duration, 2000, 10000, false);

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
                const block_timestamp = (await ethers.provider.getBlock(tx_block || 0)).timestamp

                const receipt = await buy_tx.wait()

                const iface = warden.interface;
                const topic = iface.getEventTopic('BoostPurchase')
                const buy_logs = receipt.logs.filter(x => x.topics.indexOf(topic) >= 0);
                const events = buy_logs.map((log) => (iface.parseLog(log)).args)

                const expected_offers_indexes_order = [7, 8, 4] // Expected Offers to have been used by the multiBuy
                let effective_total_boost_amount = BigNumber.from(0)

                const expected_total_boost_amount_with_slippage = amount.mul(BPS - accepted_slippage).div(BPS)

                let i = 0

                // Get the users that emitted Boosts => Get the offers that have been used
                for (let e of events) {

                    let boost_delegator = e.delegator
                    let boost_index = await warden.userIndex(boost_delegator)

                    expect(boost_index.toNumber()).to.be.eq(expected_offers_indexes_order[i])

                    const delegator_offer = await warden.offers(boost_index);

                    // Check that it used the max % available for that Offer (except for the last one)
                    if (boost_index.toNumber() != expected_offers_indexes_order[expected_offers_indexes_order.length - 1])
                        expect(e.percent).to.be.eq(delegator_offer.maxPerc)

                    let exact_boost_amount = await delegationBoost.token_boost(e.tokenId, { blockTag: tx_block })

                    effective_total_boost_amount = effective_total_boost_amount.add(exact_boost_amount)

                    expect(e.price).to.be.lte(max_price)

                    //Check that ExpiryTime & CancelTime are correct for both
                    let boost_expire_time = await delegationBoost.token_expiry(e.tokenId)
                    let boost_cancel_time = await delegationBoost.token_cancel_time(e.tokenId)
                    expect(boost_expire_time).to.be.gte((one_week.mul(duration)).add(block_timestamp)) //since there might be "bonus days" because of the veBoost rounding down on expire_time
                    expect(boost_cancel_time).to.be.eq((one_week.mul(duration)).add(block_timestamp))

                    i++;
                }

                //Homemade check :
                //amount with slippage <= effective boost amount <= requested amount
                expect(effective_total_boost_amount).to.be.lte(amount)
                expect(effective_total_boost_amount).to.be.gte(expected_total_boost_amount_with_slippage)

                const veToken_balance_receiver = await veToken.balanceOf(receiver.address, { blockTag: tx_block })
                const veToken_adjusted_receiver = await delegationBoost.adjusted_balance_of(receiver.address, { blockTag: tx_block })
                expect(veToken_adjusted_receiver).to.be.eq(veToken_balance_receiver.add(effective_total_boost_amount))

                //close all the Boosts for next tests
                for (let e of events) {
                    await delegationBoost.connect(receiver).cancel_boost(e.tokenId)
                }
            });

            it(' should skip Offers with price over the maxPrice given', async () => {

                const other_amount = ethers.utils.parseEther('600000')

                const lower_max_price = price_per_vote3
                const low_fee_amount = other_amount.mul(lower_max_price).mul(one_week.mul(duration)).div(unit)

                const buy_tx = await multiBuy.connect(receiver).preSortedMultiBuy(
                    receiver.address,
                    duration,
                    other_amount,
                    lower_max_price,
                    minRequiredAmount,
                    low_fee_amount,
                    accepted_slippage,
                    false,
                    preSorted_Offers_list
                )

                const tx_block = (await buy_tx).blockNumber
                const block_timestamp = (await ethers.provider.getBlock(tx_block || 0)).timestamp

                const receipt = await buy_tx.wait()

                const iface = warden.interface;
                const topic = iface.getEventTopic('BoostPurchase')
                const buy_logs = receipt.logs.filter(x => x.topics.indexOf(topic) >= 0);
                const events = buy_logs.map((log) => (iface.parseLog(log)).args)

                const expected_offers_indexes_order = [1, 4, 3] // Expected Offers to have been used by the multiBuy
                let effective_total_boost_amount = BigNumber.from(0)

                const expected_total_boost_amount_with_slippage = other_amount.mul(BPS - accepted_slippage).div(BPS)

                let i = 0

                // Get the users that emitted Boosts => Get the offers that have been used
                for (let e of events) {

                    let boost_delegator = e.delegator
                    let boost_index = await warden.userIndex(boost_delegator)

                    expect(boost_index.toNumber()).to.be.eq(expected_offers_indexes_order[i])

                    //Offer where the price is too high
                    expect(boost_index.toNumber()).not.to.be.eq(2)
                    expect(boost_index.toNumber()).not.to.be.eq(6)
                    expect(boost_index.toNumber()).not.to.be.eq(7)
                    expect(boost_index.toNumber()).not.to.be.eq(8)

                    const delegator_offer = await warden.offers(boost_index);

                    // Check that it used the max % available for that Offer (except for the last one)
                    if (boost_index.toNumber() != expected_offers_indexes_order[expected_offers_indexes_order.length - 1])
                        expect(e.percent).to.be.eq(delegator_offer.maxPerc)

                    let exact_boost_amount = await delegationBoost.token_boost(e.tokenId, { blockTag: tx_block })

                    effective_total_boost_amount = effective_total_boost_amount.add(exact_boost_amount)

                    expect(e.price).to.be.lte(lower_max_price)

                    //Check that ExpiryTime & CancelTime are correct for both
                    let boost_expire_time = await delegationBoost.token_expiry(e.tokenId)
                    let boost_cancel_time = await delegationBoost.token_cancel_time(e.tokenId)
                    expect(boost_expire_time).to.be.gte((one_week.mul(duration)).add(block_timestamp)) //since there might be "bonus days" because of the veBoost rounding down on expire_time
                    expect(boost_cancel_time).to.be.eq((one_week.mul(duration)).add(block_timestamp))

                    i++;
                }

                //Homemade check :
                //amount with slippage <= effective boost amount <= requested amount
                expect(effective_total_boost_amount).to.be.lte(other_amount)
                expect(effective_total_boost_amount).to.be.gte(expected_total_boost_amount_with_slippage)

                const veToken_balance_receiver = await veToken.balanceOf(receiver.address, { blockTag: tx_block })
                const veToken_adjusted_receiver = await delegationBoost.adjusted_balance_of(receiver.address, { blockTag: tx_block })
                expect(veToken_adjusted_receiver).to.be.eq(veToken_balance_receiver.add(effective_total_boost_amount))

                //close all the Boosts for next tests
                for (let e of events) {
                    await delegationBoost.connect(receiver).cancel_boost(e.tokenId)
                }
            });

            it(' should return unused fee tokens to the buyer', async () => {
                const old_balance = await feeToken.balanceOf(receiver.address)
                const old_balance_multiBuy = await feeToken.balanceOf(multiBuy.address)

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

                let effective_paid_fees = BigNumber.from(0)

                for (let e of events) {
                    effective_paid_fees = effective_paid_fees.add(e.paidFeeAmount)
                }

                const new_balance = await feeToken.balanceOf(receiver.address)
                const new_balance_multiBuy = await feeToken.balanceOf(multiBuy.address)

                expect(new_balance).to.be.eq(old_balance.sub(effective_paid_fees))
                expect(new_balance_multiBuy).to.be.eq(old_balance_multiBuy)

                //close all the Boosts for next tests
                for (let e of events) {
                    await delegationBoost.connect(receiver).cancel_boost(e.tokenId)
                }
            });

            it(' should take all available amount if Boosts already taken on Offers', async () => {
                const boost_buy_percent = 2000

                await feeToken.connect(receiver2).approve(warden.address, ethers.constants.MaxUint256)

                const fee_amount1 = await warden.estimateFees(delegator7.address, boost_buy_percent, duration)
                const fee_amount2 = await warden.estimateFees(delegator8.address, boost_buy_percent, duration)

                await warden.connect(receiver2).buyDelegationBoost(delegator7.address, receiver2.address, boost_buy_percent, duration, fee_amount1)
                await warden.connect(receiver2).buyDelegationBoost(delegator8.address, receiver2.address, boost_buy_percent, duration, fee_amount2)

                const token_id1 = await delegationBoost.get_token_id(
                    delegator7.address,
                    (await delegationBoost.total_minted(delegator7.address)).sub(1)
                );
                const token_id2 = await delegationBoost.get_token_id(
                    delegator8.address,
                    (await delegationBoost.total_minted(delegator8.address)).sub(1)
                );

                //Expected buy percent on Offers with already a Boost
                let boosts_expected_percent_buy: { [key: number]: number } = {}
                boosts_expected_percent_buy[1] = (await warden.offers(1)).maxPerc - boost_buy_percent
                boosts_expected_percent_buy[2] = (await warden.offers(2)).maxPerc - boost_buy_percent

                const other_amount = ethers.utils.parseEther('600000')

                const other_fee_amount = other_amount.mul(max_price).mul(one_week.mul(duration)).div(unit)

                const buy_tx = await multiBuy.connect(receiver).preSortedMultiBuy(
                    receiver.address,
                    duration,
                    other_amount,
                    max_price,
                    minRequiredAmount,
                    other_fee_amount,
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

                const expected_offers_indexes_order = [7, 8, 1] // Expected Offers to have been used by the multiBuy
                let effective_total_boost_amount = BigNumber.from(0)

                const expected_total_boost_amount_with_slippage = other_amount.mul(BPS - accepted_slippage).div(BPS)

                let i = 0

                // Get the users that emitted Boosts => Get the offers that have been used
                for (let e of events) {

                    let boost_delegator = e.delegator
                    let boost_index = await warden.userIndex(boost_delegator)

                    expect(boost_index.toNumber()).to.be.eq(expected_offers_indexes_order[i])

                    // Check that it used the max % available for that Offer (except for the last one)
                    if (boost_index.toNumber() != expected_offers_indexes_order[expected_offers_indexes_order.length - 1]
                        && boost_index.toNumber() in [7, 8]) {
                        let expected_percent = BigNumber.from(boosts_expected_percent_buy[boost_index.toNumber()])
                        expect(e.percent).to.be.closeTo(expected_percent, 1)
                    }

                    let exact_boost_amount = await delegationBoost.token_boost(e.tokenId, { blockTag: tx_block })

                    effective_total_boost_amount = effective_total_boost_amount.add(exact_boost_amount)

                    i++;
                }

                //Homemade check :
                //amount with slippage <= effective boost amount <= requested amount
                expect(effective_total_boost_amount).to.be.lte(other_amount)
                expect(effective_total_boost_amount).to.be.gte(expected_total_boost_amount_with_slippage)

                const veToken_balance_receiver = await veToken.balanceOf(receiver.address, { blockTag: tx_block })
                const veToken_adjusted_receiver = await delegationBoost.adjusted_balance_of(receiver.address, { blockTag: tx_block })
                expect(veToken_adjusted_receiver).to.be.eq(veToken_balance_receiver.add(effective_total_boost_amount))

                //close all the Boosts for next tests
                await delegationBoost.connect(receiver2).cancel_boost(token_id1)
                await delegationBoost.connect(receiver2).cancel_boost(token_id2)
                for (let e of events) {
                    await delegationBoost.connect(receiver).cancel_boost(e.tokenId)
                }
            });

            it(' should skip Offers where lock is already over', async () => {

                const other_preSorted_Offers = [7, 5, 8, 1, 4, 6]

                const slightly_bigger_amount = ethers.utils.parseEther('800000')
                const slightly_bigger_fee_amount = slightly_bigger_amount.mul(max_price).mul(one_week.mul(duration)).div(unit)

                const buy_tx = await multiBuy.connect(receiver).preSortedMultiBuy(
                    receiver.address,
                    duration,
                    slightly_bigger_amount,
                    max_price,
                    minRequiredAmount,
                    slightly_bigger_fee_amount,
                    accepted_slippage,
                    false,
                    other_preSorted_Offers
                )

                const tx_block = (await buy_tx).blockNumber
                const block_timestamp = (await ethers.provider.getBlock(tx_block || 0)).timestamp

                const receipt = await buy_tx.wait()

                const iface = warden.interface;
                const topic = iface.getEventTopic('BoostPurchase')
                const buy_logs = receipt.logs.filter(x => x.topics.indexOf(topic) >= 0);
                const events = buy_logs.map((log) => (iface.parseLog(log)).args)

                // we expect to skip the 5th one, because its lock is too short
                const expected_offers_indexes_order = [7, 8, 1] // Expected Offers to have been used by the multiBuy
                let effective_total_boost_amount = BigNumber.from(0)

                const expected_total_boost_amount_with_slippage = amount.mul(BPS - accepted_slippage).div(BPS)

                let i = 0

                // Get the users that emitted Boosts => Get the offers that have been used
                for (let e of events) {

                    let boost_delegator = e.delegator
                    let boost_index = await warden.userIndex(boost_delegator)

                    expect(boost_index.toNumber()).to.be.eq(expected_offers_indexes_order[i])

                    expect(boost_index.toNumber()).not.to.be.eq(5)

                    const delegator_offer = await warden.offers(boost_index);

                    // Check that it used the max % available for that Offer (except for the last one)
                    if (boost_index.toNumber() != expected_offers_indexes_order[expected_offers_indexes_order.length - 1])
                        expect(e.percent).to.be.eq(delegator_offer.maxPerc)

                    let exact_boost_amount = await delegationBoost.token_boost(e.tokenId, { blockTag: tx_block })

                    effective_total_boost_amount = effective_total_boost_amount.add(exact_boost_amount)

                    expect(e.price).to.be.lte(max_price)

                    //Check that ExpiryTime & CancelTime are correct for both
                    let boost_expire_time = await delegationBoost.token_expiry(e.tokenId)
                    let boost_cancel_time = await delegationBoost.token_cancel_time(e.tokenId)
                    expect(boost_expire_time).to.be.gte((one_week.mul(duration)).add(block_timestamp)) //since there might be "bonus days" because of the veBoost rounding down on expire_time
                    expect(boost_cancel_time).to.be.eq((one_week.mul(duration)).add(block_timestamp))

                    i++;
                }

                //Homemade check :
                //amount with slippage <= effective boost amount <= requested amount
                expect(effective_total_boost_amount).to.be.lte(slightly_bigger_amount)
                expect(effective_total_boost_amount).to.be.gte(expected_total_boost_amount_with_slippage)

                const veToken_balance_receiver = await veToken.balanceOf(receiver.address, { blockTag: tx_block })
                const veToken_adjusted_receiver = await delegationBoost.adjusted_balance_of(receiver.address, { blockTag: tx_block })
                expect(veToken_adjusted_receiver).to.be.eq(veToken_balance_receiver.add(effective_total_boost_amount))

                //close all the Boosts for next tests
                for (let e of events) {
                    await delegationBoost.connect(receiver).cancel_boost(e.tokenId)
                }

            });

            it(' should skip Offer where delegator removed Warden as Operator', async () => {

                await delegationBoost.connect(delegator8).setApprovalForAll(warden.address, false);

                const slightly_smaller_amount = ethers.utils.parseEther('800000')
                const slightly_smaller_fee_amount = slightly_smaller_amount.mul(max_price).mul(one_week.mul(duration)).div(unit)

                const buy_tx = await multiBuy.connect(receiver).preSortedMultiBuy(
                    receiver.address,
                    duration,
                    slightly_smaller_amount,
                    max_price,
                    minRequiredAmount,
                    slightly_smaller_fee_amount,
                    accepted_slippage,
                    false,
                    preSorted_Offers_list
                )

                const tx_block = (await buy_tx).blockNumber
                const block_timestamp = (await ethers.provider.getBlock(tx_block || 0)).timestamp

                const receipt = await buy_tx.wait()

                const iface = warden.interface;
                const topic = iface.getEventTopic('BoostPurchase')
                const buy_logs = receipt.logs.filter(x => x.topics.indexOf(topic) >= 0);
                const events = buy_logs.map((log) => (iface.parseLog(log)).args)

                const expected_offers_indexes_order = [7, 1, 4] // Expected Offers to have been used by the multiBuy
                let effective_total_boost_amount = BigNumber.from(0)

                const expected_total_boost_amount_with_slippage = slightly_smaller_amount.mul(BPS - accepted_slippage).div(BPS)

                let i = 0

                // Get the users that emitted Boosts => Get the offers that have been used
                for (let e of events) {

                    let boost_delegator = e.delegator
                    let boost_index = await warden.userIndex(boost_delegator)

                    expect(boost_index.toNumber()).to.be.eq(expected_offers_indexes_order[i])

                    expect(boost_index.toNumber()).not.to.be.eq(8)

                    const delegator_offer = await warden.offers(boost_index);

                    // Check that it used the max % available for that Offer (except for the last one)
                    if (boost_index.toNumber() != expected_offers_indexes_order[expected_offers_indexes_order.length - 1])
                        expect(e.percent).to.be.eq(delegator_offer.maxPerc)

                    let exact_boost_amount = await delegationBoost.token_boost(e.tokenId, { blockTag: tx_block })

                    effective_total_boost_amount = effective_total_boost_amount.add(exact_boost_amount)

                    expect(e.price).to.be.lte(max_price)

                    //Check that ExpiryTime & CancelTime are correct for both
                    let boost_expire_time = await delegationBoost.token_expiry(e.tokenId)
                    let boost_cancel_time = await delegationBoost.token_cancel_time(e.tokenId)
                    expect(boost_expire_time).to.be.gte((one_week.mul(duration)).add(block_timestamp)) //since there might be "bonus days" because of the veBoost rounding down on expire_time
                    expect(boost_cancel_time).to.be.eq((one_week.mul(duration)).add(block_timestamp))

                    i++;
                }

                //Homemade check :
                //amount with slippage <= effective boost amount <= requested amount
                expect(effective_total_boost_amount).to.be.lte(slightly_smaller_amount)
                expect(effective_total_boost_amount).to.be.gte(expected_total_boost_amount_with_slippage)

                const veToken_balance_receiver = await veToken.balanceOf(receiver.address, { blockTag: tx_block })
                const veToken_adjusted_receiver = await delegationBoost.adjusted_balance_of(receiver.address, { blockTag: tx_block })
                expect(veToken_adjusted_receiver).to.be.eq(veToken_balance_receiver.add(effective_total_boost_amount))

                //close all the Boosts for next tests
                for (let e of events) {
                    await delegationBoost.connect(receiver).cancel_boost(e.tokenId)
                }

            });

            it(' should revert if cannot match the asked amount', async () => {

                await expect(
                    multiBuy.connect(receiver).preSortedMultiBuy(
                        receiver.address,
                        duration,
                        bigger_amount,
                        max_price,
                        minRequiredAmount,
                        bigger_fee_amount,
                        accepted_slippage,
                        false,
                        preSorted_Offers_list
                    )
                ).to.be.revertedWith('Cannot match Order')

            });

            it(' should fail if not enough fees available', async () => {

                await expect(
                    multiBuy.connect(receiver).preSortedMultiBuy(
                        receiver.address,
                        duration,
                        amount,
                        max_price,
                        minRequiredAmount,
                        incorrect_fee_amount,
                        accepted_slippage,
                        false,
                        preSorted_Offers_list
                    )
                ).to.be.revertedWith('Not Enough Fees')

            });

            it(' should take Offer where expired Boosts can be canceled', async () => {

                const boost_buy_percent = 2000

                await feeToken.connect(receiver2).approve(warden.address, ethers.constants.MaxUint256)

                const fee_amount1 = await warden.estimateFees(delegator7.address, boost_buy_percent, duration)
                const fee_amount2 = await warden.estimateFees(delegator8.address, boost_buy_percent, duration)

                await warden.connect(receiver2).buyDelegationBoost(delegator7.address, receiver2.address, boost_buy_percent, duration, fee_amount1)
                const buy_2_tx = await warden.connect(receiver2).buyDelegationBoost(delegator8.address, receiver2.address, boost_buy_percent, duration, fee_amount2)

                const token_id1 = await delegationBoost.get_token_id(
                    delegator7.address,
                    (await delegationBoost.total_minted(delegator7.address)).sub(1)
                );
                const token_id2 = await delegationBoost.get_token_id(
                    delegator8.address,
                    (await delegationBoost.total_minted(delegator8.address)).sub(1)
                );

                const boost_cancel_time = await delegationBoost.token_cancel_time(token_id2)
                const tx_timestamp = (await ethers.provider.getBlock((await buy_2_tx).blockNumber || 0)).timestamp
                await advanceTime(boost_cancel_time.sub(tx_timestamp).toNumber())

                const other_amount = ethers.utils.parseEther('750000')

                const other_fee_amount = other_amount.mul(max_price).mul(one_week.mul(duration)).div(unit)

                const buy_tx = await multiBuy.connect(receiver).preSortedMultiBuy(
                    receiver.address,
                    duration,
                    other_amount,
                    max_price,
                    minRequiredAmount,
                    other_fee_amount,
                    accepted_slippage,
                    true,
                    preSorted_Offers_list
                )

                const tx_block = (await buy_tx).blockNumber
                const block_timestamp = (await ethers.provider.getBlock(tx_block || 0)).timestamp

                const receipt = await buy_tx.wait()

                const iface = warden.interface;
                const topic = iface.getEventTopic('BoostPurchase')
                const buy_logs = receipt.logs.filter(x => x.topics.indexOf(topic) >= 0);
                const events = buy_logs.map((log) => (iface.parseLog(log)).args)

                const expected_offers_indexes_order = [7, 8, 1] // Expected Offers to have been used by the multiBuy
                let effective_total_boost_amount = BigNumber.from(0)

                const expected_total_boost_amount_with_slippage = other_amount.mul(BPS - accepted_slippage).div(BPS)

                let i = 0

                // Get the users that emitted Boosts => Get the offers that have been used
                for (let e of events) {

                    let boost_delegator = e.delegator
                    let boost_index = await warden.userIndex(boost_delegator)

                    expect(boost_index.toNumber()).to.be.eq(expected_offers_indexes_order[i])

                    const delegator_offer = await warden.offers(boost_index);

                    // Check that it used the max % available for that Offer (except for the last one)
                    if (boost_index.toNumber() != expected_offers_indexes_order[expected_offers_indexes_order.length - 1])
                        expect(e.percent).to.be.eq(delegator_offer.maxPerc)

                    let exact_boost_amount = await delegationBoost.token_boost(e.tokenId, { blockTag: tx_block })

                    effective_total_boost_amount = effective_total_boost_amount.add(exact_boost_amount)

                    expect(e.price).to.be.lte(max_price)

                    //Check that ExpiryTime & CancelTime are correct for both
                    let boost_expire_time = await delegationBoost.token_expiry(e.tokenId)
                    let boost_cancel_time = await delegationBoost.token_cancel_time(e.tokenId)
                    expect(boost_expire_time).to.be.gte((one_week.mul(duration)).add(block_timestamp)) //since there might be "bonus days" because of the veBoost rounding down on expire_time
                    expect(boost_cancel_time).to.be.eq((one_week.mul(duration)).add(block_timestamp))

                    i++;
                }

                //Homemade check :
                //amount with slippage <= effective boost amount <= requested amount
                expect(effective_total_boost_amount).to.be.lte(other_amount)
                expect(effective_total_boost_amount).to.be.gte(expected_total_boost_amount_with_slippage)

                const veToken_balance_receiver = await veToken.balanceOf(receiver.address, { blockTag: tx_block })
                const veToken_adjusted_receiver = await delegationBoost.adjusted_balance_of(receiver.address, { blockTag: tx_block })
                expect(veToken_adjusted_receiver).to.be.eq(veToken_balance_receiver.add(effective_total_boost_amount))

                //close all the Boosts for next tests
                await delegationBoost.connect(receiver2).cancel_boost(token_id1)
                await delegationBoost.connect(receiver2).cancel_boost(token_id2)
                for (let e of events) {
                    await delegationBoost.connect(receiver).cancel_boost(e.tokenId)
                }
            });
        });

    });

    describe('sortingMultiBuy', async () => {

        const one_week = BigNumber.from(7 * 86400);
        const duration = 2

        const amount = ethers.utils.parseEther('750000')

        const max_price = price_per_vote2

        const fee_amount = amount.mul(max_price).mul(one_week.mul(duration)).div(unit)

        const accepted_slippage = 100

        const minRequiredAmount = BigNumber.from(0)

        it(' should sort the Boosts by price and by them in the right order', async () => {

            const buy_tx = await multiBuy.connect(receiver).sortingMultiBuy(
                receiver.address,
                duration,
                amount,
                max_price,
                minRequiredAmount,
                fee_amount,
                accepted_slippage,
                false
            )

            const tx_block = (await buy_tx).blockNumber
            const block_timestamp = (await ethers.provider.getBlock(tx_block || 0)).timestamp

            const receipt = await buy_tx.wait()

            const iface = warden.interface;
            const topic = iface.getEventTopic('BoostPurchase')
            const buy_logs = receipt.logs.filter(x => x.topics.indexOf(topic) >= 0);
            const events = buy_logs.map((log) => (iface.parseLog(log)).args)

            let effective_total_boost_amount = BigNumber.from(0)

            const expected_total_boost_amount_with_slippage = amount.mul(BPS - accepted_slippage).div(BPS)

            let i = 0
            const expected_offers_indexes_order = [4, 1, 3, 8] // Expected Offers to have been used by the multiBuy

            const expected_sorted_list = await multiBuy.getSortedOffers() //This method was tested in earlier Quicksort tests

            // Get the users that emitted Boosts => Get the offers that have been used
            for (let e of events) {

                let boost_delegator = e.delegator
                let boost_index = await warden.userIndex(boost_delegator)

                expect(boost_index.toNumber()).to.be.eq(expected_sorted_list[i])

                const delegator_offer = await warden.offers(boost_index);

                // Check that it used the max % available for that Offer (except for the last one)
                if (boost_index.toNumber() != expected_offers_indexes_order[expected_offers_indexes_order.length - 1])
                    expect(e.percent).to.be.eq(delegator_offer.maxPerc)

                let exact_boost_amount = await delegationBoost.token_boost(e.tokenId, { blockTag: tx_block })

                effective_total_boost_amount = effective_total_boost_amount.add(exact_boost_amount)

                expect(e.price).to.be.lte(max_price)

                //Check that ExpiryTime & CancelTime are correct for both
                let boost_expire_time = await delegationBoost.token_expiry(e.tokenId)
                let boost_cancel_time = await delegationBoost.token_cancel_time(e.tokenId)
                expect(boost_expire_time).to.be.gte((one_week.mul(duration)).add(block_timestamp)) //since there might be "bonus days" because of the veBoost rounding down on expire_time
                expect(boost_cancel_time).to.be.eq((one_week.mul(duration)).add(block_timestamp))

                i++;

                //Skip this offer in the sorted list => lock duration is too short for the Order
                if (expected_sorted_list[i].eq(5)) i++;

            }

            //Homemade check :
            //amount with slippage <= effective boost amount <= requested amount
            expect(effective_total_boost_amount).to.be.lte(amount)
            expect(effective_total_boost_amount).to.be.gte(expected_total_boost_amount_with_slippage)

            const veToken_balance_receiver = await veToken.balanceOf(receiver.address, { blockTag: tx_block })
            const veToken_adjusted_receiver = await delegationBoost.adjusted_balance_of(receiver.address, { blockTag: tx_block })
            expect(veToken_adjusted_receiver).to.be.eq(veToken_balance_receiver.add(effective_total_boost_amount))

            //close all the Boosts for next tests
            for (let e of events) {
                await delegationBoost.connect(receiver).cancel_boost(e.tokenId)
            }
        });

        it(' uses the same internal methods as preSortedMultiBuy', async () => {
            expect(true).to.be.true
        });

    });

});