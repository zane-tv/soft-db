import { useCallback, useRef } from 'react'

interface SidebarResizeHandleProps {
  onResize: (deltaX: number) => void
  onDoubleClick?: () => void
}

export function SidebarResizeHandle({ onResize, onDoubleClick }: SidebarResizeHandleProps) {
  const isDragging = useRef(false)
  const lastX = useRef(0)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDragging.current = true
    lastX.current = e.clientX
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      const delta = e.clientX - lastX.current
      lastX.current = e.clientX
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
      className="sidebar-resize-handle"
      onMouseDown={handleMouseDown}
      onDoubleClick={onDoubleClick}
    >
      <div className="sidebar-resize-line" />
    </div>
  )
}
