import type * as React from "react"

/**
 * A `useState` setter, as menu components receive it.
 *
 * Every menu in this folder is presentation only: it renders items and calls
 * back into `menu-bar.tsx`, which owns the state and the commands. That means
 * the props are mostly setters and handlers, and this alias keeps their
 * signatures readable.
 */
export type SetValue<T> = React.Dispatch<React.SetStateAction<T>>
