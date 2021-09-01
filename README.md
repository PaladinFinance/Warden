# Warden

## Overview

Warden will be a market for Delegation Boost of votingEscrow (ex : veCRV) type tokens

Delegators need to approve the Warden contract as an operator in the DelegationBoost contract, then they can 
register in Warden, setting a price, a minimum %, and a maximum %, for their votingEscrow tokens.  
Buyer can then pay to get a DelegationBoost from the delegator, for a given amount and a given duration depending on the amount of fees willing to be paid.  
All fees paid to buy DelegationBoosts are paid in the votingEscrow underlying token (ex: for veCRV, fees paid in CRV)  
Delegator can claim fees they earned through the purchases of DelegationBoosts they originated.


Currently it only works with Delegation Boost made for CRV rewards on Curve.  
The goal is to have a system that could later work on top of total votes delegation of veCRV (for Gauges votes & DAO votes).

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
* [WardenUtils](https://github.com/PaladinFinance/Warden/tree/main/contracts/WardenUtils.sol) : Contract to fetch & filter data from the Warden contract


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
