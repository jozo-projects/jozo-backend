import {
  assertSelectionsMatchGroups,
  buildEffectiveCustomizationGroupsFromInputs
} from '~/services/fnbMenuCustomization.service'
import { FnBMenuCustomizationGroup } from '~/models/schemas/FnBMenuItem.schema'

describe('fnbMenuCustomization service', () => {
  const templateGroups: FnBMenuCustomizationGroup[] = [
    {
      groupKey: 'ice',
      label: 'Da',
      minSelect: 1,
      maxSelect: 1,
      options: [
        { optionKey: 'less', label: 'It da', priceDelta: 0 },
        { optionKey: 'normal', label: 'Da vua', priceDelta: 0 }
      ]
    },
    {
      groupKey: 'sugar',
      label: 'Duong',
      minSelect: 1,
      maxSelect: 1,
      options: [
        { optionKey: '30', label: '30%' },
        { optionKey: '50', label: '50%' }
      ]
    }
  ]

  it('merges template groups + item group + override price', () => {
    const result = buildEffectiveCustomizationGroupsFromInputs(
      templateGroups,
      [
        {
          groupKey: 'tea',
          label: 'Luong tra',
          minSelect: 0,
          maxSelect: 1,
          options: [{ optionKey: 'extra', label: 'Them tra', priceDelta: 7000 }]
        }
      ],
      [{ groupKey: 'ice', optionKey: 'less', priceDelta: 1000 }],
      'Tra dao'
    )

    expect(result).toHaveLength(3)
    const iceGroup = result.find((g) => g.groupKey === 'ice')
    expect(iceGroup?.options.find((o) => o.optionKey === 'less')?.priceDelta).toBe(1000)
    expect(result.some((g) => g.groupKey === 'tea')).toBe(true)
  })

  it('validates selections against merged groups', () => {
    const merged = buildEffectiveCustomizationGroupsFromInputs(templateGroups, undefined, undefined, 'Tra dao')
    expect(() =>
      assertSelectionsMatchGroups('item-1', 'Tra dao', merged, [
        { groupKey: 'ice', optionKey: 'normal' },
        { groupKey: 'sugar', optionKey: '50' }
      ])
    ).not.toThrow()
  })

  it('throws when required group is missing', () => {
    const merged = buildEffectiveCustomizationGroupsFromInputs(templateGroups, undefined, undefined, 'Tra dao')
    expect(() =>
      assertSelectionsMatchGroups('item-1', 'Tra dao', merged, [{ groupKey: 'ice', optionKey: 'normal' }])
    ).toThrow()
  })
})
