/** Sidebar icon: a 3 × 3 bead grid. Drawn with currentColor so DSH's sidebar tones it. */
export interface BeadAtlasIconProps {
  readonly size?: number
  readonly active?: boolean
}

export function BeadAtlasIcon({ size = 16 }: BeadAtlasIconProps) {
  const cells = [4, 10, 16]
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" focusable="false">
      {cells.flatMap(y => cells.map(x => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r={2.3} stroke="currentColor" strokeWidth={1.4} fill={x === 10 && y === 10 ? 'currentColor' : 'none'} />
      )))}
    </svg>
  )
}
