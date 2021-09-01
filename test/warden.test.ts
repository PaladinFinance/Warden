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
    let delegator: SignerWithAddress
    let receiver: SignerWithAddress
    let externalUser: SignerWithAddress

    let warden: Warden

    let CRV: IERC20
    let veCRV: IVotingEscrow
    let delegationBoost: IVotingEscrowDelegation

    const price_per_vote = BigNumber.from(8.25 * 1e10) // ~ 50CRV for a 1000 veCRV boost for a week

    before(async () => {
        [admin, delegator, receiver, externalUser] = await ethers.getSigners();

        wardenFactory = await ethers.getContractFactory("Warden");

        const crv_amount = ethers.utils.parseEther('1500');
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
        const warden_feeRatio = await warden.feeRatio();
        const warden_minPercRequired = await warden.minPercRequired();
        const warden_reserveAmount = await warden.reserveAmount();

        expect(warden_feeToken).to.be.eq(CRV.address);
        expect(warden_votingEscrow).to.be.eq(veCRV.address);
        expect(warden_delegationBoost).to.be.eq(delegationBoost.address);
        expect(warden_feeRatio).to.be.eq(500);
        expect(warden_minPercRequired).to.be.eq(1000);
        expect(warden_reserveAmount).to.be.eq(0);

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

            //////// !!!!!!!!!!! To do !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
            //////// !!!!!!!!!!! To do !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
            //////// !!!!!!!!!!! To do !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
            //////// !!!!!!!!!!! To do !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
            //////// !!!!!!!!!!! To do !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
            //////// !!!!!!!!!!! To do !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

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
        const wanted_duration = 7 //days

        const incorrect_min_perc = 1500
        const incorrect_max_perc = 8000
        const under_required_min_perc = 500
        const overflow_max_perc = 10100
        const incorrect_duration = 4 //days

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

        it(' should fail if parameters do not make delegator Offer', async () => {

            const update_tx = await warden.connect(delegator).updateOffer(price_per_vote, min_perc, 7500)

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

        beforeEach(async () => {

            await warden.connect(delegator).register(price_per_vote, min_perc, max_perc);

        });

        it(' ', async () => {

        });

    });


    describe('cancelDelegationBoost', async () => {

        const min_perc = 2000
        const max_perc = 10000

        beforeEach(async () => {

            await warden.connect(delegator).register(price_per_vote, min_perc, max_perc);

        });

        it(' ', async () => {

        });

    });


    describe('claim', async () => {

        const min_perc = 2000
        const max_perc = 10000

        beforeEach(async () => {

            await warden.connect(delegator).register(price_per_vote, min_perc, max_perc);

        });

        it(' ', async () => {

        });

    });


    describe('claimAndCancel', async () => {

        const min_perc = 2000
        const max_perc = 10000

        beforeEach(async () => {

            await warden.connect(delegator).register(price_per_vote, min_perc, max_perc);

        });

        it(' ', async () => {

        });

    });


    describe('Admin functions', async () => {

        describe('pause', async () => {

            it(' should allow admin to pause the contract', async () => {

                await warden.connect(admin).pause();

                await expect(
                    warden.connect(receiver)["claim()"]()
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
                    warden.connect(receiver)["claim()"]()
                ).not.to.be.reverted

            });

            it(' should block non-admin caller', async () => {

                await expect(
                    warden.connect(externalUser).unpause()
                ).to.be.reverted

            });

        });

        describe('setMinPercRequired', async () => {

            it(' should allow admin to update the parameter', async () => {

                await warden.connect(admin).setFeeRatio(3000)

                expect(await warden.feeRatio()).to.be.eq(3000)

            });

            it(' should fail if parameter is invalid', async () => {

                await expect(
                    warden.connect(admin).setFeeRatio(10000)
                ).to.be.reverted

            });

            it(' should block non-admin caller', async () => {

                await expect(
                    warden.connect(externalUser).setFeeRatio(3000)
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

        describe('setFeeRatio', async () => {

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

        describe('withdrawERC20', async () => {

            const otherERC20_address = "0x6B175474E89094C44Da98b954EedeAC495271d0F"; // DAI
            const otherERC20_holder = "0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503";
            const erc20 = CRV = IERC20__factory.connect(otherERC20_address, provider);

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

            it(' should allow to withdraw from reserve', async () => {

                await CRV.connect(receiver).approve(warden.address, fee_amount)
                await warden.connect(delegator).register(price_per_vote, 1000, 10000);
                await warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, 10000, 7, fee_amount);

                const reserve_amount = await warden.reserveAmount();

                const oldBalance = await CRV.balanceOf(admin.address);

                await warden.connect(admin).withdrawERC20(CRV.address, reserve_amount);

                const newBalance = await CRV.balanceOf(admin.address);

                const new_reserve_amount = await warden.reserveAmount();

                expect(newBalance.sub(oldBalance)).to.be.eq(reserve_amount)
                expect(new_reserve_amount).to.be.eq(0)

            });

            it(' should not allow to withdraw more then reserveAmount', async () => {

                await CRV.connect(receiver).approve(warden.address, fee_amount)
                await warden.connect(delegator).register(price_per_vote, 1000, 10000);
                await warden.connect(receiver).buyDelegationBoost(delegator.address, receiver.address, 10000, 7, fee_amount);

                const reserve_amount = await warden.reserveAmount();

                await expect(
                    warden.connect(admin).withdrawERC20(CRV.address, reserve_amount.mul(2))
                ).to.be.revertedWith('Warden: Reserve too low')

            });

            it(' should block non-admin caller', async () => {

                await expect(
                    warden.connect(externalUser).withdrawERC20(CRV.address, ethers.utils.parseEther('10'))
                ).to.be.revertedWith('Ownable: caller is not the owner')

            });

        });

    });

});