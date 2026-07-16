"use client"

import Link from "next/link"
import { type FormEvent, useEffect, useRef, useState } from "react"

import { Icon } from "../ui/pictogram"
import styles from "./auth-screen.module.css"

type AuthMode = "signin" | "register"
type AuthErrors = Partial<Record<"name" | "email" | "password", string>>
type InspectTarget =
  "edge" | "checkout" | "payments" | "deployment" | "notification" | "orders"

type AgentPipeline = {
  evidence: string
  finding: string
  label: string
  scope: string
  stage: 1 | 2 | 3
  steps: readonly [string, string, string]
}

const AGENT_PIPELINES: Record<InspectTarget, AgentPipeline> = {
  edge: {
    evidence: "142 spans",
    finding: "Span fan-out",
    label: "edge-gateway",
    scope: "142 spans · production",
    stage: 1,
    steps: ["Read spans", "Normalize evidence", "Attach service"],
  },
  checkout: {
    evidence: "trace + code",
    finding: "Cache growth",
    label: "checkout-service",
    scope: "Error trace · cache.ts",
    stage: 2,
    steps: ["Open trace", "Inspect cache.ts", "Form hypothesis"],
  },
  payments: {
    evidence: "p95 + deploy",
    finding: "Latency regression",
    label: "payments-service",
    scope: "p95 684ms · production",
    stage: 3,
    steps: ["Compare p95", "Match deploy", "Score impact"],
  },
  deployment: {
    evidence: "commit + deploy",
    finding: "Change window",
    label: "deploy v2.8.1",
    scope: "Jul 14 · 09:58 AM",
    stage: 2,
    steps: ["Read deploy", "Match commit", "Check time window"],
  },
  notification: {
    evidence: "retries + queue",
    finding: "Retry pressure",
    label: "notification-worker",
    scope: "Consumer lag · 1.2s",
    stage: 1,
    steps: ["Read retries", "Follow consumer", "Map impact"],
  },
  orders: {
    evidence: "8 delayed events",
    finding: "Queue delay",
    label: "orders.created",
    scope: "Queue lag · 8 events",
    stage: 3,
    steps: ["Inspect queue", "Count delays", "Confirm impact"],
  },
}

const INSPECT_TARGETS = [
  "edge",
  "checkout",
  "payments",
  "deployment",
  "notification",
  "orders",
] as const satisfies readonly InspectTarget[]

const INSPECTION_POSITIONS: Record<InspectTarget, string> = {
  edge: styles.inspectEdge!,
  checkout: styles.inspectCheckout!,
  payments: styles.inspectPayments!,
  deployment: styles.inspectDeployment!,
  notification: styles.inspectNotification!,
  orders: styles.inspectOrders!,
}

function GitHubMark() {
  return (
    <svg aria-hidden="true" className={styles.githubMark} viewBox="0 0 16 16">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82A7.65 7.65 0 0 1 8 3.96a7.65 7.65 0 0 1 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  )
}

function GraphNode({
  className,
  detail,
  icon,
  label,
  signal,
  target,
}: {
  className?: string | undefined
  detail: string
  icon: "activity" | "code" | "cube" | "database" | "stack" | "warning-circle"
  label: string
  signal?: "critical" | "healthy" | "warning"
  target: InspectTarget
}) {
  return (
    <div
      className={[styles.graphNode, className].filter(Boolean).join(" ")}
      data-inspect-target={target}
    >
      <span className={styles.nodeIcon}>
        <Icon name={icon} size={16} />
      </span>
      <span className={styles.nodeCopy}>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
      {signal ? <i className={styles[signal]} /> : null}
    </div>
  )
}

function SystemGraph() {
  return (
    <div
      aria-hidden="true"
      className={`${styles.systemGraph} ${styles.backgroundGraph}`}
    >
      <GraphNode
        className={styles.edgeGateway}
        detail="p95 91ms"
        icon="cube"
        label="edge-gateway"
        signal="healthy"
        target="edge"
      />
      <GraphNode
        className={styles.checkoutService}
        detail="Service · Production"
        icon="cube"
        label="checkout-service"
        signal="critical"
        target="checkout"
      />
      <GraphNode
        className={styles.paymentsService}
        detail="p95 684ms"
        icon="cube"
        label="payments-service"
        signal="warning"
        target="payments"
      />
      <GraphNode
        className={styles.deployment}
        detail="Jul 14 · 09:58 AM"
        icon="stack"
        label="deploy v2.8.1"
        signal="healthy"
        target="deployment"
      />
      <GraphNode
        className={styles.notificationWorker}
        detail="Lag 1.2s"
        icon="cube"
        label="notification-worker"
        signal="healthy"
        target="notification"
      />
      <GraphNode
        className={styles.ordersQueue}
        detail="Queue · Lag 8"
        icon="database"
        label="orders.created"
        signal="healthy"
        target="orders"
      />
      <span className={`${styles.graphPath} ${styles.pathRequest}`} />
      <span className={`${styles.graphPath} ${styles.pathCheckout}`} />
      <span className={`${styles.graphPath} ${styles.pathEvent}`} />
      <span className={`${styles.graphPath} ${styles.pathConsumer}`} />
      <span className={`${styles.graphPath} ${styles.pathRelease}`} />
      <span className={`${styles.graphPath} ${styles.pathDeploy}`} />
    </div>
  )
}

function ScopedAgentInspection({ target }: { target: InspectTarget }) {
  const pipeline = AGENT_PIPELINES[target]

  return (
    <div
      aria-hidden="true"
      className={`${styles.inspectionAnchor} ${INSPECTION_POSITIONS[target]}`}
    >
      <article className={styles.inspectionCard}>
        <header>
          <span className={styles.inspectionMark}>
            <Icon name="robot" size={16} />
          </span>
          <span className={styles.inspectionTitle}>
            <small>
              <i /> Podo Agent · live trace
            </small>
            <strong>{pipeline.label}</strong>
          </span>
          <span className={styles.traceCounter}>
            {String(pipeline.stage).padStart(2, "0")} / 03
          </span>
        </header>

        <div className={styles.inspectionMeta}>
          <span>{pipeline.scope}</span>
          <em>Read only</em>
        </div>

        <div className={styles.findingBand}>
          <span>
            <small>Working hypothesis</small>
            <strong>{pipeline.finding}</strong>
          </span>
          <Icon name="git-fork" size={14} />
        </div>

        <ol className={styles.inspectionSteps}>
          {pipeline.steps.map((step, index) => {
            const activeIndex = pipeline.stage - 1
            const state =
              index < activeIndex
                ? "complete"
                : index === activeIndex
                  ? "active"
                  : "pending"
            const status =
              state === "complete"
                ? "Complete"
                : state === "active"
                  ? "In progress"
                  : "Queued"
            return (
              <li data-state={state} key={step}>
                <span>
                  <Icon
                    name={
                      state === "complete"
                        ? "check-circle"
                        : state === "active"
                          ? "activity"
                          : "clock"
                    }
                    size={13}
                  />
                </span>
                <strong>{step}</strong>
                <small>{status}</small>
              </li>
            )
          })}
        </ol>

        <footer className={styles.inspectionFooter}>
          <span>
            <i /> {pipeline.evidence}
          </span>
          <strong>Evidence linked</strong>
        </footer>
      </article>
    </div>
  )
}

function Spotlight() {
  return (
    <div aria-hidden="true" className={styles.spotlight}>
      <div className={styles.spotlightViewport}>
        {INSPECT_TARGETS.map((target) => (
          <ScopedAgentInspection key={target} target={target} />
        ))}
      </div>
    </div>
  )
}

function validate(mode: AuthMode, form: HTMLFormElement): AuthErrors {
  const data = new FormData(form)
  const errors: AuthErrors = {}
  const name = String(data.get("name") ?? "").trim()
  const email = String(data.get("email") ?? "").trim()
  const password = String(data.get("password") ?? "")

  if (mode === "register" && name.length < 2)
    errors.name = "Enter your full name."
  if (!/^\S+@\S+\.\S+$/.test(email)) errors.email = "Enter a valid work email."
  if (password.length < 8)
    errors.password = "Password must contain at least 8 characters."

  return errors
}

export function AuthScreen({ mode }: { mode: AuthMode }) {
  const pageRef = useRef<HTMLElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const submitTimerRef = useRef<number | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState<AuthErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [complete, setComplete] = useState(false)

  useEffect(() => {
    const page = pageRef.current
    if (!page) return

    const canInspect =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: fine) and (min-width: 821px)").matches
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches

    if (!canInspect) {
      page.dataset.enhanced = "false"
      return
    }

    page.dataset.enhanced = "true"
    const current = { x: 0, y: 0 }
    const target = { x: 0, y: 0 }
    let initialized = false
    let frame: number | null = null

    const paintSpotlight = () => {
      current.x += (target.x - current.x) * 0.28
      current.y += (target.y - current.y) * 0.28
      page.style.setProperty("--spotlight-x", `${current.x}px`)
      page.style.setProperty("--spotlight-y", `${current.y}px`)

      if (
        Math.abs(target.x - current.x) > 0.2 ||
        Math.abs(target.y - current.y) > 0.2
      ) {
        frame = window.requestAnimationFrame(paintSpotlight)
      } else {
        frame = null
      }
    }

    const aimSpotlight = (x: number, y: number) => {
      target.x = x
      target.y = y
      if (!initialized || reduceMotion) {
        initialized = true
        current.x = x
        current.y = y
        page.style.setProperty("--spotlight-x", `${x}px`)
        page.style.setProperty("--spotlight-y", `${y}px`)
        return
      }
      if (frame === null) frame = window.requestAnimationFrame(paintSpotlight)
    }

    const handlePointerMove = (event: PointerEvent) => {
      const overCard = cardRef.current?.contains(event.target as Node) ?? false
      if (overCard) {
        page.dataset.spotlight = "paused"
        return
      }
      page.dataset.spotlight = "active"
      aimSpotlight(event.clientX, event.clientY)
    }

    const handlePointerLeave = () => {
      page.dataset.spotlight = "idle"
    }

    page.dataset.spotlight = "idle"
    page.addEventListener("pointermove", handlePointerMove, { passive: true })
    page.addEventListener("pointerleave", handlePointerLeave)

    return () => {
      page.removeEventListener("pointermove", handlePointerMove)
      page.removeEventListener("pointerleave", handlePointerLeave)
      if (frame !== null) window.cancelAnimationFrame(frame)
    }
  }, [])

  useEffect(
    () => () => {
      if (submitTimerRef.current !== null)
        window.clearTimeout(submitTimerRef.current)
    },
    [],
  )

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextErrors = validate(mode, event.currentTarget)
    setErrors(nextErrors)
    setComplete(false)
    if (Object.keys(nextErrors).length) return

    setSubmitting(true)
    submitTimerRef.current = window.setTimeout(() => {
      setSubmitting(false)
      setComplete(true)
      submitTimerRef.current = null
    }, 520)
  }

  const isRegister = mode === "register"
  return (
    <main className={styles.page} ref={pageRef}>
      <SystemGraph />
      <Spotlight />

      <div
        className={`${styles.authCard} ${isRegister ? styles.registerCard : ""}`}
        ref={cardRef}
      >
        <header className={styles.brand}>
          <span className={styles.brandMark}>
            <Icon name="cube" size={20} />
          </span>
          <strong>Podo</strong>
        </header>

        <nav aria-label="Authentication mode" className={styles.modeTabs}>
          <Link
            aria-current={!isRegister ? "page" : undefined}
            className={!isRegister ? styles.activeTab : undefined}
            href="/login"
          >
            Sign in
          </Link>
          <Link
            aria-current={isRegister ? "page" : undefined}
            className={isRegister ? styles.activeTab : undefined}
            href="/register"
          >
            Create account
          </Link>
        </nav>

        <section className={styles.heading}>
          <h1>{isRegister ? "Create your workspace" : "Welcome back"}</h1>
          <p>
            {isRegister
              ? "Start with evidence, stay in control"
              : "Continue your investigation"}
          </p>
        </section>

        <form className={styles.form} noValidate onSubmit={handleSubmit}>
          {isRegister ? (
            <label>
              <span>Full name</span>
              <input
                aria-label="Full name"
                aria-describedby={errors.name ? "name-error" : undefined}
                aria-invalid={Boolean(errors.name)}
                autoComplete="name"
                name="name"
                placeholder="Maya Chen"
              />
              {errors.name ? (
                <small id="name-error" role="alert">
                  {errors.name}
                </small>
              ) : null}
            </label>
          ) : null}

          <label>
            <span>Work email</span>
            <input
              aria-label="Work email"
              aria-describedby={errors.email ? "email-error" : undefined}
              aria-invalid={Boolean(errors.email)}
              autoComplete="email"
              inputMode="email"
              name="email"
              placeholder="you@company.com"
              type="email"
            />
            {errors.email ? (
              <small id="email-error" role="alert">
                {errors.email}
              </small>
            ) : null}
          </label>

          <label>
            <span className={styles.passwordLabel}>
              Password
              {!isRegister ? (
                <Link href="/login?reset=true">Forgot password?</Link>
              ) : null}
            </span>
            <span className={styles.passwordField}>
              <input
                aria-label="Password"
                aria-describedby={
                  errors.password ? "password-error" : undefined
                }
                aria-invalid={Boolean(errors.password)}
                autoComplete={isRegister ? "new-password" : "current-password"}
                name="password"
                placeholder={
                  isRegister
                    ? "Create a strong password"
                    : "Enter your password"
                }
                type={showPassword ? "text" : "password"}
              />
              <button
                aria-label={showPassword ? "Hide password" : "Show password"}
                onClick={() => setShowPassword((visible) => !visible)}
                type="button"
              >
                <span className={styles.passwordToggleText}>
                  {showPassword ? "Hide" : "Show"}
                </span>
              </button>
            </span>
            {errors.password ? (
              <small id="password-error" role="alert">
                {errors.password}
              </small>
            ) : null}
          </label>

          <button
            className={styles.primaryAction}
            disabled={submitting}
            type="submit"
          >
            {submitting
              ? isRegister
                ? "Creating workspace…"
                : "Signing in…"
              : isRegister
                ? "Create account"
                : "Continue"}
          </button>

          <div className={styles.divider}>
            <span>or</span>
          </div>

          <button
            className={styles.githubAction}
            onClick={() => setComplete(true)}
            type="button"
          >
            <GitHubMark />
            Continue with GitHub
          </button>
        </form>

        {complete ? (
          <div aria-live="polite" className={styles.successState} role="status">
            <span>
              <Icon name="check-circle" size={17} />
            </span>
            <p>
              <strong>
                {isRegister ? "Workspace ready" : "Authentication ready"}
              </strong>
              <small>
                This prototype is ready to connect to the auth service.
              </small>
            </p>
            <Link href="/overview?mode=demo">Open Podo</Link>
          </div>
        ) : (
          <p className={styles.switchPrompt}>
            {isRegister ? "Already have an account?" : "New to Podo?"}{" "}
            <Link href={isRegister ? "/login" : "/register"}>
              {isRegister ? "Sign in" : "Create an account"}
            </Link>
          </p>
        )}
      </div>
    </main>
  )
}
