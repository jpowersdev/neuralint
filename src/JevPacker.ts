export interface Resource {
  readonly id: string
}

export interface Item<Value> {
  readonly id: string
  readonly resourceIds: ReadonlyArray<string>
  readonly question: string
  readonly value: Value
}

export interface Limits {
  readonly totalTokens: number
  readonly bindingTokens: number
}

export interface Estimate {
  readonly stateTokens: number
  readonly questionTokens: ReadonlyArray<number>
  readonly totalTokens: number
  readonly bindingTokens: number
}

export interface Pack<Value> {
  readonly resourceIds: ReadonlyArray<string>
  readonly items: ReadonlyArray<Item<Value>>
  readonly estimate: Estimate
}

export interface Options<ResourceValue extends Resource, Value> {
  readonly resources: ReadonlyMap<string, ResourceValue>
  readonly items: ReadonlyArray<Item<Value>>
  readonly renderState: (resources: ReadonlyArray<ResourceValue>) => string
  readonly limits?: Limits
}

export const defaultLimits: Limits = {
  // Jev documents 64k aggregate and 32k state-plus-longest-question limits.
  // These targets reserve room for provider wrappers not represented locally.
  totalTokens: 55_000,
  bindingTokens: 27_000
}

// Calibrated from the accepted 30, 120, 300, and 450-decision Jev runs.
const fixedRequestTokens = 1_800
// Code and provider question wrappers tokenize more densely than English prose.
const charactersPerToken = 3.5

export const estimateTextTokens = (text: string): number =>
  Math.ceil(text.length / charactersPerToken)

export const estimate = (state: string, questions: ReadonlyArray<string>): Estimate => {
  const stateTokens = fixedRequestTokens + estimateTextTokens(state)
  const questionTokens = questions.map(estimateTextTokens)
  const totalTokens = stateTokens + questionTokens.reduce((total, tokens) => total + tokens, 0)
  const bindingTokens = stateTokens + Math.max(0, ...questionTokens)
  return { stateTokens, questionTokens, totalTokens, bindingTokens }
}

export const fits = (value: Estimate, limits: Limits = defaultLimits): boolean =>
  value.totalTokens <= limits.totalTokens && value.bindingTokens <= limits.bindingTokens

interface MutablePack<Value> {
  readonly resourceIds: Set<string>
  readonly items: Array<Item<Value>>
  estimate: Estimate
}

const materializeResources = <ResourceValue extends Resource>(
  ids: ReadonlySet<string>,
  resources: ReadonlyMap<string, ResourceValue>
): ReadonlyArray<ResourceValue> => [...ids]
  .sort()
  .map((id) => resources.get(id))
  .filter((resource): resource is ResourceValue => resource !== undefined)

export const pack = <ResourceValue extends Resource, Value>(
  options: Options<ResourceValue, Value>
): ReadonlyArray<Pack<Value>> => {
  const limits = options.limits ?? defaultLimits
  const estimatePack = (resourceIds: ReadonlySet<string>, items: ReadonlyArray<Item<Value>>): Estimate =>
    estimate(
      options.renderState(materializeResources(resourceIds, options.resources)),
      items.map((item) => item.question)
    )

  const standaloneCost = (item: Item<Value>): number => {
    const ids = new Set(item.resourceIds)
    return estimatePack(ids, [item]).totalTokens
  }
  const ordered = [...options.items].sort((left, right) =>
    standaloneCost(right) - standaloneCost(left) || left.id.localeCompare(right.id)
  )
  const packs: Array<MutablePack<Value>> = []

  for (const item of ordered) {
    for (const resourceId of item.resourceIds) {
      if (!options.resources.has(resourceId)) throw new Error(`Unknown Jev pack resource ${resourceId}`)
    }
    let selected: { readonly pack: MutablePack<Value>; readonly estimate: Estimate; readonly marginal: number } | undefined
    for (const candidate of packs) {
      const resourceIds = new Set(candidate.resourceIds)
      for (const resourceId of item.resourceIds) resourceIds.add(resourceId)
      const nextItems = [...candidate.items, item]
      const nextEstimate = estimatePack(resourceIds, nextItems)
      if (!fits(nextEstimate, limits)) continue
      const marginal = nextEstimate.totalTokens - candidate.estimate.totalTokens
      if (selected === undefined || marginal < selected.marginal ||
        (marginal === selected.marginal && nextEstimate.totalTokens > selected.estimate.totalTokens)) {
        selected = { pack: candidate, estimate: nextEstimate, marginal }
      }
    }
    if (selected !== undefined) {
      for (const resourceId of item.resourceIds) selected.pack.resourceIds.add(resourceId)
      selected.pack.items.push(item)
      selected.pack.estimate = selected.estimate
      continue
    }

    const resourceIds = new Set(item.resourceIds)
    const itemEstimate = estimatePack(resourceIds, [item])
    if (!fits(itemEstimate, limits)) {
      throw new Error(
        `${item.id} cannot fit a Jev request: total ${itemEstimate.totalTokens}/${limits.totalTokens}, ` +
        `binding ${itemEstimate.bindingTokens}/${limits.bindingTokens} estimated tokens`
      )
    }
    packs.push({ resourceIds, items: [item], estimate: itemEstimate })
  }

  return packs.map((value) => ({
    resourceIds: [...value.resourceIds].sort(),
    items: [...value.items].sort((left, right) => left.id.localeCompare(right.id)),
    estimate: value.estimate
  }))
}
