import { crypto, ByteArray, log } from "@graphprotocol/graph-ts"
import { Staked, ToppedUp, Unstaked } from "../generated/TokenStaking/TokenStaking"
import { StakeData, EpochCounter, Epoch, EpochStake } from "../generated/schema"


export function handleStaked(event: Staked): void {
  const blockTimestamp = event.block.timestamp

  let epochCounter = EpochCounter.load("Singleton")
  if (!epochCounter) {
    epochCounter = new EpochCounter("Singleton")
    epochCounter.count = 0
  }
  const lastEpochId = (epochCounter.count - 1).toString()
  let lastEpoch = Epoch.load(lastEpochId)

  let epochStakes:string[] = []

  if (lastEpoch) {
    lastEpoch.duration = blockTimestamp.minus(lastEpoch.startTime)
    lastEpoch.save()
    epochStakes = lastEpoch.stakes
    for(let i = 0; i < epochStakes.length; i++) {
      // Calculate the participation of each stake in last epoch
      let epochStake = EpochStake.load(epochStakes[i])
      epochStake!.participation = epochStake!.amount.divDecimal(lastEpoch.totalStaked.toBigDecimal())
      epochStake!.save()

      // Duplicates each epoch stake to add them to new epoch
      const epStId = crypto.keccak256(ByteArray.fromUTF8(
        epochStake!.stakeData
        + epochCounter.count.toString()
      )).toHexString()
      epochStake!.id = epStId
      epochStake!.participation = null
      epochStake!.save()
      epochStakes[i] = epochStake!.id
    }
  }

  let stakeData = new StakeData(event.params.stakingProvider.toHexString())
  let type:string
  switch(event.params.stakeType) {
    case 0:
      type = "NU"
      break
    case 1:
      type = "KEEP"
      break
    default:
      type = "T"
  }
  stakeData.stakeType = type
  stakeData.owner = event.params.owner
  stakeData.stakingProvider = event.params.stakingProvider
  stakeData.beneficiary = event.params.beneficiary
  stakeData.authorizer = event.params.authorizer
  stakeData.save()

  const epStId = crypto.keccak256(ByteArray.fromUTF8(
    stakeData.id
    + epochCounter.count.toString()
  )).toHexString()
  let newEpochStake = new EpochStake(epStId)
  newEpochStake.stakeData = stakeData.id
  newEpochStake.amount = event.params.amount
  newEpochStake.save()

  epochStakes.push(newEpochStake.id)

  let epoch = new Epoch(epochCounter.count.toString())
  epoch.startTime = blockTimestamp
  epoch.totalStaked = lastEpoch ? lastEpoch.totalStaked.plus(event.params.amount) : event.params.amount
  epoch.stakes = epochStakes
  epoch.save()

  epochCounter.count ++
  epochCounter.save()
}


export function handleToppedUp(event: ToppedUp): void {
  const blockTimestamp = event.block.timestamp

  let epochCounter = EpochCounter.load("Singleton")
  const lastEpochId = (epochCounter!.count - 1).toString()
  let lastEpoch = Epoch.load(lastEpochId)

  let stakeInPreviousEpoch = false
  let epochStakes:string[] = []

  lastEpoch!.duration = blockTimestamp.minus(lastEpoch!.startTime)
  lastEpoch!.save()
  epochStakes = lastEpoch!.stakes
  for(let i = 0; i < epochStakes.length; i++) {
    // Calculate the participation of each stake in last epoch
    let epochStake = EpochStake.load(epochStakes[i])
    epochStake!.participation = epochStake!.amount.divDecimal(lastEpoch!.totalStaked.toBigDecimal())
    epochStake!.save()

    // Duplicates each epoch stake to add them to new epoch
    const epStId = crypto.keccak256(ByteArray.fromUTF8(
      epochStake!.stakeData
      + epochCounter!.count.toString()
    )).toHexString()
    epochStake!.id = epStId
    epochStake!.participation = null


    // If this stake is the one to be topped up, increase the amount
    if (epochStake!.stakeData == event.params.stakingProvider.toHexString()) {
      stakeInPreviousEpoch = true
      epochStake!.amount = epochStake!.amount.plus(event.params.amount)
    }

    epochStake!.save()
    epochStakes[i] = epochStake!.id
  }

  // If the topped up stake is not in the previous epoch, add it
  if (!stakeInPreviousEpoch) {
    const epStId = crypto.keccak256(ByteArray.fromUTF8(
      event.params.stakingProvider.toHexString()
      + epochCounter!.count.toString()
    )).toHexString()
    let newEpochStake = new EpochStake(epStId)
    newEpochStake.stakeData = event.params.stakingProvider.toHexString()
    newEpochStake.amount = event.params.amount
    newEpochStake.save()
    epochStakes.push(newEpochStake.id)
  }

  let epoch = new Epoch(epochCounter!.count.toString())
  epoch.startTime = blockTimestamp
  epoch.totalStaked = lastEpoch!.totalStaked.plus(event.params.amount)
  epoch.stakes = epochStakes
  epoch.save()

  epochCounter!.count ++
  epochCounter!.save()
}


export function handleUnstaked(event: Unstaked): void {
  const blockTimestamp = event.block.timestamp

  let epochCounter = EpochCounter.load("Singleton")
  const lastEpochId = (epochCounter!.count - 1).toString()
  let lastEpoch = Epoch.load(lastEpochId)

  let emptyStakeArrayIndex:i32 = -1
  let epochStakes:string[] = []

  lastEpoch!.duration = blockTimestamp.minus(lastEpoch!.startTime)
  lastEpoch!.save()
  epochStakes = lastEpoch!.stakes

  for(let i = 0; i < epochStakes.length; i++) {
    // Calculate the participation of each stake in last epoch
    let epochStake = EpochStake.load(epochStakes[i])
    epochStake!.participation = epochStake!.amount.divDecimal(lastEpoch!.totalStaked.toBigDecimal())
    epochStake!.save()

    // Duplicates each epoch stake to add them to new epoch
    const epStId = crypto.keccak256(ByteArray.fromUTF8(
      epochStake!.stakeData
      + epochCounter!.count.toString()
    )).toHexString()
    epochStake!.id = epStId
    epochStake!.participation = null

    // If this stake is the one to be unstaked, decrease the amount
    if (epochStake!.stakeData == event.params.stakingProvider.toHexString()) {
      epochStake!.amount = epochStake!.amount.minus(event.params.amount)
      emptyStakeArrayIndex = epochStake!.amount.isZero() ? i : -1
    }

    epochStake!.save()
    epochStakes[i] = epochStake!.id
  }

  if (emptyStakeArrayIndex >= 0) {
    epochStakes.splice(emptyStakeArrayIndex, 1)
  }

  let epoch = new Epoch(epochCounter!.count.toString())
  epoch.startTime = blockTimestamp
  epoch.totalStaked = lastEpoch!.totalStaked.minus(event.params.amount)
  epoch.stakes = epochStakes
  epoch.save()

  epochCounter!.count ++
  epochCounter!.save()
}
