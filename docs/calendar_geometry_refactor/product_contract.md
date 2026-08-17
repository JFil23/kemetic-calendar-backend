# Calendar Banner Product Contract

Status: **Ratified, amended after RC visual verification and weekday-strip follow-up**

Ratified by: product owner

Date: 2026-08-13; weekday-strip amendment 2026-08-16

Applies to: main portrait scrolling calendar in the RC geometry refactor

## Binding decision

1. The banner tracks the month at the top edge of the scroll viewport, not the
   month nearest the middle.
2. A gold divider and season header belong to the month after them, not the
   month before them.
3. A small buffer zone applies at the switch point so the label does not flicker
   when the viewport hovers near a section boundary.
4. The banner handoff occurs before the physical month boundary: once the
   outgoing month's third-decan label has passed the activation line and its
   final weekday/day block is reached, the banner names the next month.

## Operational interpretation

- The fixed calendar header sits outside the `CustomScrollView`. Its month band
  remains 58 px and a 24 px weekday strip sits beneath it. The activation line
  is therefore scroll-viewport local `y = 0`, immediately below the combined
  fixed header; neither fixed band is counted a second time.
- The weekday strip follows the weekday sequence of the decan label that most
  recently crossed the activation line. Its handoff coordinates are measured
  from rendered labels and published in the same atomic geometry snapshot as
  month and Gregorian boundaries; it does not estimate row heights.
- Heriu Renpet publishes its sole weekday row as the equivalent activation
  boundary so the fixed strip remains valid across the short month and year
  boundary.
- The divider between month A and month B belongs to month B.
- A season heading belongs to the first month in that season.
- The divider after Heriu Renpet and the following Akhet heading belong to
  Thoth in the next Kemetic year.
- For an ordinary 30-day month, the handoff coordinate is the measured edge
  immediately after its third-decan label and before the final (days 21-30)
  weekday/day block. It is derived from rendered geometry, not a fixed pixel
  estimate.
- For Heriu Renpet, which has no three-decan structure, the handoff coordinate
  is the measured leading edge of its single five- or six-day weekday/day
  block. This preserves a real Heriu banner interval across the year boundary.
- During chronological forward scrolling, the logical successor becomes active
  after the outgoing month's handoff coordinate passes the activation line by
  the named deadband.
- During reverse scrolling, the outgoing month becomes active again after that
  same handoff coordinate passes the opposite side of the deadband.
- Physical section ownership does not change. Gold dividers, season headers,
  restoration, hydration, pinch, and rotation continue to use full logical
  month sections; the earlier handoff is banner policy only.
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
contract may be replaced in the banner cutover commit or amended RC follow-up.
The replacement must be behaviorally stronger and cover the measured
final-day-block handoff, both scroll directions, Heriu, year boundaries, and
the deadband. This authorization does not permit
weakening unrelated visual, ANR, navigation, restoration, or data tests.
