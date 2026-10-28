import SeasonShiftPage from '@/components/SeasonShiftPage'
import { SUMMER_PERIOD } from '@/types'

export default function SummerPage() {
  return <SeasonShiftPage seasonName="夏期講習" channelKey="summer" period={SUMMER_PERIOD} />
}
