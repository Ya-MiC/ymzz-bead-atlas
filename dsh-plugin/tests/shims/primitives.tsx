/**
 * TEST SHIM, not the DSH component: minimal stand-ins for the two
 * @deepseek-ai/dsh-client-ui-primitives exports this plugin uses. In DSH the real
 * Button and Modal come from the platform module table.
 */
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string; icon?: ReactNode }>(
  function Button({ variant: _variant, size: _size, icon: _icon, children, ...rest }, ref) {
    return <button ref={ref} type="button" {...rest}>{children}</button>
  },
)

export function Modal({ open, title, children, footer, onClose, closeLabel }: {
  open: boolean; title: string; children?: ReactNode; footer?: ReactNode; onClose: () => void; closeLabel: string
}) {
  if (!open) return null
  return (
    <div role="dialog" aria-label={title}>
      <h2>{title}</h2>
      {children}
      <div>{footer}</div>
      <button type="button" onClick={onClose}>{closeLabel}</button>
    </div>
  )
}
