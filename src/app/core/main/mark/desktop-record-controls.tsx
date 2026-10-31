'use client'

import { ControlFile } from './control-file'
import { ControlImage } from './control-image'
import { ControlRecording } from './control-recording'
import { ControlScan } from './control-scan'

/**
 * The original media controls own native file, microphone and screenshot APIs.
 * Keep one desktop-only host alive while the unified dialog routes to them.
 */
export function DesktopRecordControls() {
  return (
    <div className="hidden" aria-hidden="true">
      <ControlRecording />
      <ControlScan />
      <ControlImage />
      <ControlFile />
    </div>
  )
}
