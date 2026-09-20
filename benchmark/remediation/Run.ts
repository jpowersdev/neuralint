import { spawn } from "node:child_process"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const directory = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(directory, "../..")
const homeAssistant = path.join(root, "benchmark/home-assistant")
const cache = path.join(root, "benchmark/.cache/home-assistant--core")
const fixturePath = path.join(root, "benchmark/quality/fixtures/home-assistant-54.json")
const casePath = path.join(directory, "cases.json")
const outputPath = path.join(directory, "results/pilot.json")
const model = "openai-codex/gpt-5.6-terra"
const thinking = "low"

interface CommandResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

interface Usage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly costUsd?: number
  readonly requests: number
}

interface Review {
  readonly ruleId: string
  readonly path: string
  readonly summary: string
  readonly impact: string
  readonly evidence: ReadonlyArray<string>
  readonly remediation: string
  readonly validation: ReadonlyArray<string>
}

interface ReviewOutput {
  readonly reviews: ReadonlyArray<Review>
  readonly summary: string
}

interface Evaluation {
  readonly output: ReviewOutput
  readonly latencyMs: number
  readonly usage: Usage
  readonly filesRead: ReadonlyArray<string>
}

interface GoldCase {
  readonly id: string
  readonly diagnosis: string
  readonly requiredFacts: ReadonlyArray<string>
  readonly acceptableRemediation: ReadonlyArray<string>
  readonly invalidRemediation: ReadonlyArray<string>
  readonly unsafeRemediation: ReadonlyArray<string>
}

interface SourceCase {
  readonly id: string
  readonly title: string
  readonly patch: string
  readonly groundTruth: {
    readonly ruleId: string
    readonly path: string
  }
  readonly policy: {
    readonly id: string
    readonly title: string
    readonly description: string
    readonly instructions: string
    readonly violationCondition: string
    readonly complianceCondition: string
    readonly source: string
    readonly sourceCommit: string
  }
  readonly evidence: {
    readonly hunkId: string
    readonly diff: string
  }
}

const run = (executable: string, args: ReadonlyArray<string>, cwd: string): Promise<CommandResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk })
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk })
    child.on("error", reject)
    child.on("close", (code) => resolve({ stdout, stderr, exitCode: code ?? 1 }))
  })

const successful = async (executable: string, args: ReadonlyArray<string>, cwd: string): Promise<CommandResult> => {
  const result = await run(executable, args, cwd)
  if (result.exitCode !== 0) {
    throw new Error(`${executable} exited ${result.exitCode}: ${result.stderr.trim()}`)
  }
  return result
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined

const parseReview = (value: unknown): ReviewOutput => {
  const record = asRecord(value)
  if (record === undefined || !Array.isArray(record["reviews"]) || typeof record["summary"] !== "string") {
    throw new Error("review output did not match { reviews, summary }")
  }
  const reviews = record["reviews"].map((item, index): Review => {
    const review = asRecord(item)
    if (
      review === undefined ||
      typeof review["ruleId"] !== "string" ||
      typeof review["path"] !== "string" ||
      typeof review["summary"] !== "string" ||
      typeof review["impact"] !== "string" ||
      !Array.isArray(review["evidence"]) ||
      !review["evidence"].every((entry) => typeof entry === "string") ||
      typeof review["remediation"] !== "string" ||
      !Array.isArray(review["validation"]) ||
      !review["validation"].every((entry) => typeof entry === "string")
    ) {
      throw new Error(`review ${index} did not match the required schema`)
    }
    return {
      ruleId: review["ruleId"],
      path: review["path"],
      summary: review["summary"],
      impact: review["impact"],
      evidence: review["evidence"] as ReadonlyArray<string>,
      remediation: review["remediation"],
      validation: review["validation"] as ReadonlyArray<string>
    }
  })
  return { reviews, summary: record["summary"] }
}

const parsePiOutput = (stdout: string): { readonly output: ReviewOutput; readonly usage: Usage } => {
  let finalMessage: Record<string, unknown> | undefined
  const filesRead = new Set<string>()
  for (const line of stdout.trim().split("\n")) {
    if (line.trim() === "") continue
    const event = asRecord(JSON.parse(line))
    const type = event?.["type"]
    if (type === "tool_execution_start" || type === "tool_execution_end") {
      const args = asRecord(event?.["args"])
      const file = args?.["path"] ?? args?.["file_path"]
      if (typeof file === "string") filesRead.add(file)
    }
    if (type !== "message_end") continue
    const message = asRecord(event?.["message"])
    if (message?.["role"] === "assistant") finalMessage = message
  }
  if (finalMessage === undefined) throw new Error("pi emitted no final assistant message")
  const content = finalMessage["content"]
  if (!Array.isArray(content)) throw new Error("pi assistant content was not an array")
  const text = content
    .map(asRecord)
    .filter((part): part is Record<string, unknown> => part?.["type"] === "text")
    .map((part) => part["text"])
    .filter((part): part is string => typeof part === "string")
    .join("")
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start < 0 || end < start) throw new Error(`pi did not return JSON: ${text}`)
  const output = parseReview(JSON.parse(text.slice(start, end + 1)) as unknown)
  const usage = asRecord(finalMessage["usage"])
  const cost = asRecord(usage?.["cost"])
  return {
    output,
    usage: {
      inputTokens: typeof usage?.["input"] === "number" ? usage["input"] : 0,
      outputTokens: typeof usage?.["output"] === "number" ? usage["output"] : 0,
      requests: 1,
      ...(typeof cost?.["total"] === "number" ? { costUsd: cost["total"] } : {})
    }
  }
}

const evaluate = async (checkout: string, prompt: string): Promise<Evaluation> => {
  const started = performance.now()
  const result = await successful("pi", [
    "--mode", "json",
    "--print",
    "--no-session",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
    "--approve",
    "--tools", "read,bash",
    "--model", model,
    "--thinking", thinking,
    prompt
  ], checkout)
  const parsed = parsePiOutput(result.stdout)
  const files = new Set<string>()
  for (const line of result.stdout.trim().split("\n")) {
    if (line.trim() === "") continue
    const event = asRecord(JSON.parse(line))
    const args = asRecord(event?.["args"])
    const file = args?.["path"] ?? args?.["file_path"]
    if (typeof file === "string") files.add(file)
  }
  return {
    output: parsed.output,
    latencyMs: Math.round(performance.now() - started),
    usage: parsed.usage,
    filesRead: [...files].sort()
  }
}

const outputContract = `Return only a JSON object of this exact shape:
{"reviews":[{"ruleId":string,"path":string,"summary":string,"impact":string,"evidence":string[],"remediation":string,"validation":string[]}],"summary":string}

Use repository-relative paths. Do not wrap the JSON in Markdown.`

const directPrompt = (base: string): string => `Review the repository's synthetic pull request as a read-only policy reviewer.

1. Read every YAML policy under .neuralint/rules/.
2. Inspect the diff from ${base} to HEAD and any repository context needed to decide those policies.
3. Report only violations introduced or worsened by the diff.
4. For each violation, quote the decisive changed lines, explain the concrete impact, repository-specific remediation, and useful validation or tests.
5. Do not modify files, install dependencies, or access the network.

${outputContract}

If there are no violations, return {"reviews":[],"summary":"No policy violations found."}.`

const goldPrompt = (base: string, source: SourceCase, gold: GoldCase): string => {
  const packet = {
    status: "confirmed",
    rule: source.policy,
    location: {
      path: source.groundTruth.path,
      hunkId: source.evidence.hunkId,
      diff: source.evidence.diff
    },
    diagnosis: gold.diagnosis,
    supportingFacts: gold.requiredFacts
  }
  return `Write the human-facing remediation for a confirmed policy violation in the repository's synthetic pull request.

The finding has already been discovered and confirmed. Do not perform broad policy discovery. Inspect the diff from ${base} to HEAD and targeted repository context only as needed to make the remediation concrete and safe. Do not modify files, install dependencies, or access the network.

Explain:
- what engineering or user impact the confirmed violation has;
- the decisive changed lines as evidence;
- the repository-specific corrective direction;
- validation or tests that should accompany the correction.

Do not assume that the previous implementation is always the only valid correction. Do not mention this benchmark or the existence of a gold packet.

Confirmed packet:
${JSON.stringify(packet, null, 2)}

${outputContract}

Return exactly one review using the packet's exact rule ID and path.`
}

const ensureRepository = async (): Promise<void> => {
  await fs.mkdir(path.dirname(cache), { recursive: true })
  try {
    await fs.access(path.join(cache, ".git"))
  } catch {
    await successful("git", ["clone", "--filter=blob:none", "https://github.com/home-assistant/core.git", cache], root)
  }
  const hasCommit = await run("git", ["cat-file", "-e", "40fcd7dc6b37781291745e3d6c39601563e87349^{commit}"], cache)
  if (hasCommit.exitCode !== 0) {
    await successful("git", ["fetch", "origin", "40fcd7dc6b37781291745e3d6c39601563e87349"], cache)
  }
}

const prepareCheckout = async (source: SourceCase): Promise<{ readonly checkout: string; readonly base: string }> => {
  const checkout = await fs.mkdtemp(path.join(os.tmpdir(), `neuralint-remediation-${source.id}-`))
  await successful("git", ["clone", "--shared", "--quiet", cache, checkout], root)
  await successful("git", ["checkout", "--quiet", "--detach", "40fcd7dc6b37781291745e3d6c39601563e87349"], checkout)
  const base = (await successful("git", ["rev-parse", "HEAD"], checkout)).stdout.trim()
  await fs.mkdir(path.join(checkout, ".neuralint"), { recursive: true })
  await fs.cp(path.join(homeAssistant, "rules"), path.join(checkout, ".neuralint/rules"), { recursive: true })
  await successful("git", ["apply", path.join(root, source.patch)], checkout)
  await successful("git", ["add", "--update"], checkout)
  await successful("git", [
    "-c", "user.name=neuralint Benchmark",
    "-c", "user.email=benchmark@neuralint.local",
    "commit", "--quiet", "-m", source.title
  ], checkout)
  return { checkout, base }
}

const writeResult = async (payload: unknown): Promise<void> => {
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, JSON.stringify(payload, null, 2) + "\n")
}

const main = async (): Promise<void> => {
  const [fixture, casesDocument] = await Promise.all([
    fs.readFile(fixturePath, "utf8").then((text) => JSON.parse(text) as { readonly cases: ReadonlyArray<SourceCase> }),
    fs.readFile(casePath, "utf8").then((text) => JSON.parse(text) as { readonly cases: ReadonlyArray<GoldCase> })
  ])
  const sourceById = new Map(fixture.cases.map((item) => [item.id, item]))
  await ensureRepository()

  let existing: { readonly startedAt?: string; readonly results?: ReadonlyArray<unknown> } | undefined
  if (process.argv.includes("--resume")) {
    try {
      existing = JSON.parse(await fs.readFile(outputPath, "utf8")) as typeof existing
    } catch {
      existing = undefined
    }
  }
  const results: Array<unknown> = [...(existing?.results ?? [])]
  const completedIds = new Set(results.map((item) => asRecord(item)?.["id"]).filter((id): id is string => typeof id === "string"))
  const startedAt = existing?.startedAt ?? new Date().toISOString()
  const payload = {
    schemaVersion: 1,
    startedAt,
    completedAt: undefined as string | undefined,
    model,
    thinking,
    repository: {
      name: "home-assistant/core",
      commit: "40fcd7dc6b37781291745e3d6c39601563e87349"
    },
    results
  }

  for (const [index, gold] of casesDocument.cases.entries()) {
    if (completedIds.has(gold.id)) continue
    const source = sourceById.get(gold.id)
    if (source === undefined) throw new Error(`Missing source fixture ${gold.id}`)
    const { checkout, base } = await prepareCheckout(source)
    try {
      const order = index % 2 === 0 ? ["gold", "direct"] as const : ["direct", "gold"] as const
      const evaluations: Partial<Record<"direct" | "gold", Evaluation>> = {}
      for (const arm of order) {
        console.error(`${gold.id}: ${arm}`)
        evaluations[arm] = await evaluate(
          checkout,
          arm === "direct" ? directPrompt(base) : goldPrompt(base, source, gold)
        )
      }
      results.push({
        id: gold.id,
        title: source.title,
        expected: source.groundTruth,
        order,
        goldPacket: {
          diagnosis: gold.diagnosis,
          supportingFacts: gold.requiredFacts
        },
        direct: evaluations.direct,
        goldHandoff: evaluations.gold
      })
      await writeResult(payload)
    } finally {
      await fs.rm(checkout, { recursive: true, force: true })
    }
  }

  payload.completedAt = new Date().toISOString()
  await writeResult(payload)

  for (const arm of ["direct", "goldHandoff"] as const) {
    const evaluations = results
      .map((item) => asRecord(item)?.[arm])
      .map(asRecord)
      .filter((item): item is Record<string, unknown> => item !== undefined)
    const latencyMs = evaluations.reduce((total, item) => total + (typeof item["latencyMs"] === "number" ? item["latencyMs"] : 0), 0)
    const costUsd = evaluations.reduce((total, item) => {
      const usage = asRecord(item["usage"])
      return total + (typeof usage?.["costUsd"] === "number" ? usage["costUsd"] : 0)
    }, 0)
    console.log(`${arm}: ${(latencyMs / 1000).toFixed(1)}s, $${costUsd.toFixed(6)}`)
  }
  console.log(`Wrote ${outputPath}`)
}

await main()
