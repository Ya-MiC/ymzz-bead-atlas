/**
 * Type surface of the DSH platform modules this Client imports. They are not
 * bundled: DSH's module loader supplies them at runtime (the platform module table in
 * @deepseek-ai/dsh-client-modules). Only the members used here are declared.
 */
declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { ButtonHTMLAttributes, ForwardRefExoticComponent, ReactNode, RefAttributes } from 'react'
  export type ButtonVariant = 'primary' | 'ghost' | 'outline' | 'toolbar'
  export const Button: ForwardRefExoticComponent<{
    variant?: ButtonVariant
    size?: 'md' | 'sm'
    icon?: ReactNode
    className?: string | undefined
    children?: ReactNode
  } & ButtonHTMLAttributes<HTMLButtonElement> & RefAttributes<HTMLButtonElement>>
  export function Modal(props: {
    open: boolean
    onClose: () => void
    title: string
    tone?: 'warning'
    description?: string
    children?: ReactNode
    footer?: ReactNode
    closeLabel: string
  }): ReactNode
}

declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
