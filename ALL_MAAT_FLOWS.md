# All Ma'at Flows

This file collects the Ma'at Flow registry into one readable inventory. See `ALL_MAAT_FLOWS_FULL_TEXT.md` for every day/event field, source note, optional step, and canonical detail text.

Source of truth:
- Core flow implementations: `mobile/lib/features/calendar/*_flow.dart`
- Decan Ma'at flow definitions: `mobile/lib/features/calendar/maat_decan_flow.dart`
- Track-sky asset guides: `mobile/assets/ma_at_flows/*.md`

## Counts

- Total registered Ma'at Flow templates: 31
- Core seasonal/ritual flows: 14
- Decan Ma'at practice flows: 17
- Track-sky timezone guide files: 4

## Registry

| # | Title | Key | Kind | Duration | Source |
|---:|---|---|---|---|---|
| 1 | Follow the sky | `track-the-sky` | Track Sky | Ongoing | `mobile/lib/features/calendar/track_sky_flow.dart`; `mobile/assets/ma_at_flows/*.md` |
| 2 | Dawn House Rite | `dawn-house-rite` | Dawn House Rite | 30 days | `mobile/lib/features/calendar/dawn_house_rite_flow.dart` |
| 3 | Evening Threshold Rite | `evening-threshold-rite` | Evening Threshold Rite | 30 days | `mobile/lib/features/calendar/evening_threshold_rite_flow.dart` |
| 4 | The Weighing | `the-weighing` | The Weighing | 30 days - 9 sittings | `mobile/lib/features/calendar/the_weighing_flow.dart` |
| 5 | The Offering Table | `the-offering-table` | Offering Table | 30 days - daily | `mobile/lib/features/calendar/the_offering_table_flow.dart` |
| 6 | The Tending | `the-tending` | The Tending | 30 days - 9 sittings | `mobile/lib/features/calendar/the_tending_flow.dart` |
| 7 | The Kept Word | `the-kept-word` | Kept Word | 30 days - 9 sittings | `mobile/lib/features/calendar/the_kept_word_flow.dart` |
| 8 | The Course | `the-course` | The Course | 30 days - 9 sittings | `mobile/lib/features/calendar/the_course_flow.dart` |
| 9 | The Moon Return | `the-moon-return` | Moon Return | Ongoing - about 2/month | `mobile/lib/features/calendar/moon_return_flow.dart` |
| 10 | The Wag | `the-wag` | The Wag | Annual - Month 1 | `mobile/lib/features/calendar/the_wag_flow.dart` |
| 11 | The Decan Watch | `the-decan-watch` | Decan Watch | Ongoing - about 1 / 10 days | `mobile/lib/features/calendar/the_decan_watch_flow.dart` |
| 12 | The Days Outside the Year | `the-days-outside-the-year` | Days Outside the Year | Annual - 7 days | `mobile/lib/features/calendar/the_days_outside_year_flow.dart` |
| 13 | The Open Hand | `the-open-hand` | The Open Hand | 30 days - 9 sittings | `mobile/lib/features/calendar/the_open_hand_flow.dart` |
| 14 | The Djed | `the-djed` | The Djed | 30 days - 9 sittings | `mobile/lib/features/calendar/the_djed_flow.dart` |
| 15 | The Fair Hearing | `the-fair-hearing` | Decan Ma'at | 30 days - 9 sittings | `mobile/lib/features/calendar/maat_decan_flow.dart` |
| 16 | The First Arrangement | `the-first-arrangement` | Decan Ma'at | 30 days - 9 sittings | `mobile/lib/features/calendar/maat_decan_flow.dart` |
| 17 | The Living Pattern | `the-living-pattern` | Decan Ma'at | 30 days - 9 sittings | `mobile/lib/features/calendar/maat_decan_flow.dart` |
| 18 | The House of Life | `the-house-of-life` | Decan Ma'at | 30 days - 9 sittings | `mobile/lib/features/calendar/maat_decan_flow.dart` |
| 19 | The Boundary Stone | `the-boundary-stone` | Decan Ma'at | 30 days - 9 sittings | `mobile/lib/features/calendar/maat_decan_flow.dart` |
| 20 | Hotep | `hotep` | Decan Ma'at | 30 days - 9 sittings | `mobile/lib/features/calendar/maat_decan_flow.dart` |
| 21 | The Open Mouth | `the-open-mouth` | Decan Ma'at | 30 days - 9 sittings | `mobile/lib/features/calendar/maat_decan_flow.dart` |
| 22 | The Living Record | `the-living-record` | Decan Ma'at | 30 days - 9 sittings | `mobile/lib/features/calendar/maat_decan_flow.dart` |
| 23 | Het-Heru | `het-heru` | Decan Ma'at | 30 days - 9 sittings | `mobile/lib/features/calendar/maat_decan_flow.dart` |
| 24 | The Shore | `the-shore` | Decan Ma'at | 30 days - 9 sittings | `mobile/lib/features/calendar/maat_decan_flow.dart` |
| 25 | The Autobiography | `the-autobiography` | Decan Ma'at | 30 days - 9 sittings | `mobile/lib/features/calendar/maat_decan_flow.dart` |
| 26 | The True Name | `the-true-name` | Decan Ma'at | 30 days - 9 sittings | `mobile/lib/features/calendar/maat_decan_flow.dart` |
| 27 | The Living Text | `the-living-text` | Decan Ma'at | 30 days - 9 sittings | `mobile/lib/features/calendar/maat_decan_flow.dart` |
| 28 | The Clearing | `the-clearing` | Decan Ma'at | 30 days - 9 sittings | `mobile/lib/features/calendar/maat_decan_flow.dart` |
| 29 | The Wandering | `the-wandering` | Decan Ma'at | 30 days - 9 sittings | `mobile/lib/features/calendar/maat_decan_flow.dart` |
| 30 | The Khat | `the-khat` | Decan Ma'at | 30 days - 9 sittings | `mobile/lib/features/calendar/maat_decan_flow.dart` |
| 31 | The Oracle | `the-oracle` | Decan Ma'at | 30 days - 9 sittings | `mobile/lib/features/calendar/maat_decan_flow.dart` |

## Flow Overviews

### Follow the sky

- Key: track-the-sky
- Overview: A Ma'at flow for skywatching in season. Choose your U.S. timezone and the remaining equinoxes, lunar events, meteor peaks, and planetary highlights through March 20, 2027 will be placed on your calendar with clear guidance on when to step outside, where to look, and what change to keep.

### Dawn House Rite

- Key: dawn-house-rite
- Overview: The Dawn House Rite is grounded in one of the clearest Egyptian sacred time-patterns: at dawn, the world returns to visible order. In the Pyramid Texts of Unas, washing, purification, the Lake of Dawn, and the appearance of Re are linked, making morning not just a beginning but a renewal of creation. This thirty-day flow turns that ancient pattern into a simple house observance: cleanse the hands or face, set water, greet the returning light, speak ma’at, and choose one act that brings order into the day. Its three ten-day movements—personal ma’at, household ma’at, and communal ma’at—echo the Egyptian thirty-day month divided into three ten-day periods, carrying dawn renewal from the body to the home to the wider world.

### Evening Threshold Rite

- Key: evening-threshold-rite
- Overview: The Evening Threshold Rite is a thirty-day sunset flow rooted in the Egyptian pattern of evening as a passage from visible action into hidden renewal. The report grounds this flow in the Evening Barge and the wider solar journey: as the sun leaves the seen world, the day’s work is closed, cooled, ordered, and released before the hidden hours begin. Each evening, the user pauses at sunset + 20 minutes, closes one open loop, clears one small disorder, offers gratitude or water, dims or extinguishes one light, and speaks a short line of release. Across three ten-day movements—closing the visible day, settling the house, and entering hidden renewal—the rite turns evening into a daily act of ma’at: finishing what can be finished, releasing what must wait, and preparing the self and home for restoration.

### The Weighing

- Key: the-weighing
- Overview: Three times per decan, put material, spoken, and conduct records on a scale so the gap between reality and self-story cannot widen into Isfet. The Weighing is a low-burden thirty-day Ma'at flow with nine sittings: Material Ledger, Spoken Record, and Record You Leave. It is not a budgeting app, guilt loop, confession, therapy, priestly simulation, or altar requirement; it is a practice of honest witness.

### The Offering Table

- Key: the-offering-table
- Overview: Daily morning provision on the calendar: water first, then food, rest, and care, so basic life-support does not quietly collapse into Isfet. The Offering Table is a very low-burden thirty-day Ma'at flow with one sitting each morning, moving through the Personal Table, Household Table, and Flowing Table. It is not a meal tracker, sleep app, wellness costume, or optimization flow; it is a practice of feeding what needs to be fed.

### The Tending

- Key: the-tending
- Overview: Three times per decan, see who is in your care, complete one specific tending act, and repair what was missed. The Tending is a low-burden thirty-day Ma'at flow with nine sittings: Find and See, Gather and Attend, and Stand and Restore. It is not a parenting app, a guilt loop for burned-out caregivers, or warmth-without-labor sentiment; it is a practice of care made specific.

### The Kept Word

- Key: the-kept-word
- Overview: Three times per decan, name agreements and shared rhythms, bring one break to a direct conversation, and confirm renewed order in plain words. The Kept Word is a low-medium burden thirty-day Ma'at flow with nine sittings: Name the State, Bring to Process, and Confirm the Order. It practices speaking what is true inside the closest sphere while keeping the response of the other person outside your control.

### The Course

- Key: the-course
- Overview: Three times per decan, locate yourself in the solar day, the ten-day decan, and the active Kemetic season, then do one time-appropriate act. The Course is a very low-burden thirty-day Ma'at flow with nine sittings: Daily Course, Decan Course, and Seasonal Course. It is not an astronomy flow, a morning rite, passive day-card reading, or generic seasonal journaling; it makes the ḥꜣw calendar a practice document.

### The Moon Return

- Key: the-moon-return
- Overview: At each new moon, set down one thing at dusk. At each full moon, go outside at moonrise and name what filled. The Moon Return is an ongoing Ma'at flow for the Eye of Heru cycle: emptying, restoration, and wholeness across each lunar month. Enrollment opens only at the new moon threshold.

### The Wag

- Key: the-wag
- Overview: The Wag is an annual Ma'at flow for the blessed dead: name ancestors, set water and bread, hold the Day 17 vigil, keep the Day 18 feast, then close with what they gave and what you will leave. It is fixed to Kemetic Month 1, following the year opening rather than a rolling thirty-day enrollment.

### The Decan Watch

- Key: the-decan-watch
- Overview: At each decan boundary, go outside, look up, note one line about the sky, read the day card, and name one bearing for the next ten days. The Decan Watch is an ongoing night-sky rhythm, not a drift-repair flow.

### The Days Outside the Year

- Key: the-days-outside-the-year
- Overview: Close the old Kemetic year, receive the five births of Ausar, Heru Wer, Set, Aset, and Nebet-Het across the epagomenal days, then open Wep Ronpet carrying one year intention. The Days Outside the Year is annual, fixed to the calendar, and not replayed later.

### The Open Hand

- Key: the-open-hand
- Overview: Nine sittings across thirty days: see specific need, give something real beyond your circle, and confirm that provision is flowing through you like the flood. The Open Hand is outward provision, not a donation platform, public virtue feed, or replacement for The Offering Table.

### The Djed

- Key: the-djed
- Overview: Nine sittings across thirty days: name the load-bearing elements of your life, engage what threatens them, then raise the Djed by standing upright with arms raised and declaring the spine intact.

### The Fair Hearing

- Key: the-fair-hearing
- Overview: A 30-day practice of fair judgment: hear fully before deciding, apply the same measure to those you favor and those you do not, and pronounce the decision clearly. Drawn from the nine appeals of the Eloquent Peasant.

### The First Arrangement

- Key: the-first-arrangement
- Overview: A 30-day practice of choosing one physical space, seeing what is actually there, removing what does not belong, arranging what remains, purifying it, and establishing maintenance.

### The Living Pattern

- Key: the-living-pattern
- Overview: A 30-day practice of observing one natural subject until a real pattern appears, then extracting one principle and acting from it.

### The House of Life

- Key: the-house-of-life
- Overview: A 30-day scribal practice for learning accurately: write with the hand, recite with the mouth, seek those who know more, then transmit one useful piece of knowledge.

### The Boundary Stone

- Key: the-boundary-stone
- Overview: A 30-day survey of what is yours and what is not: map resources, labor, credit, and force; name where the markers moved; then restore at least one stone to its right place.

### Hotep

- Key: hotep
- Overview: A 30-day evening practice for the peace of completed offering: name what was given, distinguish real obligation from fear of tomorrow, and let the heart cool before sleep.

### The Open Mouth

- Key: the-open-mouth
- Overview: A 30-day speech practice: record what your mouth has been creating, govern the tongue through one discipline, and say one important thing that has been withheld.

### The Living Record

- Key: the-living-record
- Overview: A 30-day practice of building a genuine decan account across ḥꜣw: day card, node library, planner, journal, feed, alignment, Flow Studio, guidance, and a physical record.

### Het-Heru

- Key: het-heru
- Overview: A 30-day practice of transforming the hot Sekhmet force into Het-Heru: name what has gone too far, find the red beer that fills the need, then practice music, feast, beauty, and joy.

### The Shore

- Key: the-shore
- Overview: A 30-day practice of honest exchange: inventory what you can offer, prepare one real exchange, make it at honest measure, and account for what returns.

### The Autobiography

- Key: the-autobiography
- Overview: A 30-day life review that surveys capacities, works, and gifts, then produces a four-section autobiography: Capacities, Works, Gifts, and Claim.

### The True Name

- Key: the-true-name
- Overview: A 30-day private self-accounting flow: identify a false account, measure it against the real record, speak the accurate account aloud, and act from it.

### The Living Text

- Key: the-living-text
- Overview: A 30-day Library practice: read carefully, add reflections, questions, connections, and close with a colophon naming what your life added to the living text.

### The Clearing

- Key: the-clearing
- Overview: A 30-day practice of temperance before response: identify where heat drives action, create space before reply, and act once from the cleared state.

### The Wandering

- Key: the-wandering
- Overview: A 30-day evening grief accompaniment: name the loss, search for what remains, and gently notice which capacities begin to open again.

### The Khat

- Key: the-khat
- Overview: A 30-day body-care practice: listen to the body, provide food, water, washing, rest, and movement, then close with a grounded body record.

### The Oracle

- Key: the-oracle
- Overview: A 30-day dream-question practice: prepare one specific oracle question, receive and record the night without early interpretation, then act on one grounded indication.
