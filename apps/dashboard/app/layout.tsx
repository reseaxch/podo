import type { Metadata } from "next"
import type { ReactNode } from "react"
import "./globals.css"

export const metadata: Metadata = {
  title: "Podo · Incident Workspace",
  description:
    "Evidence-backed incident investigation and Podo AI remediation.",
}

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("podo-theme-v2");document.documentElement.dataset.theme=t==="light"?"light":"dark"}catch(e){document.documentElement.dataset.theme="dark"}})()`,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var r=document.documentElement;r.dataset.inputModality="pointer";addEventListener("pointerdown",function(){r.dataset.inputModality="pointer"},true);addEventListener("keydown",function(e){if(!e.metaKey&&!e.ctrlKey&&!e.altKey)r.dataset.inputModality="keyboard"},true)})()`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
