const hre = require("hardhat");
import { ethers, waffle } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { Warden } from "../typechain/Warden";
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
    getTimestamp,
    setBlockTimestamp,
    advanceTime,
    getERC20,
    stopAutoMine,
    startAutoMine,
    mineNextBlock
} from "./utils/utils";

const { TOKEN_ADDRESS, VOTING_ESCROW_ADDRESS, BOOST_DELEGATION_ADDRESS, BIG_HOLDER, VECRV_LOCKING_TIME } = require("./utils/constant");


chai.use(solidity);
const { expect } = chai;
const { provider } = ethers;


let wardenFactory: ContractFactory


describe('Warden contract tests', () => {
    let admin: SignerWithAddress
    let reserveManager: SignerWithAddress
    let delegator: SignerWithAddress
    let receiver: SignerWithAddress
    let externalUser: SignerWithAddress

    let warden: Warden

    let CRV: IERC20
    let veCRV: IVotingEscrow
    let delegationBoost: IVotingEscrowDelegation

    const price_per_vote = BigNumber.from(8.25 * 1e10) // ~ 50CRV for a 1000 veCRV boost for a week

    before(async () => {
        [admin, reserveManager, delegator, receiver, externalUser] = await ethers.getSigners();

        wardenFactory = await ethers.getContractFactory("Warden");

        const crv_amount = ethers.utils.parseEther('3000');
        const lock_amount = ethers.utils.parseEther('1000');

        CRV = IERC20__factory.connect(TOKEN_ADDRESS, provider);

        veCRV = IVotingEscrow__factory.connect(VOTING_ESCROW_ADDRESS, provider);

        delegationBoost = IVotingEscrowDelegation__factory.connect(BOOST_DELEGATION_ADDRESS, provider);

        await getERC20(admin, BIG_HOLDER, CRV, delegator.address, crv_amount);

        await CRV.connect(delegator).approve(veCRV.address, crv_amount);
        const lock_time = (await ethers.provider.getBlock(ethers.provider.blockNumber)).timestamp + VECRV_LOCKING_TIME
        await veCRV.connect(delegator).create_lock(lock_amount, lock_time);

        await CRV.connect(delegator).transfer(receiver.address, crv_amount.sub(lock_amount));

    })


    beforeEach(async () => {

        warden = (await wardenFactory.connect(admin).deploy(
            CRV.address,
            veCRV.address,
            delegationBoost.address,
            500, //5%
            1000 //10%
        )) as Warden;
        await warden.deployed();

        await delegationBoost.connect(delegator).setApprovalForAll(warden.address, true);
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

    });


    describe('register', async () => {

        const min_perc = 2000
        const max_perc = 10000

        const low_max_perc = 1500

        const incorrect_min_perc = 500
        const incorrect_max_perc = 10100

        it(' should register the delegator and add to the listing', async () => {

            const old_offersIndex = await warden.offersIndex();

            const register_tx = await warden.connect(delegator).register(price_per_vote, min_perc, max_perc);

            await expect(register_tx)
                .to.emit(warden, 'Registred')
                .withArgs(delegator.address, price_per_vote);

            const new_offersIndex = await warden.offersIndex();

            const delegator_index = await warden.userIndex(delegator.address);

            const delegator_offer = await warden.offers(delegator_index);

            expect(new_offersIndex).to.be.eq(old_offersIndex.add(1));

            expect(delegator_index).not.to.be.eq(0);

            expect(delegator_offer.user).to.be.eq(delegator.address);
            expect(delegator_offer.pricePerVote).to.be.eq(price_per_vote);
            expect(delegator_offer.minPerc).to.be.eq(min_perc);
            expect(delegator_offer.maxPerc).to.be.eq(max_perc);

        });

        it(' should fail if parameters are invalid', async () => {

            await expect(
                warden.connect(delegator).register(0, min_perc, max_perc)
            ).to.be.revertedWith('Warden: Price cannot be 0')

            await expect(
                warden.connect(delegator).register(price_per_vote, min_perc, low_max_perc)
            ).to.be.revertedWith('Warden: minPerc is over maxPerc')

            await expect(
                warden.connect(delegator).register(price_per_vote, min_perc, incorrect_max_perc)
            ).to.be.revertedWith('Warden: maxPerc too high')

            await expect(
                warden.connect(delegator).register(price_per_vote, incorrect_min_perc, max_perc)
            ).to.be.revertedWith('Warden: minPerc too low')

        });

        it(' should fail if warden is not operator for the delegator', async () => {

            await delegationBoost.connect(delegator).setApprovalForAll(warden.address, false)

            await expect(
                warden.connect(delegator).register(price_per_vote, min_perc, max_perc)
            ).to.be.revertedWith('Warden: Not operator for caller')

        });

        it(' should fail if delegator is already registered', async () => {

            await warden.connect(delegator).register(price_per_vote, min_perc, max_perc)

            await expect(
                warden.connect(delegator).register(price_per_vote, min_perc, max_perc)
            ).to.be.revertedWith('Warden: Already registered')

        });

    });


    describe('updateOffer', async () => {

        const min_perc = 2000
        const max_perc = 10000

        const new_min_perc = 1500
        const new_max_perc = 8000

        const new_price_per_vote = price_per_vote.div(2)

        const low_max_perc = 1000

        const incorrect_min_perc = 500
        const incorrect_max_perc = 10100

        beforeEach(async () => {

            await warden.connect(delegator).register(price_per_vote, min_perc, max_perc);

        });

        it(' should update the delegator BoostOffer correctly', async () => {

            const update_tx = await warden.connect(delegator).updateOffer(new_price_per_vote, new_min_perc, new_max_perc)

            await expect(update_tx)
                .to.emit(warden, 'UpdateOffer')
                .withArgs(delegator.address, new_price_per_vote);

            const delegator_index = await warden.userIndex(delegator.address);

            const delegator_offer = await warden.offers(delegator_index);

            expect(delegator_index).not.to.be.eq(0);

            expect(delegator_offer.user).to.be.eq(delegator.address);
            expect(delegator_offer.pricePerVote).to.be.eq(new_price_per_vote);
            expect(delegator_offer.minPerc).to.be.eq(new_min_perc);
            expect(delegator_offer.maxPerc).to.be.eq(new_max_perc);

        });

        it(' should fail if parameters are invalid', async () => {

            await expect(
                warden.connect(delegator).updateOffer(0, new_min_perc, new_max_perc)
            ).to.be.revertedWith('Warden: Price cannot be 0')

            await expect(
                warden.connect(delegator).updateOffer(price_per_vote, new_min_perc, low_max_perc)
            ).to.be.revertedWith('Warden: minPerc is over maxPerc')

            await expect(
                warden.connect(delegator).updateOffer(price_per_vote, new_min_perc, incorrect_max_perc)
            ).to.be.revertedWith('Warden: maxPerc too high')

            await expect(
                warden.connect(delegator).updateOffer(price_per_vote, incorrect_min_perc, new_max_perc)
            ).to.be.revertedWith('Warden: minPerc too low')

        });

        it(' should fail if user is not registered yet', async () => {

            await expect(
                warden.connect(externalUser).updateOffer(new_price_per_vote, new_min_perc, new_max_perc)
            ).to.be.revertedWith('Warden: Not registered')

        });

    });


    describe('quit', async () => {

        const min_perc = 2000
        const max_perc = 10000

        beforeEach(async () => {

            await warden.connect(delegator).register(price_per_vote, min_perc, max_perc);

        });

        it(' should remove the BoostOffer and the delegator from the listing', async () => {

            const old_offersIndex = await warden.offersIndex();

            const quit_tx = await warden.connect(delegator).quit()

            await expect(quit_tx)
                .to.emit(warden, 'Quit')
                .withArgs(delegator.address);

            const new_offersIndex = await warden.offersIndex();

            const delegator_index = await warden.userIndex(delegator.address);

            const delegator_offer = await warden.offers(delegator_index);

            expect(new_offersIndex).to.be.eq(old_offersIndex.sub(1));

            expect(delegator_index).to.be.eq(0);

            expect(delegator_offer.user).to.be.eq(ethers.constants.AddressZero);
            expect(delegator_offer.pricePerVote).to.be.eq(0);
            expect(delegator_offer.minPerc).to.be.eq(0);
            expect(delegator_offer.maxPerc).to.be.eq(0);

        });

        it(' should change other users Boost index if was not last of the list', async () => {

            await delegationBoost.connect(externalUser).setApprovalForAll(warden.address, true);
            await warden.connect(externalUser).register(price_per_vote, min_perc, max_perc);

            const old_delegator_index = await warden.userIndex(delegator.address);
            const old_externalUser_index = await warden.userIndex(externalUser.address);
            const externalUser_offer_before = await warden.offers(old_externalUser_index);

            await warden.connect(delegator).quit()

            const new_externalUser_index = await warden.userIndex(externalUser.address);
            const externalUser_offer_after = await warden.offers(new_externalUser_index);

            expect(new_externalUser_index).not.to.be.eq(old_externalUser_index);
            expect(new_externalUser_index).to.be.eq(old_delegator_index);

            expect(externalUser_offer_after.user).to.be.eq(externalUser.address);

            expect(externalUser_offer_before.user).to.be.eq(externalUser_offer_after.user);
            expect(externalUser_offer_before.pricePerVote).to.be.eq(externalUser_offer_after.pricePerVote);
            expect(externalUser_offer_before.minPerc).to.be.eq(externalUser_offer_after.minPerc);
            expect(externalUser_offer_before.maxPerc).to.be.eq(externalUser_offer_after.maxPerc);

        });

        it(' should claim remaining earnedFees', async () => {

            const fee_amount = ethers.utils.parseEther('50');

            await CRV.connect(receiver).approve(warden.address, fee_amount)
            await warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, 10000, 1, fee_amount);

            //cancel the current Boost (from the receiver)
            const token_id = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1)
            );
            await delegationBoost.connect(receiver).cancel_boost(token_id);

            const earned_fees = await warden.earnedFees(delegator.address)

            const old_delegator_balance = await CRV.balanceOf(delegator.address)

            await warden.connect(delegator).quit()

            const new_delegator_balance = await CRV.balanceOf(delegator.address)

            expect(new_delegator_balance.sub(old_delegator_balance)).to.be.eq(earned_fees)

        });

        it(' should fail if user is not registered', async () => {

            await expect(
                warden.connect(externalUser).quit()
            ).to.be.revertedWith('Warden: Not registered')

        });

    });


    describe('estimateFees', async () => {

        const min_perc = 2000
        const max_perc = 10000

        const wanted_perc = 5000
        const wanted_duration = 1 //weeks

        const incorrect_min_perc = 1500
        const incorrect_max_perc = 8000
        const under_required_min_perc = 500
        const overflow_max_perc = 10100
        const incorrect_duration = 0 //weeks

        beforeEach(async () => {

            await warden.connect(delegator).register(price_per_vote, min_perc, max_perc);

        });

        it(' should return an estimated price', async () => {

            const estimated_amount = await warden.connect(receiver).estimateFees(
                delegator.address,
                wanted_perc,
                wanted_duration
            )

            //Since veCRV has deteriorating balance, we look for an amount between 2 bounds
            expect(estimated_amount).to.be.gte(ethers.utils.parseEther('24'))
            expect(estimated_amount).to.be.lte(ethers.utils.parseEther('25'))

        });

        it(' should fail if given incorrect parameters', async () => {

            await expect(
                warden.connect(receiver).estimateFees(ethers.constants.AddressZero, wanted_perc, wanted_duration)
            ).to.be.revertedWith('Warden: Zero address')

            await expect(
                warden.connect(receiver).estimateFees(externalUser.address, wanted_perc, wanted_duration)
            ).to.be.revertedWith('Warden: Not registered')

            await expect(
                warden.connect(receiver).estimateFees(delegator.address, under_required_min_perc, wanted_duration)
            ).to.be.revertedWith('Warden: Percent under min required')

            await expect(
                warden.connect(receiver).estimateFees(delegator.address, overflow_max_perc, wanted_duration)
            ).to.be.revertedWith('Warden: Percent over 100')

            await expect(
                warden.connect(receiver).estimateFees(delegator.address, wanted_perc, incorrect_duration)
            ).to.be.revertedWith('Warden: Duration too short')

        });

        it(' should fail if parameters do not match delegator Offer', async () => {

            await warden.connect(delegator).updateOffer(price_per_vote, min_perc, 7500)

            await expect(
                warden.connect(receiver).estimateFees(delegator.address, incorrect_min_perc, wanted_duration)
            ).to.be.revertedWith('Warden: Percent out of Offer bounds')

            await expect(
                warden.connect(receiver).estimateFees(delegator.address, incorrect_max_perc, wanted_duration)
            ).to.be.revertedWith('Warden: Percent out of Offer bounds')

        });

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

            await CRV.connect(receiver).approve(warden.address, ethers.constants.MaxUint256)

        });

        it(' should create a Boost from the delegator to the caller', async () => {

            const old_balance = await CRV.balanceOf(receiver.address)

            const buy_tx = await warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, buy_percent, duration, fee_amount)

            const new_balance = await CRV.balanceOf(receiver.address)

            const token_id = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1)
            );

            const tx_timestamp = (await ethers.provider.getBlock((await buy_tx).blockNumber || 0)).timestamp

            const boost_amount = await delegationBoost.token_boost(token_id)
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

            expect(boost_amount).not.to.be.eq(0)
            expect(boost_expire_time).to.be.gte(tx_timestamp + (duration * one_week)) //since there might be "bonus days" because of the veBoost rounding down on expire_time
            expect(boost_cancel_time).to.be.eq(tx_timestamp + (duration * one_week))

            // Cancel Boost by receiver (so delegator is available for later tests)
            await delegationBoost.connect(receiver).cancel_boost(token_id)

        });

        it(' should fail if given 0x000...000 as parameter', async () => {

            await expect(
                warden.connect(receiver).buyDelegationBoost(ethers.constants.AddressZero, receiver.address, buy_percent, duration, fee_amount)
            ).to.be.revertedWith('Warden: Zero address')

            await expect(
                warden.connect(receiver).buyDelegationBoost(delegator.address, ethers.constants.AddressZero, buy_percent, duration, fee_amount)
            ).to.be.revertedWith('Warden: Zero address')

        });

        it(' should fail if wanted delegator is not registered', async () => {

            await expect(
                warden.connect(receiver).buyDelegationBoost(externalUser.address, receiver.address, buy_percent, duration, fee_amount)
            ).to.be.revertedWith('Warden: Not registered')

        });

        it(' should fail if percent is invalid', async () => {

            await expect(
                warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, under_min_required_perc, duration, fee_amount)
            ).to.be.revertedWith('Warden: Percent under min required')

            await expect(
                warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, over_max_perc, duration, fee_amount)
            ).to.be.revertedWith('Warden: Percent over 100')

        });

        it(' should fail if asked percent does not match Offer', async () => {

            await warden.connect(delegator).updateOffer(price_per_vote, min_perc, updated_max_perc);

            await expect(
                warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, wrong_min_perc, duration, fee_amount)
            ).to.be.revertedWith('Warden: Percent out of Offer bounds')

            await expect(
                warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, wrong_max_perc, duration, fee_amount)
            ).to.be.revertedWith('Warden: Percent out of Offer bounds')

        });

        it(' should fail if asked duration is less than minmum required', async () => {

            await expect(
                warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, buy_percent, wrong_duration, fee_amount)
            ).to.be.revertedWith('Warden: Duration too short')

        });

        it(' should fail if allowed fee amount is 0 or does not cover the Boost duration', async () => {

            await expect(
                warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, buy_percent, duration, 0)
            ).to.be.revertedWith('Warden: No fees')

            await expect(
                warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, buy_percent, duration, fee_amount.div(2))
            ).to.be.revertedWith('Warden: Fees do not cover Boost duration')

        });

        it(' should fail if contract has not enough allowance for the fee token', async () => {

            await CRV.connect(receiver).approve(warden.address, 0)

            await expect(
                warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, buy_percent, duration, fee_amount)
            ).to.be.reverted

        });

        it(' should fail if wanted delegator did not approve Warden', async () => {

            await delegationBoost.connect(delegator).setApprovalForAll(warden.address, false);

            await expect(
                warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, buy_percent, duration, fee_amount)
            ).to.be.revertedWith('Warden: Cannot delegate')

        });

        it(' should fail is caller cannot pay the fees', async () => {

            await expect(
                warden.connect(externalUser).buyDelegationBoost(delegator.address, receiver.address, buy_percent, duration, fee_amount)
            ).to.be.reverted

        });

        it(' should fail if 1 Boost already bought and 2nd Boost percent is out of delegator Offer', async () => {

            await warden.connect(delegator).updateOffer(price_per_vote, min_perc, updated_max_perc);

            await warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, buy_percent, duration, fee_amount)

            const token_id_1 = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1)
            );

            const boost_2_percent = 5000

            await expect(
                warden.connect(externalUser).buyDelegationBoost(delegator.address, receiver.address, boost_2_percent, duration, fee_amount)
            ).to.be.revertedWith('Warden: Cannot delegate')

            // Cancel Boost by receiver (so delegator is available for later tests)
            await delegationBoost.connect(receiver).cancel_boost(token_id_1)

        });

        it(' should buy a 2nd Boost if the parameters are correct and the delegators Offer allow it', async () => {

            await warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, buy_percent, duration, fee_amount)

            const token_id_1 = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1)
            );

            const boost_2_percent = 5000

            await warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, boost_2_percent, duration, fee_amount)

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

            const buy_1_tx = await warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, bigger_percent, duration, bigger_fee_amount)

            const token_id_1 = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1)
            );

            const boost_cancel_time = await delegationBoost.token_cancel_time(token_id_1)
            const tx_timestamp = (await ethers.provider.getBlock((await buy_1_tx).blockNumber || 0)).timestamp
            await advanceTime(boost_cancel_time.sub(tx_timestamp).toNumber())

            const boost_2_percent = 5000

            await warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, boost_2_percent, duration, fee_amount)

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

            await warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, buy_percent, duration, fee_amount)

            const token_id_1 = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1)
            );

            await delegationBoost.connect(receiver).cancel_boost(token_id_1)

            const boost_2_percent = 5000

            await warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, boost_2_percent, duration, fee_amount)

            const token_id_2 = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1)
            );

            expect(await delegationBoost.token_boost(token_id_2)).not.to.be.eq(0)

            // Cancel Boost by receiver (so delegator is available for later tests)
            await delegationBoost.connect(receiver).cancel_boost(token_id_2)

        });

    });

    describe('cancelDelegationBoost', async () => {

        const min_perc = 2000
        const max_perc = 10000

        beforeEach(async () => {

            await warden.connect(delegator).register(price_per_vote, min_perc, max_perc);

            const fee_amount = ethers.utils.parseEther('50');

            await CRV.connect(receiver).approve(warden.address, fee_amount)
            await warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, 10000, 1, fee_amount);

        });

        it(' should allow the receiver to cancel the Boost through Warden anytime', async () => {

            const token_id = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1)
            );

            await expect(
                warden.connect(receiver).cancelDelegationBoost(token_id)
            ).to.be.revertedWith('Cannot cancel the boost')

            await delegationBoost.connect(receiver).setApprovalForAll(warden.address, true);

            await warden.connect(receiver).cancelDelegationBoost(token_id)

            expect(await delegationBoost.token_boost(token_id)).to.be.eq(0)
            expect(await delegationBoost.token_cancel_time(token_id)).to.be.eq(0)
            expect(await delegationBoost.token_expiry(token_id)).to.be.eq(0)

        });

        it(' should allow the delegator to cancel the Boost after cancel_time', async () => {

            const token_id = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1)
            );

            await expect(
                warden.connect(delegator).cancelDelegationBoost(token_id)
            ).to.be.revertedWith('Cannot cancel the boost')

            const current_time = (await ethers.provider.getBlock(await ethers.provider.blockNumber)).timestamp
            const cancel_time = await delegationBoost.token_cancel_time(token_id)
            const time_to_skip = cancel_time.sub(current_time)
            await advanceTime(time_to_skip.toNumber())

            await warden.connect(delegator).cancelDelegationBoost(token_id)

            expect(await delegationBoost.token_boost(token_id)).to.be.eq(0)
            expect(await delegationBoost.token_cancel_time(token_id)).to.be.eq(0)
            expect(await delegationBoost.token_expiry(token_id)).to.be.eq(0)

        });

        it(' should Cancel the Boost, and allow a new BoostPruchase', async () => {

            const token_id = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1)
            );

            await expect(
                warden.connect(delegator).cancelDelegationBoost(token_id)
            ).to.be.revertedWith('Cannot cancel the boost')

            const current_time = (await ethers.provider.getBlock(await ethers.provider.blockNumber)).timestamp
            const cancel_time = await delegationBoost.token_cancel_time(token_id)
            const time_to_skip = cancel_time.sub(current_time)
            await advanceTime(time_to_skip.toNumber())

            await warden.connect(delegator).cancelDelegationBoost(token_id)

            expect(await delegationBoost.token_boost(token_id)).to.be.eq(0)
            expect(await delegationBoost.token_cancel_time(token_id)).to.be.eq(0)
            expect(await delegationBoost.token_expiry(token_id)).to.be.eq(0)

            const fee_amount = ethers.utils.parseEther('50');

            await CRV.connect(receiver).approve(warden.address, 0)
            await CRV.connect(receiver).approve(warden.address, fee_amount)
            await warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, 10000, 1, fee_amount);

            // Cancel Boost by receiver (so delegator is available for later tests)
            const token_id2 = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1)
            );
            await delegationBoost.connect(receiver).cancel_boost(token_id2)

        });

        it(' should allow any caller to cancel the Boost after expire_time', async () => {

            const token_id = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1)
            );

            await expect(
                warden.connect(externalUser).cancelDelegationBoost(token_id)
            ).to.be.revertedWith('Cannot cancel the boost')

            const current_time = (await ethers.provider.getBlock(await ethers.provider.blockNumber)).timestamp
            const expire_time = await delegationBoost.token_expiry(token_id)
            const time_to_skip = expire_time.sub(current_time)
            await advanceTime(time_to_skip.toNumber())

            await warden.connect(externalUser).cancelDelegationBoost(token_id)

            expect(await delegationBoost.token_boost(token_id)).to.be.eq(0)
            expect(await delegationBoost.token_cancel_time(token_id)).to.be.eq(0)
            expect(await delegationBoost.token_expiry(token_id)).to.be.eq(0)

        });

    });


    describe('claim', async () => {

        const min_perc = 2000
        const max_perc = 10000

        beforeEach(async () => {

            await warden.connect(delegator).register(price_per_vote, min_perc, max_perc);

            const fee_amount = ethers.utils.parseEther('50');

            await CRV.connect(receiver).approve(warden.address, fee_amount)
            await warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, 10000, 1, fee_amount);

            //cancel the current Boost (from the receiver)
            const token_id = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1)
            );
            await delegationBoost.connect(receiver).cancel_boost(token_id);

        });

        it(' should claim earned amount and update delegators claimable amount', async () => {

            const earned = await warden.claimable(delegator.address)

            const old_Balance = await CRV.balanceOf(delegator.address)

            await expect(warden.connect(delegator)["claim()"]())
                .to.emit(warden, 'Claim')
                .withArgs(delegator.address, earned);

            const new_Balance = await CRV.balanceOf(delegator.address)

            expect(new_Balance.sub(old_Balance)).to.be.eq(earned)
            expect(await warden.claimable(delegator.address)).to.be.eq(0)

        });

        it(' should allow to claim only a part of the earned amount', async () => {

            const earned = await warden.claimable(delegator.address)
            const to_claim = earned.div(2)

            const old_Balance = await CRV.balanceOf(delegator.address)

            await expect(warden.connect(delegator)["claim(uint256)"](to_claim))
                .to.emit(warden, 'Claim')
                .withArgs(delegator.address, to_claim);

            const new_Balance = await CRV.balanceOf(delegator.address)

            expect(new_Balance.sub(old_Balance)).to.be.eq(to_claim)
            expect(await warden.claimable(delegator.address)).to.be.eq(earned.sub(to_claim))

        });

        it(' should not allow to claim 0 amount', async () => {

            await expect(
                warden.connect(externalUser)["claim()"]()
            ).to.be.revertedWith('Warden: Claim null amount')

            await expect(
                warden.connect(externalUser)["claim(uint256)"](0)
            ).to.be.revertedWith('Warden: Claim null amount')

        });

        it(' should not allow to claim more than earned', async () => {

            const earned = await warden.claimable(delegator.address)

            await expect(
                warden.connect(delegator)["claim(uint256)"](earned.mul(2))
            ).to.be.revertedWith('Warden: Amount too high')

        });

    });


    describe('claimAndCancel', async () => {

        const min_perc = 2000
        const max_perc = 10000

        const fee_amount = ethers.utils.parseEther('100');

        it(' should claim the earned amount, and cancel finished Boosts', async () => {

            await warden.connect(delegator).register(price_per_vote, min_perc, max_perc);

            await CRV.connect(receiver).approve(warden.address, fee_amount)
            await warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, 10000, 2, fee_amount);

            const token_id = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1)
            )

            const current_time = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp
            const cancel_time = await delegationBoost.token_cancel_time(token_id)
            const time_to_skip = cancel_time.sub(current_time)
            await advanceTime(time_to_skip.add(100).toNumber())

            const earned = await warden.claimable(delegator.address)

            const old_Balance = await CRV.balanceOf(delegator.address)

            await expect(warden.connect(delegator).claimAndCancel())
                .to.emit(warden, 'Claim')
                .withArgs(delegator.address, earned);

            const new_Balance = await CRV.balanceOf(delegator.address)

            expect(new_Balance.sub(old_Balance)).to.be.eq(earned)
            expect(await warden.claimable(delegator.address)).to.be.eq(0)

            expect(await delegationBoost.token_boost(token_id)).to.be.eq(0)
            expect(await delegationBoost.token_cancel_time(token_id)).to.be.eq(0)
            expect(await delegationBoost.token_expiry(token_id)).to.be.eq(0)

        });

        it(' should not claim if 0 fees to claim', async () => {

            await expect(
                warden.connect(externalUser).claimAndCancel()
            ).not.to.emit(warden, 'Claim')

        });

        it(' should claim the earned amount, and cancel finished Boosts, and allow new BoostPurchase', async () => {

            await warden.connect(delegator).register(price_per_vote, min_perc, max_perc);
            await CRV.connect(receiver).transfer(externalUser.address, fee_amount);

            await CRV.connect(receiver).approve(warden.address, fee_amount)
            await CRV.connect(externalUser).approve(warden.address, fee_amount)
            await warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, 4000, 2, fee_amount);
            await warden.connect(externalUser).buyDelegationBoost(delegator.address, externalUser.address, 3500, 3, fee_amount);

            const token_id = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1) //this way, should be last one created, lasting the longer
            )

            const current_time = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp
            const cancel_time = await delegationBoost.token_cancel_time(token_id)
            const time_to_skip = cancel_time.sub(current_time)
            await advanceTime(time_to_skip.add(100).toNumber())

            const earned = await warden.claimable(delegator.address)

            const old_Balance = await CRV.balanceOf(delegator.address)

            await expect(warden.connect(delegator).claimAndCancel())
                .to.emit(warden, 'Claim')
                .withArgs(delegator.address, earned);

            const new_Balance = await CRV.balanceOf(delegator.address)

            expect(new_Balance.sub(old_Balance)).to.be.eq(earned)
            expect(await warden.claimable(delegator.address)).to.be.eq(0)

            expect(await delegationBoost.token_boost(token_id)).to.be.eq(0)
            expect(await delegationBoost.token_cancel_time(token_id)).to.be.eq(0)
            expect(await delegationBoost.token_expiry(token_id)).to.be.eq(0)

            const buy_percent = 5000

            const duration = 2

            let fee_amount2 = await warden.estimateFees(delegator.address, buy_percent, duration)

            await CRV.connect(receiver).approve(warden.address, 0)
            await CRV.connect(receiver).approve(warden.address, ethers.constants.MaxUint256)

            const old_balance = await CRV.balanceOf(receiver.address)

            const buy_tx = await warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, buy_percent, duration, fee_amount2)

            const new_balance = await CRV.balanceOf(receiver.address)
            const paidFees = old_balance.sub(new_balance)

            const token_id2 = await delegationBoost.get_token_id(
                delegator.address,
                (await delegationBoost.total_minted(delegator.address)).sub(1)
            );

            const boost_amount = await delegationBoost.token_boost(token_id2)
            const boost_expire_time = await delegationBoost.token_expiry(token_id2)

            await expect(buy_tx)
                .to.emit(warden, 'BoostPurchase')
                .withArgs(
                    delegator.address,
                    receiver.address,
                    token_id2,
                    buy_percent,
                    price_per_vote,
                    paidFees,
                    boost_expire_time
                );

            expect(paidFees).to.be.lt(fee_amount)

            expect(boost_amount).not.to.be.eq(0)

            // Cancel Boost by receiver (so delegator is available for later tests)
            await delegationBoost.connect(receiver).cancel_boost(token_id2)

        });

    });


    describe('Admin functions', async () => {

        describe('pause', async () => {

            it(' should allow admin to pause the contract', async () => {

                await warden.connect(admin).pause();

                await expect(
                    warden.connect(delegator).register(price_per_vote, 2000, 10000)
                ).to.be.reverted

            });

            it(' should block non-admin caller', async () => {

                await expect(
                    warden.connect(externalUser).pause()
                ).to.be.reverted

            });

        });

        describe('unpause', async () => {

            it(' should allow the admin to unpause the contract', async () => {

                await warden.connect(admin).pause();

                await warden.connect(admin).unpause();

                await expect(
                    warden.connect(delegator).register(price_per_vote, 2000, 10000)
                ).not.to.be.reverted

            });

            it(' should block non-admin caller', async () => {

                await expect(
                    warden.connect(externalUser).unpause()
                ).to.be.reverted

            });

        });

        describe('blockClaim / unblockClaim', async () => {

            const min_perc = 2000
            const max_perc = 10000

            beforeEach(async () => {

                await warden.connect(delegator).register(price_per_vote, min_perc, max_perc);

                const fee_amount = ethers.utils.parseEther('50');

                await CRV.connect(receiver).approve(warden.address, fee_amount)
                await warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, 10000, 1, fee_amount);

                //cancel the current Boost (from the receiver)
                const token_id = await delegationBoost.get_token_id(
                    delegator.address,
                    (await delegationBoost.total_minted(delegator.address)).sub(1)
                );
                await delegationBoost.connect(receiver).cancel_boost(token_id);

            });

            it(' should allow admin to block fee claims', async () => {

                await warden.connect(admin).blockClaim();

                await expect(
                    warden.connect(delegator)["claim()"]()
                ).to.be.revertedWith("Warden: Claim blocked")

            });

            it(' should allow admin to unblock the fee claims', async () => {

                await warden.connect(admin).blockClaim()

                await expect(
                    warden.connect(delegator)["claim()"]()
                ).to.be.revertedWith("Warden: Claim blocked")

                await warden.connect(admin).unblockClaim()

                await expect(
                    warden.connect(delegator)["claim()"]()
                ).not.to.be.reverted

            });

            it(' should block non-admin caller', async () => {

                await expect(
                    warden.connect(externalUser).blockClaim()
                ).to.be.reverted

                await expect(
                    warden.connect(externalUser).unblockClaim()
                ).to.be.reverted

            });

        });

        describe('setMinPercRequired', async () => {

            it(' should allow admin to update the parameter', async () => {

                await warden.connect(admin).setFeeReserveRatio(3000)

                expect(await warden.feeReserveRatio()).to.be.eq(3000)

            });

            it(' should fail if parameter is invalid', async () => {

                await expect(
                    warden.connect(admin).setFeeReserveRatio(10000)
                ).to.be.reverted

            });

            it(' should block non-admin caller', async () => {

                await expect(
                    warden.connect(externalUser).setFeeReserveRatio(3000)
                ).to.be.reverted

            });

        });

        describe('setMinDelegationTime', async () => {

            const new_delegation_time = 86400 * 14; // 2 weeks

            it(' should allow admin to update the parameter', async () => {

                await warden.connect(admin).setMinDelegationTime(new_delegation_time)

                expect(await warden.minDelegationTime()).to.be.eq(new_delegation_time)

            });

            it(' should fail if parameter is invalid', async () => {

                await expect(
                    warden.connect(admin).setMinDelegationTime(0)
                ).to.be.reverted

            });

            it(' should block non-admin caller', async () => {

                await expect(
                    warden.connect(externalUser).setMinDelegationTime(new_delegation_time)
                ).to.be.reverted

            });

        });

        describe('setFeeReserveRatio', async () => {

            it(' should allow admin to update the parameter', async () => {

                await warden.connect(admin).setMinPercRequired(5000)

                expect(await warden.minPercRequired()).to.be.eq(5000)

            });

            it(' should fail if parameter is invalid', async () => {

                await expect(
                    warden.connect(admin).setMinPercRequired(0)
                ).to.be.reverted

                await expect(
                    warden.connect(admin).setMinPercRequired(15000)
                ).to.be.reverted

            });

            it(' should block non-admin caller', async () => {

                await expect(
                    warden.connect(externalUser).setMinPercRequired(5000)
                ).to.be.reverted

            });

        });

        describe('setReserveManager', async () => {

            it(' should allow admin to update the parameter', async () => {

                await warden.connect(admin).setReserveManager(reserveManager.address)

                expect(await warden.reserveManager()).to.be.eq(reserveManager.address)

            });

            it(' should block non-admin caller', async () => {

                await expect(
                    warden.connect(externalUser).setReserveManager(externalUser.address)
                ).to.be.reverted

            });

        });

        describe('withdrawERC20', async () => {

            const otherERC20_address = "0x6B175474E89094C44Da98b954EedeAC495271d0F"; // DAI
            const otherERC20_holder = "0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503";
            const erc20 = IERC20__factory.connect(otherERC20_address, provider);

            const lost_amount = ethers.utils.parseEther('100');

            const fee_amount = ethers.utils.parseEther('50');


            it(' should retrieve the lost tokens and send it to the admin', async () => {

                await getERC20(admin, otherERC20_holder, erc20, externalUser.address, lost_amount);

                await erc20.connect(externalUser).transfer(warden.address, lost_amount);

                const oldBalance = await erc20.balanceOf(admin.address);

                await warden.connect(admin).withdrawERC20(erc20.address, lost_amount)

                const newBalance = await erc20.balanceOf(admin.address);

                expect(newBalance.sub(oldBalance)).to.be.eq(lost_amount)

            });

            it(' should not allow to withdraw from the reserve', async () => {

                //create a boost
                await CRV.connect(receiver).approve(warden.address, fee_amount)
                await warden.connect(delegator).register(price_per_vote, 1000, 10000);
                await warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, 10000, 1, fee_amount);

                //cancel the current Boost (from the receiver)
                const token_id = await delegationBoost.get_token_id(
                    delegator.address,
                    (await delegationBoost.total_minted(delegator.address)).sub(1)
                );
                await delegationBoost.connect(receiver).cancel_boost(token_id);

                const reserve_amount = await warden.reserveAmount();

                await expect(
                    warden.connect(admin).withdrawERC20(CRV.address, reserve_amount)
                ).to.be.revertedWith('Warden: cannot withdraw from Reserve')

            });

            it(' should block non-admin caller', async () => {

                await expect(
                    warden.connect(externalUser).withdrawERC20(erc20.address, ethers.utils.parseEther('10'))
                ).to.be.revertedWith('Ownable: caller is not the owner')

            });

        });

        describe('depositToReserve', async () => {

            const deposit_amount = ethers.utils.parseEther('100')

            it(' should allow to deposit to the reserve', async () => {

                //set Reserve Manager
                await warden.connect(admin).setReserveManager(reserveManager.address)

                await CRV.connect(receiver).transfer(reserveManager.address, deposit_amount);

                await CRV.connect(reserveManager).approve(warden.address, deposit_amount);

                const old_reserve_amount = await warden.reserveAmount();

                const oldBalance = await CRV.balanceOf(reserveManager.address);

                await warden.connect(reserveManager).depositToReserve(reserveManager.address, deposit_amount);

                const newBalance = await CRV.balanceOf(reserveManager.address);

                const new_reserve_amount = await warden.reserveAmount();

                expect(oldBalance.sub(newBalance)).to.be.eq(deposit_amount)
                expect(new_reserve_amount).to.be.eq(old_reserve_amount.add(deposit_amount))

            });

            it(' should block non-reserveManager caller', async () => {

                await expect(
                    warden.connect(externalUser).depositToReserve(reserveManager.address, deposit_amount)
                ).to.be.revertedWith('Warden: Not allowed')

                //set Reserve Manager
                await warden.connect(admin).setReserveManager(reserveManager.address)

                await expect(
                    warden.connect(externalUser).depositToReserve(reserveManager.address, deposit_amount)
                ).to.be.revertedWith('Warden: Not allowed')

            });

        });

        describe('withdrawFromReserve', async () => {

            const fee_amount = ethers.utils.parseEther('50');

            it(' should allow to withdraw from the reserve', async () => {

                //set Reserve Manager
                await warden.connect(admin).setReserveManager(reserveManager.address)

                //create a boost
                await CRV.connect(receiver).approve(warden.address, fee_amount)
                await warden.connect(delegator).register(price_per_vote, 1000, 10000);
                await warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, 10000, 1, fee_amount);

                //cancel the current Boost (from the receiver)
                const token_id = await delegationBoost.get_token_id(
                    delegator.address,
                    (await delegationBoost.total_minted(delegator.address)).sub(1)
                );
                await delegationBoost.connect(receiver).cancel_boost(token_id);

                const withdraw_amount = (await warden.reserveAmount()).div(2);

                const old_reserve_amount = await warden.reserveAmount();

                const oldBalance = await CRV.balanceOf(reserveManager.address);

                await warden.connect(reserveManager).withdrawFromReserve(withdraw_amount);

                const newBalance = await CRV.balanceOf(reserveManager.address);

                const new_reserve_amount = await warden.reserveAmount();

                expect(newBalance.sub(oldBalance)).to.be.eq(withdraw_amount)
                expect(new_reserve_amount).to.be.eq(old_reserve_amount.sub(withdraw_amount))

            });

            it(' should not allow to withdraw more then reserveAmount', async () => {

                //set Reserve Manager
                await warden.connect(admin).setReserveManager(reserveManager.address)

                await CRV.connect(receiver).approve(warden.address, fee_amount)
                await warden.connect(delegator).register(price_per_vote, 1000, 10000);
                await warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, 10000, 1, fee_amount);

                //cancel the current Boost (from the receiver)
                const token_id = await delegationBoost.get_token_id(
                    delegator.address,
                    (await delegationBoost.total_minted(delegator.address)).sub(1)
                );
                await delegationBoost.connect(receiver).cancel_boost(token_id);

                const reserve_amount = await warden.reserveAmount();

                await expect(
                    warden.connect(admin).withdrawFromReserve(reserve_amount.mul(2))
                ).to.be.revertedWith('Warden: Reserve too low')

            });

            it(' should block non-reserveManager caller', async () => {

                await expect(
                    warden.connect(externalUser).withdrawFromReserve(ethers.utils.parseEther('10'))
                ).to.be.revertedWith('Warden: Not allowed')

                //set Reserve Manager
                await warden.connect(admin).setReserveManager(reserveManager.address)

                await expect(
                    warden.connect(externalUser).withdrawFromReserve(ethers.utils.parseEther('10'))
                ).to.be.revertedWith('Warden: Not allowed')

            });

        });

    });

});