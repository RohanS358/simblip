'use client'

// Length units. The page is measured in CENTIMETRES: 10 px = 1 cm.
//
// Everything the user reads or types — object position and size in the
// Inspector, positions and speeds on a graph — goes through here, so there is
// exactly one place that knows the scale. Object geometry stays in pixels
// internally (the canvas, hit-testing and the physics engine all work in
// pixels); this is purely the boundary where pixels become a human unit.

/** The scale of the whole app: 10 px = 1 cm. */
export const PX_PER_CM = 10

/** 1 m = 100 cm = 1000 px. Physics reports SI internally at this scale. */
export const PX_PER_M = PX_PER_CM * 100

export const pxToCm = (px: number): number => px / PX_PER_CM
export const cmToPx = (cm: number): number => cm * PX_PER_CM

/** Round-tripped display value — avoids 3.0000000000000004 in an input. */
export const pxToCmRounded = (px: number): number => Math.round((px / PX_PER_CM) * 1000) / 1000
