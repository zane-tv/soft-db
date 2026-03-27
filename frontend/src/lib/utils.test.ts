import '@testing-library/jest-dom/vitest'
import { describe, expect, test } from 'vitest'

import { cn } from './utils'

describe('cn', () => {
  test('merges conditional and conflicting classes', () => {
    expect(cn('px-2', false && 'hidden', 'px-4', 'text-sm')).toBe('px-4 text-sm')
  })
})
