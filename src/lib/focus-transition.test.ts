import { describe, expect, it } from 'vitest'

import { boxKeyframe, FOCUS_BLUR_STYLE } from './focus-transition'

describe('focus transition', () => {
  it('animates real geometry (no scale) between the slot and the card', () => {
    const slot = boxKeyframe({ left: 300, top: 40, width: 900, height: 800, radius: 0, shadow: false, paddingTop: 0 })
    const card = boxKeyframe({ left: 500, top: 24, width: 736, height: 1000, radius: 14, shadow: true, paddingTop: 44 })
    expect(slot).toMatchObject({ left: '300px', top: '40px', width: '900px', height: '800px', borderRadius: '0px', paddingTop: '0px' })
    expect(card).toMatchObject({ left: '500px', width: '736px', borderRadius: '14px', boxShadow: 'var(--sh-dialog)', paddingTop: '44px' })
    expect(Object.values(card).join(' ')).not.toContain('scale')
  })

  it('blurs and dims more at each level', () => {
    const { light, medium, strong } = FOCUS_BLUR_STYLE
    expect(light.blur).toBeLessThan(medium.blur)
    expect(medium.blur).toBeLessThan(strong.blur)
    expect(light.dim).toBeLessThan(medium.dim)
    expect(medium.dim).toBeLessThan(strong.dim)
  })
})
