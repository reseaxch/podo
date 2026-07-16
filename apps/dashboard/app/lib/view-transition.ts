import { flushSync } from "react-dom"

type ViewTransition = {
  finished: Promise<void>
  ready?: Promise<void>
  updateCallbackDone?: Promise<void>
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void | Promise<void>) => ViewTransition
}

export function runViewTransition(update: () => void): Promise<void> {
  if (typeof document === "undefined") {
    update()
    return Promise.resolve()
  }

  const transitionDocument = document as ViewTransitionDocument
  const reduceMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches

  if (!transitionDocument.startViewTransition || reduceMotion) {
    update()
    return Promise.resolve()
  }

  try {
    const transition = transitionDocument.startViewTransition(() => {
      flushSync(update)
    })

    // Browsers reject all three promises when a newer transition supersedes
    // the current one. Consume each rejection because interruption is an
    // expected part of rapidly changing filters, not an application error.
    void transition.ready?.catch(() => undefined)
    void transition.updateCallbackDone?.catch(() => undefined)

    return transition.finished.catch(() => undefined)
  } catch {
    update()
    return Promise.resolve()
  }
}
