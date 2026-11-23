import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Flex, FlexItem } from '@/components/markdown/flex'

function widthVar(width: string | number) {
  const { container } = render(<Flex gap="large"><FlexItem width={width}>a</FlexItem></Flex>)
  const flex = container.firstChild as HTMLElement
  const item = flex.firstChild as HTMLElement
  return { gap: flex.style.getPropertyValue('--flex-gap'), width: item.style.getPropertyValue('--flex-item-width') }
}

describe('FlexItem width', () => {
  it('takes the gaps out of a percentage width', () => {
    const { gap, width } = widthVar('50%')
    expect(gap).toBe('2rem')
    expect(width).toBe('calc(50% - var(--flex-gap, 0px) * 0.5)')
  })

  it('passes other units through', () => {
    expect(widthVar('300px').width).toBe('300px')
  })

  it('treats a numeric width (hast parses width="30" to a number) as px', () => {
    expect(widthVar(30).width).toBe('30px')
  })

  it('does not grow an item with a width unless grow is set', () => {
    const { container } = render(<Flex><FlexItem width="30%">a</FlexItem><FlexItem>b</FlexItem><FlexItem width="30%" grow="true">c</FlexItem></Flex>)
    const [a, b, c] = Array.from((container.firstChild as HTMLElement).children)
    expect(a.className).toContain('grow-0')
    expect(b.className).toMatch(/\bgrow\b/)
    expect(c.className).not.toContain('grow-0')
  })
})
