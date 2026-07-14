export function versionFromCodexOutput(output: string): string {
  const version = output.trim().match(/(?:codex-cli\s+)?(\d+\.\d+\.\d+)/)?.[1]
  if (!version) {
    throw new Error(`Unable to parse Codex binary version from: ${output.trim() || "<empty>"}`)
  }
  return version
}

export function versionFromUpstreamTag(tag: string): string {
  const version = tag.trim().match(/^rust-v(\d+\.\d+\.\d+)$/)?.[1]
  if (!version) {
    throw new Error(`Pinned Codex checkout must use a rust-vX.Y.Z tag, received: ${tag.trim() || "<empty>"}`)
  }
  return version
}

export function assertProtocolCompatibility(codexOutput: string, upstreamTag: string): string {
  const binaryVersion = versionFromCodexOutput(codexOutput)
  const upstreamVersion = versionFromUpstreamTag(upstreamTag)

  if (binaryVersion !== upstreamVersion) {
    throw new Error(
      `Codex binary ${binaryVersion} does not match pinned upstream ${upstreamTag}. Set CODEX_BIN to the matching binary before generating protocol files.`,
    )
  }

  return binaryVersion
}
