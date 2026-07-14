"use client"

import { useState } from "react"

import type {
  RemediationController,
  RemediationViewModel,
} from "../../lib/incident-types"
import { Icon } from "../ui/pictogram"

export function ChangesView({
  controller,
  incidentId,
  onNotify,
  remediation,
}: {
  controller: RemediationController
  incidentId: string
  onNotify: (message: string) => void
  remediation: RemediationViewModel
}) {
  const [activeFile, setActiveFile] = useState<"cache" | "tests">("cache")
  const [testsExpanded, setTestsExpanded] = useState(false)
  const [sandboxOpen, setSandboxOpen] = useState(false)
  const [currentRemediation, setCurrentRemediation] = useState(remediation)
  const [feedbackDraftOpen, setFeedbackDraftOpen] = useState(false)
  const [feedback, setFeedback] = useState("")
  const [pendingAction, setPendingAction] = useState<
    "feedback" | "approval" | "review" | null
  >(null)
  const reviewState = currentRemediation.reviewState

  const status = feedbackDraftOpen
    ? "Writing feedback"
    : reviewState === "approved"
      ? "PR created"
      : reviewState === "changes-requested"
        ? "Changes requested"
        : "Ready for review"
  const footerTitle = feedbackDraftOpen
    ? "Approval paused"
    : reviewState === "approved"
      ? `PR #${currentRemediation.pullRequest?.number ?? "—"} created`
      : reviewState === "changes-requested"
        ? "Revision requested"
        : "Ready for human approval"
  const footerDetail = feedbackDraftOpen
    ? "Finish or cancel the feedback draft above"
    : reviewState === "approved"
      ? `${currentRemediation.branch} · awaiting CI`
      : reviewState === "changes-requested"
        ? "Podo AI will update the patch and rerun verification"
        : `Target: ${currentRemediation.branch} · base: ${currentRemediation.baseBranch}`

  async function approveChange() {
    setPendingAction("approval")
    try {
      const next = await controller.approveAndCreatePullRequest({
        incidentId,
        remediationId: currentRemediation.id,
      })
      setCurrentRemediation(next)
      onNotify(
        `PR #${next.pullRequest?.number ?? "—"} created from the verified sandbox`,
      )
    } catch {
      onNotify("Approval failed; no remediation state changed")
    } finally {
      setPendingAction(null)
    }
  }
  async function submitFeedback() {
    if (!feedback.trim()) return
    setPendingAction("feedback")
    try {
      const next = await controller.requestChanges({
        feedback,
        incidentId,
        remediationId: currentRemediation.id,
      })
      setCurrentRemediation(next)
      setFeedbackDraftOpen(false)
      setFeedback("")
      onNotify("Review feedback sent to Podo AI")
    } catch {
      onNotify("Feedback was not accepted; review state is unchanged")
    } finally {
      setPendingAction(null)
    }
  }

  async function returnToReview() {
    setPendingAction("review")
    try {
      const next = await controller.returnToReview({
        incidentId,
        remediationId: currentRemediation.id,
      })
      setCurrentRemediation(next)
      setFeedback("")
      onNotify("Remediation returned to review")
    } catch {
      onNotify("Review state could not be changed")
    } finally {
      setPendingAction(null)
    }
  }

  return (
    <section className="changes-view" aria-labelledby="changes-heading">
      <div className="view-heading changes-heading">
        <div>
          <p className="view-kicker">Proposed change · sandbox verified</p>
          <h2 id="changes-heading">
            Bound cache growth without changing the API
          </h2>
          <p>
            Replace the unbounded map with a 500-entry LRU cache, enforce a 60s
            TTL, and protect the behavior with regression tests.
          </p>
        </div>
        <div className="view-actions">
          <span
            className={`status-chip state-${feedbackDraftOpen ? "feedback" : reviewState}`}
          >
            {status}
          </span>
          <button
            aria-expanded={sandboxOpen}
            className="secondary-button"
            onClick={() => setSandboxOpen((open) => !open)}
            type="button"
          >
            <Icon name="terminal-window" size={16} />{" "}
            {sandboxOpen ? "Hide sandbox" : "View sandbox"}
          </button>
        </div>
      </div>
      {sandboxOpen ? (
        <section className="sandbox-strip" aria-label="Sandbox details">
          <span className="sandbox-icon">
            <Icon name="terminal-window" size={18} />
          </span>
          <span>
            <small>Environment</small>
            <strong>podo-sbx-inc-042</strong>
            <em>Read-only preview</em>
          </span>
          <span>
            <small>Run</small>
            <strong>sbx_7fa2c1</strong>
            <em>Completed in 42s</em>
          </span>
          <span>
            <small>Branch</small>
            <strong>fix/inc-042-cache-growth</strong>
            <em>2 files changed</em>
          </span>
          <span>
            <small>Verified</small>
            <strong>10:24 AM</strong>
            <em>Commit a3f7c2d</em>
          </span>
          <button
            aria-label="Close sandbox details"
            onClick={() => setSandboxOpen(false)}
            type="button"
          >
            ×
          </button>
        </section>
      ) : null}
      <div className="remediation-summary">
        <span>
          <small>Patch scope</small>
          <strong>2 files</strong>
          <em>+18 −4</em>
        </span>
        <span>
          <small>Verification</small>
          <strong>6 / 6</strong>
          <em className="passed">All checks passed</em>
        </span>
        <span>
          <small>Projected heap</small>
          <strong>94% → 36%</strong>
          <em>−62% at peak</em>
        </span>
        <span>
          <small>Deployment risk</small>
          <strong>Low</strong>
          <em>Internal cache only</em>
        </span>
      </div>
      <section className="change-rationale" aria-label="Change rationale">
        <span className="rationale-icon">
          <Icon name="wrench" size={18} />
        </span>
        <span>
          <small>Why this patch</small>
          <strong>
            It removes the unbounded retention path identified in the causal
            graph.
          </strong>
          <p>
            Eviction caps memory while TTL removes stale cart payloads. Public
            methods, payload types, and checkout responses stay unchanged.
          </p>
        </span>
        <div>
          <span>
            <b>500</b>
            <small>max entries</small>
          </span>
          <span>
            <b>60s</b>
            <small>TTL</small>
          </span>
          <span>
            <b>0</b>
            <small>API changes</small>
          </span>
        </div>
      </section>
      <div className="remediation-workspace">
        <section className="diff-panel" aria-labelledby="diff-title">
          <header>
            <div>
              <Icon name="git-diff" size={18} />
              <span>
                <strong id="diff-title">Proposed patch</strong>
                <small>
                  Generated from verified evidence · Podo AI run 42s
                </small>
              </span>
            </div>
            <span className="diff-count">
              <b>+18</b>
              <i>−4</i>
            </span>
          </header>
          <nav aria-label="Changed files">
            <button
              aria-current={activeFile === "cache" ? "page" : undefined}
              onClick={() => setActiveFile("cache")}
              type="button"
            >
              <Icon name="file-code" size={15} />
              <span>
                cache.ts<small>Implementation</small>
              </span>
              <b>+8 −3</b>
            </button>
            <button
              aria-current={activeFile === "tests" ? "page" : undefined}
              onClick={() => setActiveFile("tests")}
              type="button"
            >
              <Icon name="file-code" size={15} />
              <span>
                cache.test.ts<small>Regression coverage</small>
              </span>
              <b>+10 −1</b>
            </button>
          </nav>
          {activeFile === "cache" ? (
            <>
              <div className="diff-file-heading">
                <code>services/checkout/cache.ts</code>
                <span>@@ -42,8 +42,13 @@</span>
              </div>
              <pre className="diff-code" aria-label="Implementation code diff">
                <code>
                  <span>
                    <b>42</b>
                    <i> </i>export class CheckoutCache {`{`}
                  </span>
                  <span className="removed">
                    <b>43</b>
                    <i>−</i> private entries = new Map&lt;string, Payload&gt;();
                  </span>
                  <span className="added">
                    <b>43</b>
                    <i>+</i> private entries = new LruCache&lt;string,
                    Payload&gt;({`{`}
                  </span>
                  <span className="added">
                    <b>44</b>
                    <i>+</i> max: 500,
                  </span>
                  <span className="added">
                    <b>45</b>
                    <i>+</i> ttl: 60_000,
                  </span>
                  <span className="added">
                    <b>46</b>
                    <i>+</i> {`}`});
                  </span>
                  <span>
                    <b>47</b>
                    <i> </i>
                  </span>
                  <span>
                    <b>48</b>
                    <i> </i> set(key: string, payload: Payload) {`{`}
                  </span>
                  <span className="removed">
                    <b>49</b>
                    <i>−</i> this.entries.set(key, payload);
                  </span>
                  <span className="added">
                    <b>49</b>
                    <i>+</i> this.entries.set(key, payload, {`{ ttl: 60_000 }`}
                    );
                  </span>
                  <span>
                    <b>50</b>
                    <i> </i> {`}`}
                  </span>
                </code>
              </pre>
            </>
          ) : (
            <>
              <div className="diff-file-heading">
                <code>services/checkout/cache.test.ts</code>
                <span>@@ -18,5 +18,14 @@</span>
              </div>
              <pre className="diff-code" aria-label="Regression test code diff">
                <code>
                  <span>
                    <b>18</b>
                    <i> </i>describe(&quot;CheckoutCache eviction&quot;, ()
                    =&gt; {`{`}
                  </span>
                  <span className="added">
                    <b>19</b>
                    <i>+</i> it(&quot;bounds cache at 500 entries&quot;, ()
                    =&gt; {`{`}
                  </span>
                  <span className="added">
                    <b>20</b>
                    <i>+</i> seedCache(501);
                  </span>
                  <span className="removed">
                    <b>21</b>
                    <i>−</i> expect(cache.size).toBe(501);
                  </span>
                  <span className="added">
                    <b>21</b>
                    <i>+</i> expect(cache.size).toBe(500);
                  </span>
                  <span className="added">
                    <b>22</b>
                    <i>+</i> expect(cache.has(&quot;cart:0&quot;)).toBe(false);
                  </span>
                  <span className="added">
                    <b>23</b>
                    <i>+</i> {`}`});
                  </span>
                  <span className="added">
                    <b>24</b>
                    <i>+</i> it(&quot;expires stale entries after TTL&quot;, ()
                    =&gt; {`{`}
                  </span>
                  <span className="added">
                    <b>25</b>
                    <i>+</i> vi.advanceTimersByTime(60_001);
                  </span>
                  <span className="added">
                    <b>26</b>
                    <i>+</i> expect(cache.size).toBe(0);
                  </span>
                  <span>
                    <b>27</b>
                    <i> </i>
                    {`}`});
                  </span>
                </code>
              </pre>
            </>
          )}
          <footer className="diff-explanation">
            <Icon name="shield-check" size={16} />
            <span>
              <strong>
                {activeFile === "cache"
                  ? "Behavioral boundary"
                  : "Regression guarantee"}
              </strong>
              <small>
                {activeFile === "cache"
                  ? "Only internal storage changes; callers keep the same API."
                  : "Tests lock both the capacity ceiling and stale-entry expiry."}
              </small>
            </span>
          </footer>
        </section>
        <aside className="verification-panel">
          <header>
            <Icon name="shield-check" size={18} />
            <span>
              <strong>Review readiness</strong>
              <small>Verified in isolated sandbox</small>
            </span>
            <b className="readiness-score">6/6</b>
          </header>
          <section>
            <div className="verification-title">
              <span>
                <Icon name="check-circle" size={17} /> Automated checks
              </span>
              <strong>Passed</strong>
            </div>
            <ul>
              <li>
                <span>bounds cache at 500 entries</span>
                <b>18ms</b>
              </li>
              <li>
                <span>expires entries after TTL</span>
                <b>12ms</b>
              </li>
              <li>
                <span>preserves active carts</span>
                <b>9ms</b>
              </li>
              {testsExpanded ? (
                <>
                  <li>
                    <span>keeps checkout API contract</span>
                    <b>14ms</b>
                  </li>
                  <li>
                    <span>evicts least-recently-used key</span>
                    <b>11ms</b>
                  </li>
                  <li>
                    <span>passes TypeScript validation</span>
                    <b>1.2s</b>
                  </li>
                </>
              ) : null}
            </ul>
            <button
              aria-expanded={testsExpanded}
              className="text-link"
              onClick={() => setTestsExpanded((expanded) => !expanded)}
              type="button"
            >
              {testsExpanded ? "Show primary checks" : "View all 6 checks"}
            </button>
          </section>
          <section className="impact-section">
            <h3>Expected production impact</h3>
            <div>
              <span>Peak heap</span>
              <strong>
                <s>94%</s> 36%
              </strong>
            </div>
            <div>
              <span>p95 latency</span>
              <strong>
                <s>812ms</s> 422ms
              </strong>
            </div>
            <div>
              <span>API contract</span>
              <strong className="unchanged">Unchanged</strong>
            </div>
          </section>
          <section className="rollout-section">
            <h3>Rollout guardrails</h3>
            <ol>
              <li>
                <span>1</span>
                <p>
                  <strong>10% canary</strong>
                  <small>One region · 15 min</small>
                </p>
              </li>
              <li>
                <span>2</span>
                <p>
                  <strong>Watch heap and p95</strong>
                  <small>Rollback if heap exceeds 75%</small>
                </p>
              </li>
              <li>
                <span>3</span>
                <p>
                  <strong>Complete rollout</strong>
                  <small>After two healthy windows</small>
                </p>
              </li>
            </ol>
          </section>
          <div className="safety-note">
            <Icon name="shield-check" size={17} />
            <span>
              <strong>Safe approval boundary</strong>
              <small>
                Approval creates a PR only. It cannot deploy or mutate
                production.
              </small>
            </span>
          </div>
        </aside>
      </div>
      {feedbackDraftOpen ? (
        <section className="review-feedback" aria-label="Request changes">
          <span>
            <small>Reviewer feedback</small>
            <strong>What should Podo AI revise before approval?</strong>
          </span>
          <textarea
            autoFocus
            onChange={(event) => setFeedback(event.target.value)}
            placeholder="Example: reduce the cache limit to 350 entries and rerun the heap projection."
            rows={3}
            value={feedback}
          />
          <div>
            <button
              className="secondary-button"
              onClick={() => {
                setFeedbackDraftOpen(false)
                setFeedback("")
              }}
              type="button"
            >
              Cancel
            </button>
            <button
              className="primary-button"
              disabled={!feedback.trim() || pendingAction !== null}
              onClick={submitFeedback}
              type="button"
            >
              Send feedback
            </button>
          </div>
        </section>
      ) : null}
      <footer
        className={`approval-bar approval-${feedbackDraftOpen ? "feedback" : reviewState}`}
      >
        <span>
          <Icon
            name={
              reviewState === "approved"
                ? "check-circle"
                : reviewState === "changes-requested" || feedbackDraftOpen
                  ? "warning-circle"
                  : "git-branch"
            }
            size={18}
          />
          <span>
            <strong>{footerTitle}</strong>
            <small>{footerDetail}</small>
          </span>
        </span>
        <div>
          {reviewState === "approved" ? (
            <button
              className="primary-button"
              onClick={() =>
                onNotify(
                  `Opening PR #${currentRemediation.pullRequest?.number ?? "—"}`,
                )
              }
              type="button"
            >
              <Icon name="arrow-square-out" size={16} /> Open PR #
              {currentRemediation.pullRequest?.number ?? "—"}
            </button>
          ) : reviewState === "changes-requested" ? (
            <button
              className="secondary-button"
              disabled={pendingAction !== null}
              onClick={returnToReview}
              type="button"
            >
              Return to review
            </button>
          ) : feedbackDraftOpen ? null : (
            <>
              <button
                className="secondary-button"
                disabled={pendingAction !== null}
                onClick={() => setFeedbackDraftOpen(true)}
                type="button"
              >
                Request changes
              </button>
              <button
                className="primary-button"
                disabled={pendingAction !== null}
                onClick={approveChange}
                type="button"
              >
                <Icon name="git-branch" size={17} /> Approve &amp; create PR
              </button>
            </>
          )}
        </div>
      </footer>
    </section>
  )
}
