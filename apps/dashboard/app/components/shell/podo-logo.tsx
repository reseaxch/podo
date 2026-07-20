import Image from "next/image"

export function PodoLogo({
  className,
  size = 22,
}: {
  className?: string
  size?: number
}) {
  return (
    <Image
      alt=""
      aria-hidden="true"
      className={className}
      height={size}
      priority
      src="/brand/podo-logo.png"
      style={{ objectFit: "contain" }}
      width={size}
    />
  )
}
