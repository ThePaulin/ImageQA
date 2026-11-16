export function paintStroke(context, { points, diameter }) {
  const [start] = points
  context.beginPath()
  if (points.length === 1) {
    context.arc(start.x, start.y, diameter / 2, 0, Math.PI * 2)
    context.fill()
    return
  }

  context.lineWidth = diameter
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.moveTo(start.x, start.y)
  for (const point of points.slice(1)) context.lineTo(point.x, point.y)
  context.stroke()
}
