import { type KeyboardEventHandler, type PointerEventHandler } from 'react'

interface Props {
  active: boolean
  label: string
  valueNow: number
  valueMin: number
  valueMax: number
  onPointerDown: PointerEventHandler<HTMLDivElement>
  onKeyDown: KeyboardEventHandler<HTMLDivElement>
}

export default function VerticalResizeHandle({
  active,
  label,
  valueNow,
  valueMin,
  valueMax,
  onPointerDown,
  onKeyDown
}: Props) {
  return (
    <div
      className={`panel-resize-handle ${active ? 'active' : ''}`}
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuenow={Math.round(valueNow)}
      aria-valuemin={valueMin}
      aria-valuemax={valueMax}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  )
}
