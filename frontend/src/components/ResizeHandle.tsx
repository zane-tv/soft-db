import { useCallback, useRef } from 'react'

interface ResizeHandleProps {
  onResize: (deltaY: number) => void
  onDoubleClick?: () => void
}

export function ResizeHandle({ onResize, onDoubleClick }: ResizeHandleProps) {
  const isDragging = useRef(false)
  const lastY = useRef(0)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDragging.current = true
    lastY.current = e.clientY
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      const delta = e.clientY - lastY.current
      lastY.current = e.clientY
      onResize(delta)
    }

    const handleMouseUp = () => {
      isDragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [onResize])

  return (
    <div
      className="h-[5px] shrink-0 cursor-row-resize relative group z-20"
      onMouseDown={handleMouseDown}
      onDoubleClick={onDoubleClick}
    >
      {/* Visible line */}
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[1px] bg-border-subtle/30 group-hover:bg-primary/50 transition-colors" />
      {/* Wider hit area (invisible) */}
      <div className="absolute inset-x-0 -top-2 -bottom-2" />
      {/* Center dots indicator on hover */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <span className="w-1 h-1 rounded-full bg-primary/50" />
        <span className="w-1 h-1 rounded-full bg-primary/50" />
        <span className="w-1 h-1 rounded-full bg-primary/50" />
      </div>
    </div>
  )
}
