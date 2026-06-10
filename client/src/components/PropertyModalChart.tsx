import { AreaChart, Area, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts'

// Lazily-loaded chart used by PropertyDetailModal (via React.lazy) so the
// recharts bundle is only fetched when a chart actually renders, instead of
// being pulled into the initial bundle by the always-mounted modal.

export interface PropertyModalChartProps {
  data: Array<Record<string, any>>
  dataKey: string
  xKey: string
  height: number
  stroke: string
  fill: string
  yDomain?: [number, number]
  showTooltip?: boolean
  tickFontSize?: number
}

export default function PropertyModalChart({
  data,
  dataKey,
  xKey,
  height,
  stroke,
  fill,
  yDomain,
  showTooltip = false,
  tickFontSize = 10,
}: PropertyModalChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data}>
        <XAxis dataKey={xKey} tick={{ fontSize: tickFontSize }} />
        <YAxis domain={yDomain} tick={{ fontSize: tickFontSize }} />
        {showTooltip && <RechartsTooltip />}
        <Area type="monotone" dataKey={dataKey} stroke={stroke} fill={fill} />
      </AreaChart>
    </ResponsiveContainer>
  )
}
