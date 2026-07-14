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
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("podo-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}})()`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
