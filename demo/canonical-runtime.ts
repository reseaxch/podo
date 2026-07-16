import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  CodexRuntime,
  CodexRuntimeEvent,
  CodexThreadHandle,
  CodexTurnHandle,
  StartCodexThreadInput,
} from "@podo/codex-app-server-client";

export const CACHE_IMPLEMENTATION_PATH =
  "demo/services/checkout-service/src/cache.ts";
export const CACHE_REGRESSION_PATH =
  "demo/services/checkout-service/src/cache.test.ts";

export interface CanonicalDiagnosisInput {
  evidenceIds: string[];
  affectedService: string;
  safeToAttemptFix: boolean;
}

export class CanonicalDiagnosisRuntime implements CodexRuntime {
  readonly privateThreadId = "private-codex-thread-canonical";
  readonly privateTurnId = "private-codex-turn-canonical";
  readonly listeners = new Set<(event: CodexRuntimeEvent) => void>();
  threadInput: StartCodexThreadInput | null = null;
  diagnosisEvidenceIds: string[] = [];
  rawDiagnosis = "";
  emittedDiagnosisCount = 0;
  approvalResolutionAttempts = 0;
  private automaticDiagnosis: CanonicalDiagnosisInput | null = null;

  prepareAutomaticDiagnosis(input: CanonicalDiagnosisInput): void {
    this.assertDiagnosisInput(input);
    this.automaticDiagnosis = structuredClone(input);
  }

  async startThread(input: StartCodexThreadInput) {
    this.threadInput = structuredClone(input);
    return { threadId: this.privateThreadId };
  }

  async resumeThread(): Promise<CodexThreadHandle> {
    throw new Error("The canonical diagnosis runtime does not resume threads");
  }

  async startTurn(threadId: string) {
    if (threadId !== this.privateThreadId)
      throw new Error("Unexpected private thread identity");
    if (this.automaticDiagnosis) {
      const diagnosis = structuredClone(this.automaticDiagnosis);
      setTimeout(() => this.completeValidDiagnosis(diagnosis), 0);
    }
    return { turnId: this.privateTurnId };
  }

  async steerTurn(): Promise<CodexTurnHandle> {
    throw new Error("The canonical diagnosis runtime does not steer turns");
  }

  async interruptTurn() {}

  async resolveApproval() {
    this.approvalResolutionAttempts += 1;
    throw new Error(
      "The read-only canonical diagnosis must not request approval",
    );
  }

  onEvent(listener: (event: CodexRuntimeEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async close() {}

  completeValidDiagnosis(input: CanonicalDiagnosisInput): void {
    this.assertDiagnosisInput(input);
    const { evidenceIds } = input;
    this.diagnosisEvidenceIds = [...evidenceIds];
    this.rawDiagnosis = JSON.stringify({
      schemaVersion: "podo.diagnosis.v1",
      summary: "Checkout heap growth is caused by the unbounded cache",
      affectedService: input.affectedService,
      probableRootCause:
        "CheckoutCache retains entries without eviction after the trusted deployment",
      confidence: { value: 9300, scale: "basis_points" },
      evidenceIds,
      recommendedAction:
        "Bound CheckoutCache and verify the cache-growth regression",
      safeToAttemptFix: input.safeToAttemptFix,
    });
    this.emittedDiagnosisCount += 1;
    this.emit({
      kind: "output.delta",
      threadId: this.privateThreadId,
      turnId: this.privateTurnId,
      text: this.rawDiagnosis,
    });
    this.emit({
      kind: "turn.completed",
      threadId: this.privateThreadId,
      turnId: this.privateTurnId,
      status: "completed",
    });
  }

  private assertDiagnosisInput(input: CanonicalDiagnosisInput): void {
    if (
      input.evidenceIds.length === 0 ||
      new Set(input.evidenceIds).size !== input.evidenceIds.length
    ) {
      throw new Error("Diagnosis requires unique actual incident evidence IDs");
    }
  }

  private emit(event: CodexRuntimeEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

export class CanonicalRemediationRuntime implements CodexRuntime {
  readonly privateThreadId = "private-remediation-thread-canonical";
  readonly privateTurnIds = [
    "private-remediation-turn-regression-canonical",
    "private-remediation-turn-fix-canonical",
  ];
  readonly starts: Array<{ threadId: string; input: StartCodexThreadInput }> =
    [];
  readonly resumes: Array<{ threadId: string; input: StartCodexThreadInput }> =
    [];
  readonly turns: Array<{ threadId: string; turnId: string; prompt: string }> =
    [];
  readonly phases: string[] = [];
  readonly interrupts: Array<{ threadId: string; turnId: string }> = [];
  readonly listeners = new Set<(event: CodexRuntimeEvent) => void>();
  approvalResolutionAttempts = 0;

  constructor(private readonly applyFix = true) {}

  async startThread(input: StartCodexThreadInput) {
    this.starts.push({
      threadId: this.privateThreadId,
      input: structuredClone(input),
    });
    return { threadId: this.privateThreadId };
  }

  async resumeThread(threadId: string, input: StartCodexThreadInput) {
    this.resumes.push({ threadId, input: structuredClone(input) });
    return { threadId };
  }

  async startTurn(threadId: string, prompt: string) {
    if (threadId !== this.privateThreadId)
      throw new Error("Unexpected remediation thread");
    const threadInput = this.starts[0]?.input;
    const turnId = this.privateTurnIds[this.turns.length];
    if (!threadInput || !turnId) throw new Error("Unexpected remediation turn");

    if (prompt.includes("PHASE 1 OF 2: WRITE THE REGRESSION")) {
      this.phases.push("regression");
      await writeCanonicalRegression(threadInput.cwd);
    } else if (prompt.includes("PHASE 2 OF 2: APPLY THE FIX")) {
      this.phases.push("fix");
      if (this.applyFix) await applyCanonicalFix(threadInput.cwd);
    } else {
      throw new Error("Unexpected remediation phase prompt");
    }

    this.turns.push({ threadId, turnId, prompt });
    queueMicrotask(() =>
      this.emit({
        kind: "turn.completed",
        threadId,
        turnId,
        status: "completed",
      }),
    );
    return { turnId };
  }

  async steerTurn(): Promise<CodexTurnHandle> {
    throw new Error("The canonical remediation runtime does not steer turns");
  }

  async interruptTurn(threadId: string, turnId: string) {
    this.interrupts.push({ threadId, turnId });
  }

  async resolveApproval() {
    this.approvalResolutionAttempts += 1;
    throw new Error(
      "The canonical remediation runtime must not request approval",
    );
  }

  onEvent(listener: (event: CodexRuntimeEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async close() {}

  private emit(event: CodexRuntimeEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

export interface CanonicalRemediationRepository {
  parent: string;
  repositoryRoot: string;
  scratchParent: string;
  baseCommit: string;
  dispose(): Promise<void>;
}

export async function createCanonicalRemediationRepository(
  sourceRoot: string,
  parentDirectory = tmpdir(),
): Promise<CanonicalRemediationRepository> {
  await mkdir(parentDirectory, { recursive: true });
  const parent = await mkdtemp(join(parentDirectory, "podo-canonical-demo-"));
  const repositoryRoot = join(parent, "repository");
  const scratchParent = join(parent, "scratch");
  const sourceService = join(sourceRoot, "demo/services/checkout-service");
  const targetService = join(repositoryRoot, "demo/services/checkout-service");
  await mkdir(repositoryRoot, { recursive: true });
  await mkdir(scratchParent);
  await cp(sourceService, targetService, { recursive: true });

  await git(repositoryRoot, ["init", "-b", "main"]);
  await git(repositoryRoot, ["config", "user.email", "podo@example.invalid"]);
  await git(repositoryRoot, ["config", "user.name", "Podo canonical demo"]);
  await git(repositoryRoot, ["add", "--", "demo/services/checkout-service"]);
  await git(repositoryRoot, ["commit", "-m", "canonical cache-growth fixture"]);
  const baseCommit = await git(repositoryRoot, ["rev-parse", "HEAD"]);

  return {
    parent,
    repositoryRoot,
    scratchParent,
    baseCommit,
    async dispose() {
      await rm(parent, { recursive: true, force: true });
    },
  };
}

export async function writeCanonicalRegression(
  worktreePath: string,
): Promise<void> {
  await Bun.write(
    join(worktreePath, CACHE_REGRESSION_PATH),
    [
      'import { describe, expect, test } from "bun:test"',
      'import { CheckoutCache } from "./cache"',
      "",
      'describe("CheckoutCache bounded retention", () => {',
      '  test("evicts oldest entries beyond the configured maximum", () => {',
      "    const cache = new CheckoutCache<number>(3)",
      '    cache.set("order-1", 1)',
      '    cache.set("order-2", 2)',
      '    cache.set("order-3", 3)',
      '    cache.set("order-4", 4)',
      "",
      "    expect(cache.size).toBe(3)",
      '    expect(cache.get("order-1")).toBeUndefined()',
      '    expect(cache.get("order-4")).toBe(4)',
      "  })",
      "})",
      "",
    ].join("\n"),
  );
}

export async function applyCanonicalFix(worktreePath: string): Promise<void> {
  const cachePath = join(worktreePath, CACHE_IMPLEMENTATION_PATH);
  const current = await Bun.file(cachePath).text();
  const withConstructor = current.replace(
    "export class CheckoutCache<T> {\n  private readonly entries = new Map<string, CacheEntry<T>>()",
    [
      "export class CheckoutCache<T> {",
      "  private readonly entries = new Map<string, CacheEntry<T>>()",
      "",
      "  constructor(private readonly maxEntries = 1_000) {",
      "    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {",
      '      throw new Error("maxEntries must be a positive safe integer")',
      "    }",
      "  }",
    ].join("\n"),
  );
  const fixed = withConstructor.replace(
    "    // No eviction, no TTL, no size cap — this is the defect under investigation.\n    this.entries.set(key, { value, storedAt: Date.now() })",
    [
      "    if (this.entries.has(key)) this.entries.delete(key)",
      "    this.entries.set(key, { value, storedAt: Date.now() })",
      "    while (this.entries.size > this.maxEntries) {",
      "      const oldestKey = this.entries.keys().next().value",
      "      if (oldestKey === undefined) break",
      "      this.entries.delete(oldestKey)",
      "    }",
    ].join("\n"),
  );
  if (
    fixed === current ||
    !fixed.includes("constructor(private readonly maxEntries = 1_000)") ||
    fixed.includes("No eviction, no TTL, no size cap")
  ) {
    throw new Error(
      "Canonical cache fixture no longer matches the deterministic patch",
    );
  }
  await Bun.write(cachePath, fixed);
}

async function git(cwd: string, args: string[]): Promise<string> {
  const environment: Record<string, string> = {
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_DATE: "2026-07-14T10:00:00Z",
    GIT_COMMITTER_DATE: "2026-07-14T10:00:00Z",
  };
  for (const key of ["HOME", "PATH", "TMPDIR"] as const) {
    const value = process.env[key];
    if (value) environment[key] = value;
  }
  const child = Bun.spawn(["git", ...args], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: environment,
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0)
    throw new Error(`Canonical git fixture failed: ${stderr.trim()}`);
  return stdout.trim();
}
