# Calendar Banner Product Contract

Status: **Ratified**

Ratified by: product owner

Date: 2026-08-13

Applies to: main portrait scrolling calendar in the RC geometry refactor

## Binding decision

1. The banner tracks the month at the top edge of the scroll viewport, not the
   month nearest the middle.
2. A gold divider and season header belong to the month after them, not the
   month before them.
3. A small buffer zone applies at the switch point so the label does not flicker
   when the viewport hovers near a section boundary.

## Operational interpretation

- The fixed 58 px banner sits outside the `CustomScrollView`. The activation
  line is therefore scroll-viewport local `y = 0`, immediately below the fixed
  banner; the 58 px height must not be counted a second time.
- The divider between month A and month B belongs to month B.
- A season heading belongs to the first month in that season.
- The divider after Heriu Renpet and the following Akhet heading belong to
  Thoth in the next Kemetic year.
- During chronological forward scrolling, the incoming section becomes active
  after its leading boundary passes the activation line by the named deadband.
- During reverse scrolling, the previous section becomes active after the same
  boundary passes the opposite side of the deadband.
- The deadband is one policy value owned by the calendar scroll coordinator.
  It must not be duplicated in widgets or consumers.
- When layout changes while no user, ballistic, or programmatic scroll is
  active, a mounted incumbent month remains active until a real scroll sample
  arrives. Direction must not be inferred from floating-point layout
  corrections, and geometry-only samples do not apply directional deadband.
- Slow or settled scrolling inside Heriu must resolve to Heriu. A fling may
  cross a short month between rendered frames, but the final resolved month
  must be correct and scroll end may not rewrite it differently.

## Test authorization

Tests whose names or assertions deliberately encode the old centered-month
contract may be replaced in the banner cutover commit. The replacement must be
behaviorally stronger and cover top-edge ownership, both scroll directions,
Heriu, year boundaries, and the deadband. This authorization does not permit
weakening unrelated visual, ANR, navigation, restoration, or data tests.
