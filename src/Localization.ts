import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Decision from "effect/unstable/ai/Decision"
import * as DecisionModel from "effect/unstable/ai/DecisionModel"

import type * as Domain from "./Domain.js"

export interface Input {
  readonly id: string
  readonly rule: Domain.ReviewRule
  readonly text: string
}

export interface LocalizedFinding {
  readonly id: string
  readonly startOffset: number
  readonly endOffset: number
  readonly quote: string
  readonly diagnosticId: string
  readonly diagnosticTitle: string
  readonly diagnosticDescription: string
}

export interface Result {
  readonly findings: ReadonlyArray<LocalizedFinding>
  readonly usage: {
    readonly requests: number
    readonly inputTokens: number
    readonly outputTokens: number
  }
}

interface Candidate {
  readonly startOffset: number
  readonly endOffset: number
  readonly quote: string
}

interface Prepared {
  readonly input: Input
  readonly key: string
  readonly candidates: ReadonlyArray<Candidate>
  readonly diagnostics: ReadonlyArray<Domain.RuleDiagnostic>
  readonly evidence: Decision.Classify<string> | undefined
  readonly diagnostic: Decision.Classify<string>
  readonly estimatedChars: number
}

const StateItem = Schema.Struct({
  id: Schema.String,
  ruleId: Schema.String,
  ruleTitle: Schema.String,
  ruleDescription: Schema.String,
  violationCondition: Schema.String,
  instructions: Schema.String,
  text: Schema.String
})

const State = Schema.Struct({
  stage: Schema.Literal("localization"),
  items: Schema.Array(StateItem)
})

const maxCandidates = 160
const requestBudget = 180_000
const safetyMargin = 2_000

const trimRange = (text: string, rawStart: number, rawEnd: number): Candidate | undefined => {
  let startOffset = rawStart
  let endOffset = rawEnd
  while (startOffset < endOffset && /\s/u.test(text[startOffset] ?? "")) startOffset++
  while (endOffset > startOffset && /\s/u.test(text[endOffset - 1] ?? "")) endOffset--
  if (endOffset <= startOffset) return undefined
  return { startOffset, endOffset, quote: text.slice(startOffset, endOffset) }
}

const candidatesOf = (text: string): ReadonlyArray<Candidate> => {
  const byRange = new Map<string, Candidate>()
  const structural: Array<Candidate> = []
  const sentences: Array<Candidate> = []
  const words: Array<{ readonly start: number; readonly end: number }> = []
  const add = (target: Array<Candidate>, start: number, end: number) => {
    const candidate = trimRange(text, start, end)
    if (candidate === undefined) return
    const key = `${candidate.startOffset}:${candidate.endOffset}`
    if (byRange.has(key)) return
    byRange.set(key, candidate)
    target.push(candidate)
  }

  add(structural, 0, text.length)

  const sentencePattern = /[^.!?]+(?:[.!?]+(?=\s|$)|$)/gu
  let sentence: RegExpExecArray | null
  while ((sentence = sentencePattern.exec(text)) !== null) {
    const sentenceCandidate = trimRange(text, sentence.index, sentence.index + sentence[0].length)
    if (sentenceCandidate !== undefined) {
      sentences.push(sentenceCandidate)
      add(structural, sentenceCandidate.startOffset, sentenceCandidate.endOffset)
    }
    const sentenceStart = sentence.index
    const clausePattern = /[^,;:—–]+(?:[,;:—–]+|$)/gu
    let clause: RegExpExecArray | null
    while ((clause = clausePattern.exec(sentence[0])) !== null) {
      add(structural, sentenceStart + clause.index, sentenceStart + clause.index + clause[0].length)
    }
  }

  for (let index = 0; index < sentences.length - 1; index++) {
    const first = sentences[index]
    const second = sentences[index + 1]
    if (first !== undefined && second !== undefined) add(structural, first.startOffset, second.endOffset)
  }

  const wordPattern = /[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu
  let word: RegExpExecArray | null
  while ((word = wordPattern.exec(text)) !== null) {
    words.push({ start: word.index, end: word.index + word[0].length })
  }

  const lexical: Array<Candidate> = []
  for (const token of words) add(lexical, token.start, token.end)

  const phrases: Array<Candidate> = []
  for (let length = 2; length <= 8; length++) {
    for (let start = 0; start + length <= words.length; start++) {
      const first = words[start]
      const last = words[start + length - 1]
      if (first !== undefined && last !== undefined && !/[.!?]/u.test(text.slice(first.end, last.start))) {
        add(phrases, first.start, last.end)
      }
    }
  }

  const result = [...structural, ...lexical]
  const slots = Math.max(0, maxCandidates - result.length)
  if (phrases.length <= slots) return [...result, ...phrases]
  if (slots === 0) return result.slice(0, maxCandidates)
  const selected: Array<Candidate> = []
  for (let index = 0; index < slots; index++) {
    const at = Math.min(phrases.length - 1, Math.floor(index * phrases.length / slots))
    const candidate = phrases[at]
    if (candidate !== undefined) selected.push(candidate)
  }
  return [...result, ...selected].slice(0, maxCandidates)
}

const diagnosticsOf = (rule: Domain.ReviewRule): ReadonlyArray<Domain.RuleDiagnostic> => {
  if (rule.diagnostics !== undefined && rule.diagnostics.length >= 2) return rule.diagnostics
  return [
    { id: "rule-policy", title: rule.title, description: rule.description },
    { id: "violation-condition", title: "Why this was flagged", description: rule.criteria.violation }
  ]
}

const classify = (instructions: string, descriptions: ReadonlyArray<string>, prefix: string) => {
  const criteria: Record<string, string> = Object.create(null)
  for (let index = 0; index < descriptions.length; index++) {
    criteria[`${prefix}${String(index).padStart(3, "0")}`] = descriptions[index] ?? ""
  }
  return Decision.classify({ instructions, criteria })
}

const prepare = (input: Input, index: number): Prepared => {
  const key = `L${String(index + 1).padStart(4, "0")}`
  const candidates = candidatesOf(input.text)
  const diagnostics = diagnosticsOf(input.rule)
  const evidence = candidates.length < 2 ? undefined : classify(
    `For localization item ${key}, select the shortest exact source span that contains enough words to identify the concrete ${input.rule.id} violation. Prefer a word or phrase over a clause, and a clause over a sentence, whenever the smaller span still proves the problem. Select source evidence only; do not propose new wording.`,
    candidates.map((candidate) => `Exact source span: ${JSON.stringify(candidate.quote)}`),
    "s"
  )
  const diagnostic = classify(
    `For localization item ${key}, select the most specific rule-authored diagnosis of what is wrong in this occurrence.`,
    diagnostics.map((item) => `${item.title}: ${item.description}`),
    "d"
  )
  return {
    input,
    key,
    candidates,
    diagnostics,
    evidence,
    diagnostic,
    estimatedChars: (JSON.stringify(evidence)?.length ?? 0) + JSON.stringify(diagnostic).length + input.text.length + 500
  }
}

const stateItem = (item: Prepared) => ({
  id: item.key,
  ruleId: item.input.rule.id,
  ruleTitle: item.input.rule.title,
  ruleDescription: item.input.rule.description,
  violationCondition: item.input.rule.criteria.violation,
  instructions: item.input.rule.instructions,
  text: item.input.text
})

const packsOf = (items: ReadonlyArray<Prepared>): ReadonlyArray<ReadonlyArray<Prepared>> => {
  const packs: Array<ReadonlyArray<Prepared>> = []
  let current: Array<Prepared> = []
  let chars = safetyMargin
  for (const item of items) {
    if (current.length > 0 && chars + item.estimatedChars > requestBudget) {
      packs.push(current)
      current = []
      chars = safetyMargin
    }
    current.push(item)
    chars += item.estimatedChars
  }
  if (current.length > 0) packs.push(current)
  return packs
}

const selectedLabel = (answer: unknown): string | undefined => {
  if (typeof answer !== "object" || answer === null || !("label" in answer)) return undefined
  return typeof answer.label === "string" ? answer.label : undefined
}

const evaluatePack = Effect.fn("Localization.evaluatePack")(function* (pack: ReadonlyArray<Prepared>) {
  const decisions: Record<string, Decision.Any> = Object.create(null)
  for (const item of pack) {
    if (item.evidence !== undefined) decisions[`${item.key}:evidence`] = item.evidence
    decisions[`${item.key}:diagnostic`] = item.diagnostic
  }
  const definition = Decision.make({ input: State, decisions })
  const response = yield* DecisionModel.decide(definition, {
    input: { stage: "localization", items: pack.map(stateItem) }
  }).pipe(
    Effect.mapError((cause) => new Error(`Unable to localize prose findings: ${cause.message}`))
  )

  const findings: Array<LocalizedFinding> = []
  for (const item of pack) {
    const evidenceLabel = item.evidence === undefined
      ? "s000"
      : selectedLabel(response.answers[`${item.key}:evidence`]) ?? "s000"
    const diagnosticLabel = selectedLabel(response.answers[`${item.key}:diagnostic`]) ?? "d000"
    const evidenceIndex = Number(evidenceLabel.slice(1))
    const diagnosticIndex = Number(diagnosticLabel.slice(1))
    const candidate = item.candidates[evidenceIndex] ?? item.candidates[0]
    const diagnostic = item.diagnostics[diagnosticIndex] ?? item.diagnostics[0]
    if (candidate === undefined || diagnostic === undefined) continue
    if (item.input.text.slice(candidate.startOffset, candidate.endOffset) !== candidate.quote) continue
    findings.push({
      id: item.input.id,
      startOffset: candidate.startOffset,
      endOffset: candidate.endOffset,
      quote: candidate.quote,
      diagnosticId: diagnostic.id,
      diagnosticTitle: diagnostic.title,
      diagnosticDescription: diagnostic.description
    })
  }
  return {
    findings,
    usage: {
      requests: 1,
      inputTokens: response.usage.inputTokens ?? 0,
      outputTokens: response.usage.outputTokens ?? 0
    }
  }
})

export const run = Effect.fn("Localization.run")(function* (inputs: ReadonlyArray<Input>) {
  if (inputs.length === 0) return { findings: [], usage: { requests: 0, inputTokens: 0, outputTokens: 0 } } satisfies Result
  const prepared = inputs.map(prepare)
  const evaluated = yield* Effect.forEach(packsOf(prepared), evaluatePack, { concurrency: 2 })
  const findings: Array<LocalizedFinding> = []
  let requests = 0
  let inputTokens = 0
  let outputTokens = 0
  for (const result of evaluated) {
    findings.push(...result.findings)
    requests += result.usage.requests
    inputTokens += result.usage.inputTokens
    outputTokens += result.usage.outputTokens
  }
  return { findings, usage: { requests, inputTokens, outputTokens } } satisfies Result
})
