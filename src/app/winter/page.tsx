import SeasonShiftPage from '@/components/SeasonShiftPage'
import { WINTER_PERIOD } from '@/types'

export default function WinterPage() {
  return <SeasonShiftPage seasonName="冬期講習" channelKey="winter" period={WINTER_PERIOD} />
}
