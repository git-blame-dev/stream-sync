const { describe, it, expect } = require('bun:test')

const {
    calculateOverlayRowShiftDeltas,
    applyOverlayRowShiftMotion
} = require('../../../gui/src/shared/overlay-row-motion')

function createFakeElement(top) {
    return {
        style: {
            transition: '',
            transform: ''
        },
        offsetHeight: 42,
        getBoundingClientRect: () => ({ top })
    }
}

describe('overlay row motion behavior', () => {
    it('computes upward shift deltas for rows that persist across renders', () => {
        const previousTopByKey = new Map([
            ['row-a', 120],
            ['row-b', 180]
        ])
        const currentTopByKey = new Map([
            ['row-a', 90],
            ['row-b', 150],
            ['row-c', 210]
        ])

        const deltas = calculateOverlayRowShiftDeltas(previousTopByKey, currentTopByKey)

        expect(deltas.get('row-a')).toBe(30)
        expect(deltas.get('row-b')).toBe(30)
        expect(deltas.has('row-c')).toBe(false)
    })

    it('ignores rows whose vertical position did not change', () => {
        const previousTopByKey = new Map([
            ['row-a', 100]
        ])
        const currentTopByKey = new Map([
            ['row-a', 100]
        ])

        const deltas = calculateOverlayRowShiftDeltas(previousTopByKey, currentTopByKey)

        expect(deltas.size).toBe(0)
    })

    it('applies transform transition to rows that moved upward', () => {
        const rowA = createFakeElement(90)
        const rowB = createFakeElement(150)
        const rowElementsByKey = new Map([
            ['row-a', rowA],
            ['row-b', rowB]
        ])

        const currentTopByKey = applyOverlayRowShiftMotion({
            rowKeys: ['row-a', 'row-b'],
            rowElementsByKey,
            previousTopByKey: new Map([
                ['row-a', 120],
                ['row-b', 180]
            ]),
            durationMs: 1000
        })

        expect(rowA.style.transition).toBe('transform 1000ms ease-out')
        expect(rowA.style.transform).toBe('translateY(0)')
        expect(rowB.style.transition).toBe('transform 1000ms ease-out')
        expect(rowB.style.transform).toBe('translateY(0)')
        expect(currentTopByKey.get('row-a')).toBe(90)
        expect(currentTopByKey.get('row-b')).toBe(150)
    })

    it('applies off-screen entry transition to new rows and returns current top map', () => {
        const rowA = createFakeElement(90)
        const rowB = createFakeElement(150)
        const rowElementsByKey = new Map([
            ['row-a', rowA],
            ['row-b', rowB]
        ])

        const currentTopByKey = applyOverlayRowShiftMotion({
            rowKeys: ['row-a', 'row-b'],
            rowElementsByKey,
            previousTopByKey: new Map([
                ['row-a', 120]
            ]),
            durationMs: 1000
        })

        expect(currentTopByKey.size).toBe(2)
        expect(currentTopByKey.get('row-a')).toBe(90)
        expect(currentTopByKey.get('row-b')).toBe(150)
        expect(rowA.style.transition).toBe('transform 1000ms ease-out')
        expect(rowA.style.transform).toBe('translateY(0)')
        expect(rowB.style.transition).toBe('transform 1000ms ease-out')
        expect(rowB.style.transform).toBe('translateY(0)')
    })

    it('uses requestAnimationFrame transition scheduling when available', () => {
        const previousRaf = global.requestAnimationFrame
        let rafCalls = 0
        global.requestAnimationFrame = (callback) => {
            rafCalls += 1
            callback()
            return 1
        }

        try {
            const rowA = createFakeElement(90)
            const rowB = createFakeElement(150)
            const rowElementsByKey = new Map([
                ['row-a', rowA],
                ['row-b', rowB]
            ])

            applyOverlayRowShiftMotion({
                rowKeys: ['row-a', 'row-b', 'row-missing'],
                rowElementsByKey,
                previousTopByKey: new Map([
                    ['row-a', 120]
                ]),
                durationMs: 1000
            })

            expect(rafCalls).toBeGreaterThan(0)
            expect(rowA.style.transition).toBe('transform 1000ms ease-out')
            expect(rowA.style.transform).toBe('translateY(0)')
            expect(rowB.style.transition).toBe('transform 1000ms ease-out')
            expect(rowB.style.transform).toBe('translateY(0)')
        } finally {
            if (typeof previousRaf === 'function') {
                global.requestAnimationFrame = previousRaf
            } else {
                delete global.requestAnimationFrame
            }
        }
    })
})
