# Warden

## Overview

Warden will be a market for Delegation Boost of votingEscrow (ex : veCRV) type tokens

Delegators need to approve the Warden contract as an operator in the DelegationBoost contract, then they can 
register in Warden, setting a price, a minimum %, and a maximum %, for their votingEscrow tokens.  
Buyer can then pay to get a DelegationBoost from the delegator, for a given amount and a given duration depending on the amount of fees willing to be paid (duration are currently counted by weeks).  
All fees paid to buy DelegationBoosts are paid in the votingEscrow underlying token (ex: for veCRV, fees paid in CRV)  
Delegator can claim fees they earned through the purchases of DelegationBoosts they originated.


Currently it only works with Delegation Boost made for CRV rewards on Curve Gauges.

Because the veBoost contract rounds down to the week the expire_time given to create a Boost, users buying a Boost through Warden could get less days of Boost than what they paid for. So it does not happen, when creating a Boost, the Warden contract will add 1 more week, if needed, to the expire_time parameter to create the Boost, creating some "bonus days" where the Boost will be active, but for which the buyer did not pay.  
But the cancel_time of the created Boost will relfect the real duration paid for. After the paid duration of the Boost passed, any user can try to buy a Boost from the same delegator, the previous Boost could be canceled by Warden (if the Boost is cancelable) to make more veCRV available for the Boost.


## Deployements

Warden: 0x2e2f6aece0B7Caa7D3BfDFb2728F50b4e211F1eB  
Warden BuyWrapper: 0x0ea62B817EB48ccEcD7df44164aCceE114650Ed4  
WardenLens: 0xe0be968a0D6Bba03720DfDB2F3d4b3ED0083b4c7  
WardenMultiBuy: 0x40C1c7Bd620ae59215913F819c45AF75F1b7aFcE    

## Dependencies & Installation


To start, make sure you have `node` & `npm` installed : 
* `node` - tested with v16.4.0
* `npm` - tested with v7.18.1

Then, clone this repo, and install the dependencies : 

```
git clone https://github.com/PaladinFinance/Warden.git
cd Warden
npm install
```

This will install `Hardhat`, `Ethers v5`, and all the hardhat plugins used in this project.


## Contracts


* [Warden](https://github.com/PaladinFinance/Warden/tree/main/contracts/Warden.sol) : Main contract
* [WardenLens](https://github.com/PaladinFinance/Warden/tree/main/contracts/WardenLens.sol) : Contract to fetch & filter data from the Warden contract
* [WardenMultiBuy](https://github.com/PaladinFinance/Warden/blob/main/contracts/WardenMultiBuy.sol) : Contract to batch multiple Boost purchase in 1 transaction
* [WardenBuyWrapper](https://github.com/PaladinFinance/Warden/blob/v1-update/contracts/WardenBuyWrapper.sol) : Contract wrapping the buyDelegationBoost to clear expired Boost from delegator before purchase

## Tests


Unit tests can be found in the `./test` directory.

To run the tests : 
```
npm run test
```


## Deploy


Deploy to Kovan :
```
npm run build
npm run deploy_kovan
```
