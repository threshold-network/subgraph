import {
  crypto,
  ByteArray,
  BigInt,
  log,
  Address,
} from "@graphprotocol/graph-ts"
import {
  Staked,
  ToppedUp,
  Unstaked,
  DelegateChanged,
  TokenStaking,
  DelegateVotesChanged,
  MinimumStakeAmountSet,
} from "../generated/TokenStaking/TokenStaking"
import {
  StakeData,
  Epoch,
  EpochStake,
  Account,
  MinStakeAmount,
} from "../generated/schema"
import {
  getDaoMetric,
  getEpochCount,
  getEpochStakeId,
  populateNewEpochStakes,
  getOrCreateLastEpoch,
  increaseEpochCount,
  getOrCreateStakeDelegation,
  getOrCreateTokenholderDelegation,
} from "./utils"

export function handleStaked(event: Staked): void {
  const stakingProvider = event.params.stakingProvider
  const amount = event.params.amount

  const stakeData = new StakeData(stakingProvider.toHexString())
  let type: string
  switch (event.params.stakeType) {
    case 0:
      type = "NU"
      break
    case 1:
      type = "KEEP"
      break
    default:
      type = "T"
  }
  const owner = event.params.owner
  let account = Account.load(owner.toHexString())
  if (!account) {
    account = new Account(owner.toHexString())
    account.save()
  }

  stakeData.owner = account.id
  stakeData.beneficiary = event.params.beneficiary
  stakeData.authorizer = event.params.authorizer
  stakeData.tStake = type === "T" ? amount : BigInt.zero()
  stakeData.keepInTStake = type === "KEEP" ? amount : BigInt.zero()
  stakeData.nuInTStake = type === "NU" ? amount : BigInt.zero()
  stakeData.totalStaked = stakeData.tStake
    .plus(stakeData.keepInTStake)
    .plus(stakeData.nuInTStake)
  stakeData.save()

  const lastEpoch = getOrCreateLastEpoch()
  const timestamp = event.block.timestamp
  lastEpoch.duration = timestamp.minus(lastEpoch.timestamp)
  lastEpoch.save()

  const epochStakes = populateNewEpochStakes(lastEpoch.stakes)
  const epochStakeId = getEpochStakeId(stakingProvider)
  const epochStake = new EpochStake(epochStakeId)
  epochStake.stakingProvider = stakingProvider
  epochStake.owner = owner
  epochStake.amount = amount
  epochStake.save()
  epochStakes.push(epochStake.id)

  const epoch = new Epoch(getEpochCount().toString())
  epoch.timestamp = timestamp
  epoch.totalAmount = lastEpoch.totalAmount.plus(amount)
  epoch.stakes = epochStakes
  epoch.save()

  increaseEpochCount()
}

export function handleToppedUp(event: ToppedUp): void {
  const stakingProvider = event.params.stakingProvider
  const amount = event.params.amount

  const topUpFunctionId = ByteArray.fromHexString(
    event.transaction.input.toHexString().substring(0, 10)
  )

  const topUpTFunctionId = ByteArray.fromHexString(
    crypto
      .keccak256(ByteArray.fromUTF8("topUp(address,uint96)"))
      .toHexString()
      .substring(0, 10)
  )
  const topUpKeepFunctionId = ByteArray.fromHexString(
    crypto
      .keccak256(ByteArray.fromUTF8("topUpKeep(address)"))
      .toHexString()
      .substring(0, 10)
  )
  const topUpNuFunctionId = ByteArray.fromHexString(
    crypto
      .keccak256(ByteArray.fromUTF8("topUpNu(address)"))
      .toHexString()
      .substring(0, 10)
  )

  const stakeData = StakeData.load(stakingProvider.toHexString()) as StakeData
  stakeData.totalStaked = stakeData.totalStaked.plus(amount)

  if (topUpFunctionId.equals(topUpTFunctionId)) {
    stakeData.tStake = stakeData.tStake.plus(amount)
  } else if (topUpFunctionId.equals(topUpKeepFunctionId)) {
    stakeData.keepInTStake = stakeData.keepInTStake.plus(amount)
  } else if (topUpFunctionId.equals(topUpNuFunctionId)) {
    stakeData.nuInTStake = stakeData.nuInTStake.plus(amount)
  } else {
    log.info(
      "Could not match the top up function identifier with event input data. Fetching the current stake balance for {} staking provider from chain.",
      [stakingProvider.toHexString()]
    )
    const stakes = TokenStaking.bind(event.address).stakes(stakingProvider)
    stakeData.tStake = stakes.value0
    stakeData.keepInTStake = stakes.value1
    stakeData.nuInTStake = stakes.value2
  }
  stakeData.save()

  const lastEpoch = getOrCreateLastEpoch()
  const timestamp = event.block.timestamp
  lastEpoch.duration = timestamp.minus(lastEpoch.timestamp)
  lastEpoch.save()

  const epochStakes = populateNewEpochStakes(lastEpoch.stakes)
  const epochStakeId = getEpochStakeId(stakingProvider)
  let epochStake = EpochStake.load(epochStakeId)
  if (!epochStake) {
    epochStake = new EpochStake(epochStakeId)
    epochStake.stakingProvider = stakingProvider
    epochStake.owner = Address.fromHexString(stakeData.owner)
    epochStake.amount = BigInt.zero()
    epochStakes.push(epochStake.id)
  }
  epochStake.amount = epochStake.amount.plus(amount)
  epochStake.save()

  const epoch = new Epoch(getEpochCount().toString())
  epoch.timestamp = timestamp
  epoch.totalAmount = lastEpoch.totalAmount.plus(amount)
  epoch.stakes = epochStakes
  epoch.save()

  increaseEpochCount()
}

export function handleUnstaked(event: Unstaked): void {
  const stakingProvider = event.params.stakingProvider
  const amount = event.params.amount

  const unstakeFunctionId = ByteArray.fromHexString(
    event.transaction.input.toHexString().substring(0, 10)
  )

  const unstakeTFunctionId = ByteArray.fromHexString(
    crypto
      .keccak256(ByteArray.fromUTF8("unstakeT(address,uint96)"))
      .toHexString()
      .substring(0, 10)
  )
  const unstakeKeepFunctionId = ByteArray.fromHexString(
    crypto
      .keccak256(ByteArray.fromUTF8("unstakeKeep(address)"))
      .toHexString()
      .substring(0, 10)
  )
  const unstakeNuFunctionId = ByteArray.fromHexString(
    crypto
      .keccak256(ByteArray.fromUTF8("unstakeNu(address,uint96)"))
      .toHexString()
      .substring(0, 10)
  )
  const unstakeAllFunctionId = ByteArray.fromHexString(
    crypto
      .keccak256(ByteArray.fromUTF8("unstakeAll(address)"))
      .toHexString()
      .substring(0, 10)
  )

  const stakeData = StakeData.load(stakingProvider.toHexString()) as StakeData
  stakeData.totalStaked = stakeData.totalStaked.minus(amount)

  if (unstakeFunctionId.equals(unstakeTFunctionId)) {
    stakeData.tStake = stakeData.tStake.minus(amount)
  } else if (unstakeFunctionId.equals(unstakeKeepFunctionId)) {
    stakeData.keepInTStake = stakeData.keepInTStake.minus(amount)
  } else if (unstakeFunctionId.equals(unstakeNuFunctionId)) {
    stakeData.nuInTStake = stakeData.nuInTStake.minus(amount)
  } else if (unstakeFunctionId.equals(unstakeAllFunctionId)) {
    stakeData.tStake = BigInt.zero()
    stakeData.keepInTStake = BigInt.zero()
    stakeData.nuInTStake = BigInt.zero()
  } else {
    log.info(
      "Could not match the unstake function identifier with event input data. Fetching the current stake balance for {} staking provider from chain.",
      [stakingProvider.toHexString()]
    )
    const stakes = TokenStaking.bind(event.address).stakes(stakingProvider)
    stakeData.tStake = stakes.value0
    stakeData.keepInTStake = stakes.value1
    stakeData.nuInTStake = stakes.value2
  }
  stakeData.save()

  const lastEpoch = getOrCreateLastEpoch()
  const timestamp = event.block.timestamp
  lastEpoch.duration = timestamp.minus(lastEpoch.timestamp)
  lastEpoch.save()

  const epochStakes = populateNewEpochStakes(lastEpoch.stakes)
  const epochStakeId = getEpochStakeId(stakingProvider)
  const epochStake = EpochStake.load(epochStakeId)
  if (epochStake) {
    epochStake.amount = epochStake.amount.minus(amount)
    epochStake.save()
    if (epochStake.amount.isZero()) {
      epochStakes.splice(epochStakes.indexOf(epochStakeId), 1)
    }
  }

  const epoch = new Epoch(getEpochCount().toString())
  epoch.timestamp = timestamp
  epoch.totalAmount = lastEpoch.totalAmount.minus(amount)
  epoch.stakes = epochStakes
  epoch.save()

  increaseEpochCount()
}

export function handleDelegateChanged(event: DelegateChanged): void {
  const delegatee = event.params.toDelegate
  const stakeDelegation = getOrCreateStakeDelegation(delegatee)
  // It's not possible to delegate voting power if a stake doesn't exist so we
  // can force the type. The `delegator` is always a staking provider in the
  // `TTokenStaking` contract.
  const stake = StakeData.load(
    event.params.delegator.toHexString()
  ) as StakeData
  stake.delegatee = stakeDelegation.id
  stake.save()
  stakeDelegation.save()
}

export function handleDelegateVotesChanged(event: DelegateVotesChanged): void {
  const delegatee = event.params.delegate
  const stakeDelegation = getOrCreateStakeDelegation(delegatee)

  stakeDelegation.totalWeight = event.params.newBalance
  stakeDelegation.save()

  const tokenholderDelegation = getOrCreateTokenholderDelegation(delegatee)
  tokenholderDelegation.totalWeight = tokenholderDelegation.liquidWeight.plus(
    stakeDelegation.totalWeight
  )
  tokenholderDelegation.save()

  const daoMetric = getDaoMetric()
  const difference = event.params.newBalance.minus(event.params.previousBalance)
  daoMetric.stakedTotal = daoMetric.stakedTotal.plus(difference)
  daoMetric.save()
}

export function handleMinStakeAmountChanged(
  event: MinimumStakeAmountSet
): void {
  const id = `min-stake-${event.transaction.hash.toHexString()}`

  let minStake = MinStakeAmount.load(id)
  if (!minStake) {
    minStake = new MinStakeAmount(id)
  }

  minStake.amount = event.params.amount
  minStake.blockNumber = event.block.number
  minStake.updatedAt = event.block.timestamp
  minStake.save()
}
