import Image from "next/image"

import type { IconName } from "../../lib/incident-types"

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <Image
      alt=""
      aria-hidden="true"
      className="icon"
      height={size}
      loading="eager"
      src={`/icons/${name}.svg`}
      width={size}
    />
  )
}
