const hre = require("hardhat");

export async function getTimestamp(
    day: number,
    month: number,
    year: number,
    hours: number = 0,
    minutes: number = 0
) {
    let date = new Date(year, month, day, hours, minutes, 0)
    return Math.floor(date.getTime() / 1000)
}

export async function setBlockTimestamp(
    timestamp: string,
) {
    await hre.network.provider.send("evm_setNextBlockTimestamp", [timestamp])
    await hre.network.provider.send("evm_mine")
}


export async function advanceTime(
    seconds: number
) {
    await hre.network.provider.send("evm_increaseTime", [seconds])
    await hre.network.provider.send("evm_mine")
}