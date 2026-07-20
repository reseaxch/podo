import Link from "next/link"

export default function BuildIncidentNotFound() {
  return (
    <main className="page-state">
      <h1>Build incident not found</h1>
      <p>The Core record may have expired or the ID is invalid.</p>
      <Link className="primary-button" href="/build-incidents">
        Return to build incidents
      </Link>
    </main>
  )
}
