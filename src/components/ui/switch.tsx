"use client"

import { cn } from "cn"
import {
  composeRenderProps,
  Switch as SwitchPrimitive,
  type SwitchProps as SwitchPrimitiveProps,
} from "react-aria-components"

/* A macOS switch: a track that fills with the accent, and a white thumb that springs across it. */
function Switch({
  className,
  size = "default",
  children,
  ...props
}: SwitchPrimitiveProps & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive
      data-slot="switch"
      data-size={size}
      className={cn(
        "group/switch relative inline-flex shrink-0 items-center rounded-full border border-transparent bg-(--track) transition-colors duration-200 outline-none after:absolute after:-inset-x-2 after:-inset-y-1.5 data-focus-visible:ring-2 data-focus-visible:ring-ring data-selected:bg-primary data-disabled:cursor-not-allowed data-disabled:opacity-50 data-[size=default]:h-[22px] data-[size=default]:w-[38px] data-[size=sm]:h-[16px] data-[size=sm]:w-[28px]",
        className
      )}
      {...props}
    >
      {composeRenderProps(children, (children, { isSelected }) => (
        <>
          <span
            data-slot="switch-thumb"
            data-selected={isSelected || undefined}
            className="pointer-events-none block rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.3),0_0_0_0.5px_rgb(0_0_0/0.08)] transition-transform duration-300 ease-spring group-data-[size=default]/switch:size-[18px] group-data-[size=default]/switch:translate-x-0.5 group-data-[size=default]/switch:data-selected:translate-x-[18px] group-data-[size=sm]/switch:size-3 group-data-[size=sm]/switch:translate-x-0.5 group-data-[size=sm]/switch:data-selected:translate-x-[14px]"
          />
          {children}
        </>
      ))}
    </SwitchPrimitive>
  )
}

export { Switch }
