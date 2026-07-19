#!/usr/bin/env python3
"""Generate ALL_MAAT_FLOWS_FULL_TEXT.md from the current Ma'at flow sources."""

from __future__ import annotations

from pathlib import Path
import re
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
MOBILE = ROOT / "mobile"
CALENDAR = MOBILE / "lib" / "features" / "calendar"
ASSETS = MOBILE / "assets" / "ma_at_flows"
OUTPUT = ROOT / "ALL_MAAT_FLOWS_FULL_TEXT.md"


def skip_string(text: str, index: int) -> int:
    quote = text[index]
    if text.startswith(quote * 3, index):
        cursor = index + 3
        while cursor < len(text):
            if text.startswith(quote * 3, cursor):
                return cursor + 3
            cursor += 2 if text[cursor] == "\\" else 1
        return len(text)
    cursor = index + 1
    while cursor < len(text):
        if text[cursor] == "\\":
            cursor += 2
            continue
        if text[cursor] == quote:
            return cursor + 1
        cursor += 1
    return len(text)


def find_matching(text: str, open_index: int, open_char: str, close_char: str) -> int:
    depth = 0
    cursor = open_index
    while cursor < len(text):
        char = text[cursor]
        if char in "'\"":
            cursor = skip_string(text, cursor)
            continue
        if text.startswith("//", cursor):
            newline = text.find("\n", cursor)
            cursor = len(text) if newline == -1 else newline + 1
            continue
        if text.startswith("/*", cursor):
            end = text.find("*/", cursor + 2)
            cursor = len(text) if end == -1 else end + 2
            continue
        if char == open_char:
            depth += 1
        elif char == close_char:
            depth -= 1
            if depth == 0:
                return cursor
        cursor += 1
    raise ValueError(f"No closing {close_char!r} for {open_char!r} at {open_index}")


def split_top_level(text: str, separator: str = ",") -> list[str]:
    parts: list[str] = []
    start = 0
    depth = 0
    angle_depth = 0
    cursor = 0
    while cursor < len(text):
        char = text[cursor]
        if char in "'\"":
            cursor = skip_string(text, cursor)
            continue
        if text.startswith("//", cursor):
            newline = text.find("\n", cursor)
            cursor = len(text) if newline == -1 else newline + 1
            continue
        if text.startswith("/*", cursor):
            end = text.find("*/", cursor + 2)
            cursor = len(text) if end == -1 else end + 2
            continue
        if char in "([{":
            depth += 1
        elif char in ")]}":
            depth = max(0, depth - 1)
        elif char == "<" and depth == 0:
            angle_depth += 1
        elif char == ">" and angle_depth > 0:
            angle_depth -= 1
        elif char == separator and depth == 0 and angle_depth == 0:
            value = text[start:cursor].strip()
            if value:
                parts.append(value)
            start = cursor + 1
        cursor += 1
    value = text[start:].strip()
    if value:
        parts.append(value)
    return parts


def unescape_dart_string(content: str) -> str:
    result: list[str] = []
    cursor = 0
    while cursor < len(content):
        char = content[cursor]
        if char == "\\" and cursor + 1 < len(content):
            escaped = content[cursor + 1]
            result.append(
                {
                    "n": "\n",
                    "r": "\r",
                    "t": "\t",
                    "b": "\b",
                    "f": "\f",
                }.get(escaped, escaped)
            )
            cursor += 2
        else:
            result.append(char)
            cursor += 1
    return "".join(result)


def string_literals(expression: str) -> list[str]:
    values: list[str] = []
    cursor = 0
    while cursor < len(expression):
        if expression[cursor] not in "'\"":
            cursor += 1
            continue
        quote = expression[cursor]
        if expression.startswith(quote * 3, cursor):
            start = cursor + 3
            end = start
            while end < len(expression):
                if expression.startswith(quote * 3, end):
                    values.append(unescape_dart_string(expression[start:end]))
                    cursor = end + 3
                    break
                end += 2 if expression[end] == "\\" else 1
            else:
                cursor = len(expression)
            continue
        end = cursor + 1
        buffer: list[str] = []
        while end < len(expression):
            if expression[end] == "\\" and end + 1 < len(expression):
                buffer.append(expression[end : end + 2])
                end += 2
                continue
            if expression[end] == quote:
                values.append(unescape_dart_string("".join(buffer)))
                cursor = end + 1
                break
            buffer.append(expression[end])
            end += 1
        else:
            cursor = len(expression)
    return values


def extract_const_strings(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for match in re.finditer(r"const\s+String\s+(\w+)\s*=", text):
        name = match.group(1)
        cursor = match.end()
        start = cursor
        while cursor < len(text):
            if text[cursor] in "'\"":
                cursor = skip_string(text, cursor)
                continue
            if text[cursor] == ";":
                break
            cursor += 1
        literals = string_literals(text[start:cursor])
        if literals:
            values[name] = "".join(literals)
    return values


def extract_list_content(text: str, list_name: str) -> str:
    index = text.find(list_name)
    if index == -1:
        raise ValueError(f"Could not find {list_name}")
    open_index = text.find("[", index)
    if open_index == -1:
        raise ValueError(f"Could not find list body for {list_name}")
    close_index = find_matching(text, open_index, "[", "]")
    return text[open_index + 1 : close_index]


def parse_named_object(text: str) -> dict[str, Any] | None:
    stripped = text.strip().rstrip(",")
    match = re.match(r"(?:const\s+)?([A-Za-z_]\w*)\s*\(", stripped)
    if not match:
        return None
    class_name = match.group(1)
    open_index = stripped.find("(", match.start())
    close_index = find_matching(stripped, open_index, "(", ")")
    body = stripped[open_index + 1 : close_index]
    fields: dict[str, str] = {}
    cursor = 0
    while cursor < len(body):
        while cursor < len(body) and body[cursor] in " \t\r\n,":
            cursor += 1
        if cursor >= len(body):
            break
        if body.startswith("//", cursor):
            newline = body.find("\n", cursor)
            cursor = len(body) if newline == -1 else newline + 1
            continue
        field_match = re.match(r"([A-Za-z_]\w*)\s*:", body[cursor:])
        if not field_match:
            cursor += 1
            continue
        field_name = field_match.group(1)
        cursor += field_match.end()
        start = cursor
        depth = 0
        angle_depth = 0
        while cursor < len(body):
            char = body[cursor]
            if char in "'\"":
                cursor = skip_string(body, cursor)
                continue
            if body.startswith("//", cursor):
                newline = body.find("\n", cursor)
                cursor = len(body) if newline == -1 else newline + 1
                continue
            if body.startswith("/*", cursor):
                end = body.find("*/", cursor + 2)
                cursor = len(body) if end == -1 else end + 2
                continue
            if char in "([{":
                depth += 1
            elif char in ")]}":
                if depth > 0:
                    depth -= 1
                elif char == ")":
                    break
            elif char == "<" and depth == 0:
                angle_depth += 1
            elif char == ">" and angle_depth > 0:
                angle_depth -= 1
            elif char == "," and depth == 0 and angle_depth == 0:
                break
            cursor += 1
        fields[field_name] = body[start:cursor].strip()
        if cursor < len(body) and body[cursor] == ",":
            cursor += 1
    return {"class": class_name, "fields": fields}


def parse_object_list(text: str, list_name: str, item_type: str) -> list[dict[str, Any]]:
    body = extract_list_content(text, list_name)
    objects: list[dict[str, Any]] = []
    for part in split_top_level(body):
        if re.match(rf"(?:const\s+)?{re.escape(item_type)}\s*\(", part.strip()):
            parsed = parse_named_object(part)
            if parsed:
                objects.append(parsed)
    return objects


def first_top_level_colon(text: str) -> int:
    depth = 0
    angle_depth = 0
    cursor = 0
    while cursor < len(text):
        char = text[cursor]
        if char in "'\"":
            cursor = skip_string(text, cursor)
            continue
        if char in "([{":
            depth += 1
        elif char in ")]}":
            depth = max(0, depth - 1)
        elif char == "<" and depth == 0:
            angle_depth += 1
        elif char == ">" and angle_depth > 0:
            angle_depth -= 1
        elif char == ":" and depth == 0 and angle_depth == 0:
            return cursor
        cursor += 1
    return -1


def parse_value(raw_value: str | None, consts: dict[str, str]) -> Any:
    if raw_value is None:
        return None
    raw = raw_value.strip().rstrip(",")
    if not raw or raw == "null":
        return None
    if raw in consts:
        return consts[raw]
    if "{" in raw and (raw.startswith("<") or raw.startswith("const <") or raw.startswith("{")):
        open_index = raw.find("{")
        try:
            close_index = find_matching(raw, open_index, "{", "}")
        except ValueError:
            close_index = -1
        if close_index >= 0:
            result: dict[str, Any] = {}
            for item in split_top_level(raw[open_index + 1 : close_index]):
                colon = first_top_level_colon(item)
                if colon < 0:
                    continue
                key = parse_value(item[:colon], consts)
                value = parse_value(item[colon + 1 :], consts)
                if key is not None and value is not None:
                    result[str(key)] = value
            return result or None
    if "[" in raw and (raw.startswith("<") or raw.startswith("const") or raw.startswith("[")):
        open_index = raw.find("[")
        try:
            close_index = find_matching(raw, open_index, "[", "]")
        except ValueError:
            close_index = -1
        if close_index >= 0:
            values: list[Any] = []
            for item in split_top_level(raw[open_index + 1 : close_index]):
                if item.strip().startswith("if "):
                    values.extend(string_literals(item))
                    continue
                value = parse_value(item, consts)
                if isinstance(value, list):
                    values.extend(value)
                elif value is not None:
                    values.append(value)
            return values
    literals = string_literals(raw)
    if literals:
        return "".join(literals)
    if re.fullmatch(r"true|false", raw):
        return raw
    if re.fullmatch(r"-?\d+(?:\.\d+)?", raw):
        return raw
    if re.fullmatch(r"[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+", raw):
        return raw.split(".")[-1]
    return raw


def materialize(parsed: dict[str, Any], consts: dict[str, str]) -> dict[str, Any]:
    return {
        "class": parsed["class"],
        **{key: parse_value(value, consts) for key, value in parsed["fields"].items()},
    }


def add(lines: list[str], text: str = "") -> None:
    lines.append(text)


def add_scalar(lines: list[str], label: str, value: Any) -> None:
    if value is None or value == "" or value == [] or value == {}:
        return
    if isinstance(value, str) and "\n" in value:
        add(lines, f"- {label}:")
        value_lines = [line for line in value.splitlines() if line.strip()]
        for index, line in enumerate(value_lines, start=1):
            add(lines, f"  {index}. {line}")
        return
    add(lines, f"- {label}: {value}")


def add_list(lines: list[str], label: str, values: list[Any] | None) -> None:
    if not values:
        return
    add(lines, f"- {label}:")
    for index, value in enumerate(values, start=1):
        add(lines, f"  {index}. {value}")


def add_map(lines: list[str], label: str, values: dict[str, Any] | None) -> None:
    if not values:
        return
    add(lines, f"- {label}:")
    for value in values.values():
        add(lines, f"  - {value}")


def numbered(values: list[Any] | None) -> str:
    if not values:
        return ""
    return "\n".join(f"{index}. {value}" for index, value in enumerate(values, start=1))


def bulleted(values: list[Any] | None) -> str:
    if not values:
        return ""
    return "\n".join(f"- {value}" for value in values)


def code_block(lines: list[str], text: str) -> None:
    add(lines, "```text")
    add(lines, text.rstrip())
    add(lines, "```")


def event_number(event: dict[str, Any]) -> str:
    for key in ("eventNumber", "dayNumber", "kemeticDay", "flowDay"):
        value = event.get(key)
        if value not in (None, ""):
            return str(value)
    return ""


def detail_block(event: dict[str, Any], fields: list[tuple[str, Any]]) -> str:
    parts: list[str] = []
    for label, value in fields:
        if value is None or value == "" or value == [] or value == {}:
            continue
        if isinstance(value, list):
            rendered = numbered(value) if label == "Steps" else bulleted(value)
        elif isinstance(value, dict):
            rendered = "\n".join(f"- {item}" for item in value.values())
        else:
            rendered = str(value)
        parts.append(f"{label}\n{rendered}")
    return "\n\n".join(parts)


def add_event(lines: list[str], event: dict[str, Any], detail: str | None = None) -> None:
    prefix = event_number(event)
    title = event.get("title", "Event")
    add(lines, f"### {prefix}. {title}" if prefix else f"### {title}")
    add(lines)
    add_scalar(lines, "Event number", event.get("eventNumber"))
    add_scalar(lines, "Day", event.get("dayNumber"))
    add_scalar(lines, "Flow day", event.get("flowDay"))
    add_scalar(lines, "Kemetic month", event.get("kMonth"))
    add_scalar(lines, "Kemetic day", event.get("kDay"))
    add_scalar(lines, "Section", event.get("section") or event.get("decanSection"))
    add_scalar(lines, "Netjeru", event.get("netjeruLabel"))
    add_scalar(lines, "Quality", event.get("qualityLabel"))
    add_scalar(lines, "Title", event.get("title"))
    add_scalar(lines, "Purpose", event.get("purpose"))
    add_scalar(lines, "Theme", event.get("theme"))
    add_scalar(lines, "Private prompt", event.get("privatePrompt"))
    add_scalar(lines, "Host note", event.get("hostNote"))
    add_scalar(lines, "Words", event.get("spokenLine") or event.get("words"))
    add_scalar(lines, "Delivery", event.get("deliveryBeat"))
    add_scalar(lines, "Action", event.get("action"))
    add_scalar(lines, "Provision act", event.get("provisionAct"))
    add_scalar(lines, "Ma'at act", event.get("maatAct"))
    add_scalar(lines, "Evening act", event.get("eveningAct"))
    add_list(lines, "Steps", event.get("steps"))
    add_list(lines, "Optional steps", event.get("optionalSteps"))
    add_scalar(lines, "Outdoor", event.get("outdoor"))
    add_scalar(lines, "Source note", event.get("sourceNote"))
    add_map(lines, "Completion labels", event.get("completionStatusLabels"))
    add_map(lines, "Completion labels", event.get("extraCompletionStatusLabels"))
    if detail:
        add(lines)
        add(lines, "#### Canonical Detail Text")
        add(lines)
        code_block(lines, detail)
    add(lines)


def default_event_detail(event: dict[str, Any]) -> str:
    return detail_block(
        event,
        [
            ("Purpose", event.get("purpose")),
            ("Words", f'"{event.get("spokenLine")}"' if event.get("spokenLine") else None),
            ("Delivery", event.get("deliveryBeat")),
            ("Action", event.get("action")),
            ("Provision", event.get("provisionAct")),
            ("Ma'at Act", event.get("maatAct")),
            ("Evening Act", event.get("eveningAct")),
            ("Private Prompt", event.get("privatePrompt")),
            ("Host Note", event.get("hostNote")),
            ("Steps", event.get("steps")),
            ("Optional", event.get("optionalSteps")),
        ],
    )


def offering_words(day: dict[str, Any], consts: dict[str, str]) -> str:
    number = int(str(day.get("dayNumber", "1")))
    if number <= 10:
        return consts.get("_offeringTablePersonalLine", "")
    if number <= 20:
        return consts.get("_offeringTableHouseholdLine", "")
    return consts.get("_offeringTableFlowingLine", "")


def offering_detail(day: dict[str, Any], consts: dict[str, str]) -> str:
    return detail_block(
        day,
        [
            ("Purpose", day.get("purpose")),
            ("Water", "Place a cup of water before food, phone, or work."),
            ("Words", f'"{offering_words(day, consts)}"'),
            ("Provision", day.get("provisionAct")),
            ("Optional", day.get("optionalSteps")),
            (
                "Drink",
                "Drink the water. This is reversion: provision returns through the living body, not left on the table.",
            ),
        ],
    )


def load_sources() -> tuple[dict[str, str], dict[str, dict[str, str]], dict[str, str]]:
    files = {
        path.name: path.read_text(encoding="utf-8")
        for path in CALENDAR.glob("*.dart")
        if path.is_file()
    }
    file_consts = {name: extract_const_strings(text) for name, text in files.items()}
    all_consts: dict[str, str] = {}
    for values in file_consts.values():
        all_consts.update(values)
    return files, file_consts, all_consts


def flow_info(consts: dict[str, str], pairs: list[tuple[str, str]]) -> list[tuple[str, str]]:
    return [(label, consts[name]) for label, name in pairs if consts.get(name)]


def add_flow_header(
    lines: list[str],
    number: int,
    title: str,
    source: str,
    info: list[tuple[str, str]],
) -> None:
    add(lines, f"## {number}. {title}")
    add(lines)
    add_scalar(lines, "Source", source)
    for label, value in info:
        add_scalar(lines, label, value)
    add(lines)


def add_object_flow(
    lines: list[str],
    number: int,
    title: str,
    source_file: str,
    list_name: str,
    item_type: str,
    info_pairs: list[tuple[str, str]],
    files: dict[str, str],
    file_consts: dict[str, dict[str, str]],
    all_consts: dict[str, str],
    detail_builder=None,
) -> None:
    consts = {**all_consts, **file_consts[source_file]}
    add_flow_header(
        lines,
        number,
        title,
        f"mobile/lib/features/calendar/{source_file}",
        flow_info(consts, info_pairs),
    )
    for parsed in parse_object_list(files[source_file], list_name, item_type):
        event = materialize(parsed, consts)
        detail = detail_builder(event, consts) if detail_builder else default_event_detail(event)
        add_event(lines, event, detail)


def add_track_sky(lines: list[str], number: int) -> None:
    add_flow_header(
        lines,
        number,
        "Follow the sky",
        "mobile/lib/features/calendar/track_sky_flow.dart; mobile/assets/ma_at_flows/*.md",
        [
            (
                "Overview",
                "A Ma'at flow for skywatching in season. Choose your U.S. timezone and the remaining equinoxes, lunar events, meteor peaks, and planetary highlights through March 20, 2027 will be placed on your calendar with clear guidance on when to step outside, where to look, and what change to keep.",
            )
        ],
    )
    add(lines, "### Track Sky Narrative Guidance")
    add(lines)
    source = (CALENDAR / "track_sky_flow.dart").read_text(encoding="utf-8")
    start = source.find("_TrackSkyNarrative? _trackSkyNarrativeForMetadata")
    end = source.find("String normalizeTrackSkyDetailText", start)
    section = source[start:end]
    labels = [
        "penumbral lunar eclipse",
        "partial lunar eclipse",
        "total lunar eclipse",
        "equinox",
        "solstice",
        "Meteor Showers",
        "6-planet parade",
        "venus-jupiter conjunction",
        "venus at greatest eastern elongation",
        "venus at greatest western elongation",
        "jupiter at opposition",
        "saturn at opposition",
        "mars at opposition",
        "mercury at greatest western elongation",
        "micromoon",
        "supermoon",
        "full moon",
    ]
    cursor = 0
    narratives: list[dict[str, Any]] = []
    while True:
        index = section.find("return const _TrackSkyNarrative", cursor)
        if index == -1:
            break
        call_index = section.find("_TrackSkyNarrative", index)
        open_index = section.find("(", call_index)
        close_index = find_matching(section, open_index, "(", ")")
        parsed = parse_named_object(section[call_index : close_index + 1])
        if parsed:
            narratives.append(materialize(parsed, {}))
        cursor = close_index + 1
    for label, narrative in zip(labels, narratives):
        add(lines, f"#### {label}")
        add(lines)
        add_scalar(lines, "Tracking guidance", narrative.get("trackingGuidance"))
        add_scalar(lines, "Ma'at reflection", narrative.get("maatReflection"))
        add(lines)
    add(lines, "### Asset Guides")
    add(lines)
    for asset in sorted(ASSETS.glob("track_sky_*.md")):
        add(lines, f"#### assets/ma_at_flows/{asset.name}")
        add(lines)
        add(lines, asset.read_text(encoding="utf-8").rstrip())
        add(lines)


def add_moon_return(lines: list[str], number: int, file_consts: dict[str, dict[str, str]], all_consts: dict[str, str]) -> None:
    consts = {**all_consts, **file_consts["moon_return_flow.dart"]}
    add_flow_header(
        lines,
        number,
        "The Moon Return",
        "mobile/lib/features/calendar/moon_return_flow.dart",
        flow_info(
            consts,
            [
                ("Key", "kMoonReturnFlowKey"),
                ("Tagline", "kMoonReturnTagline"),
                ("Overview", "kMoonReturnOverview"),
                ("Confidence", "kMoonReturnConfidenceLabel"),
            ],
        ),
    )
    new_event = {
        "title": "The Empty Eye / New Moon",
        "purpose": "The new moon opens an empty-sky threshold: one thing from the last cycle can be set down without needing the moon to be visible.",
        "spokenLine": "The eye has gone. The sky is cleared. I set down what the last cycle carried and let the dark receive it.",
        "steps": [
            "Step outside at dusk.",
            "Stand with the empty sky.",
            "Name one thing from the last lunar cycle that you are setting down.",
            "Variant step, Wep Ronpet new: Name the year-opening threshold plainly: what should not cross into the opened year?",
            "Variant step, solar eclipse new: If this is an eclipse window, name the rare darkness as a marked threshold.",
            "Speak the line.",
            "Return inside.",
        ],
        "outdoor": "The new moon event requires going outside at dusk, but it does not require seeing the moon. If safety, access, or weather prevents going outside, stand at a window or threshold and keep the empty-sky witness.",
    }
    full_event = {
        "title": "The Whole Eye / Full Moon",
        "purpose": "The full moon marks the Eye restored to wholeness; what has filled in this cycle is named under its returning light.",
        "spokenLine": "Horus has filled you complete with his eye. The Eye of Heru is whole. I receive what has been given.",
        "steps": [
            "Go outside at moonrise.",
            "If clouds block the moon, face its direction and stand under the sky anyway.",
            "Stand for one minute in the full moon sky.",
            "Variant step, blue moon: Notice that the Eye fills twice this Gregorian month; receive what filled again.",
            "Variant step, lunar eclipse full: If the moon passes through shadow tonight, name the restoration that returns from shadow.",
            "Variant step, supermoon full: Notice the nearest full Eye of the year and receive accordingly.",
            "Name one thing that has filled since the new moon: In this cycle, ___ filled.",
            "Speak the line.",
            "Return inside.",
        ],
        "outdoor": "The full moon event requires going outside at moonrise unless safety, access, or weather prevents it. Clouds are acceptable; presence under the sky is the act.",
    }
    add_event(lines, new_event, default_event_detail(new_event))
    add_event(lines, full_event, default_event_detail(full_event))
    add(lines, "### Variant Copy")
    add(lines)
    for value in [
        "The new moon is also a solar eclipse. The Eye covers the Sun: this threshold is marked.",
        "Tonight the Eye passes through shadow and returns. Use the blood moon framing.",
        "The Eye fills twice this month. This is a bonus Whole Eye for users already in the practice.",
        "Tonight the Eye is nearest and brighter than ordinary. Receive what has filled.",
        "The Moon covers the Sun as the Kemetic year opens. Begin here with maximum prominence.",
    ]:
        add(lines, f"- {value}")
    add(lines)


def add_decan_watch(lines: list[str], number: int, file_consts: dict[str, dict[str, str]], all_consts: dict[str, str]) -> None:
    consts = {**all_consts, **file_consts["the_decan_watch_flow.dart"]}
    add_flow_header(
        lines,
        number,
        "The Decan Watch",
        "mobile/lib/features/calendar/the_decan_watch_flow.dart",
        flow_info(
            consts,
            [
                ("Key", "kDecanWatchFlowKey"),
                ("Tagline", "kDecanWatchTagline"),
                ("Overview", "kDecanWatchOverview"),
                ("Confidence", "kDecanWatchConfidenceLabel"),
            ],
        ),
    )
    event = {
        "title": "Detail Template",
        "purpose": "The opening of [decan name] is a night-sky boundary: the sky has been counting, and one bearing can be taken for the next ten days.",
        "spokenLine": consts.get("kDecanWatchRequiredLine"),
        "outdoor": "Go outside if you can. If safety, access, or weather prevents that, stand at a window or threshold. Inside observation still counts; mark the completion as observed from inside. A clouded sky is still a valid record.",
        "steps": [
            "Go outside.",
            "Put the phone down.",
            "Stand under open sky for at least one minute.",
            "Look up.",
            "Face north first for the Imperishable Stars.",
            "Scan the full sky.",
            "Speak the line.",
            "Note the sky in one line.",
            "Open the \u1e25\ua723w day card.",
            "Read the decan name, quality, and Ma'at principle.",
            "Reset intention.",
            "Name one bearing for the coming ten days.",
        ],
    }
    add_event(lines, event, default_event_detail(event))
    add(lines, "### Milestone Messages")
    add(lines)
    for value in [
        "One decan month in the Kemetic sky.",
        "One third of the decan year observed.",
        "The full decan cycle. The Watchers have revived. The sky has returned.",
    ]:
        add(lines, f"- {value}")
    add(lines)


def add_decan_flows(lines: list[str], start_number: int, files: dict[str, str], file_consts: dict[str, dict[str, str]], all_consts: dict[str, str]) -> None:
    source_file = "maat_decan_flow.dart"
    consts = {**all_consts, **file_consts[source_file]}
    definitions = parse_object_list(files[source_file], "kMaatDecanFlowDefinitions", "MaatDecanFlowDefinition")
    for offset, definition in enumerate(definitions):
        raw_fields = definition["fields"]
        flow = materialize(definition, consts)
        add_flow_header(
            lines,
            start_number + offset,
            flow.get("title") or flow.get("key"),
            f"mobile/lib/features/calendar/{source_file}",
            [
                ("Key", flow.get("key")),
                ("Tagline", flow.get("tagline")),
                ("Overview", flow.get("overview")),
                ("Confidence", flow.get("confidenceLabel")),
                ("Routing summary", flow.get("routingSummary")),
                ("Safety note", flow.get("safetyNote")),
            ],
        )
        raw_events = raw_fields.get("events")
        if not raw_events:
            continue
        open_index = raw_events.find("[")
        close_index = find_matching(raw_events, open_index, "[", "]")
        for part in split_top_level(raw_events[open_index + 1 : close_index]):
            parsed = parse_named_object(part)
            if not parsed:
                continue
            event = materialize(parsed, consts)
            add_event(lines, event, default_event_detail(event))


def generate() -> str:
    files, file_consts, all_consts = load_sources()
    lines: list[str] = []
    add(lines, "# All Ma'at Flows - Full Text")
    add(lines)
    add(lines, "Generated from the current Ma'at Flow source files.")
    add(lines)
    add(lines, "Generator: `python3 scripts/generate_all_maat_flows_full_text.py`")
    add(lines)
    add(lines, "## Contents")
    add(lines)
    contents = [
        "Follow the sky",
        "Dawn House Rite",
        "Evening Threshold Rite",
        "The Weighing",
        "The Offering Table",
        "The Tending",
        "The Kept Word",
        "The Course",
        "The Moon Return",
        "The Wag",
        "The Decan Watch",
        "The Days Outside the Year",
        "The Open Hand",
        "The Djed",
        "The Reading House",
        "Legacy Evening Threshold",
        "The Fair Hearing",
        "The First Arrangement",
        "The Living Pattern",
        "The House of Life",
        "The Boundary Stone",
        "Hotep",
        "The Open Mouth",
        "The Living Record",
        "Het-Heru",
        "The Shore",
        "The Autobiography",
        "The True Name",
        "The Living Text",
        "The Clearing",
        "The Wandering",
        "The Khat",
        "The Oracle",
    ]
    for item in contents:
        add(lines, f"- {item}")
    add(lines)

    add_track_sky(lines, 1)
    object_flows = [
        ("Dawn House Rite", "dawn_house_rite_flow.dart", "kDawnHouseRiteDays", "DawnHouseRiteDay", [("Key", "kDawnHouseRiteFlowKey"), ("Overview", "kDawnHouseRiteOverview")], None),
        ("Evening Threshold Rite", "evening_threshold_rite_flow.dart", "kEveningThresholdRiteDays", "EveningThresholdRiteDay", [("Key", "kEveningThresholdRiteFlowKey"), ("Overview", "kEveningThresholdRiteOverview")], None),
        ("The Weighing", "the_weighing_flow.dart", "kTheWeighingEvents", "TheWeighingEvent", [("Key", "kTheWeighingFlowKey"), ("Tagline", "kTheWeighingTagline"), ("Overview", "kTheWeighingOverview")], None),
        ("The Offering Table", "the_offering_table_flow.dart", "kOfferingTableDays", "OfferingTableDay", [("Key", "kOfferingTableFlowKey"), ("Tagline", "kOfferingTableTagline"), ("Overview", "kOfferingTableOverview"), ("Enrollment copy", "kOfferingTableEnrollmentCopy")], offering_detail),
        ("The Tending", "the_tending_flow.dart", "kTheTendingEvents", "TheTendingEvent", [("Key", "kTheTendingFlowKey"), ("Tagline", "kTheTendingTagline"), ("Overview", "kTheTendingOverview")], None),
        ("The Kept Word", "the_kept_word_flow.dart", "kKeptWordEvents", "KeptWordEvent", [("Key", "kKeptWordFlowKey"), ("Tagline", "kKeptWordTagline"), ("Overview", "kKeptWordOverview")], None),
        ("The Course", "the_course_flow.dart", "kTheCourseEvents", "CourseEvent", [("Key", "kTheCourseFlowKey"), ("Tagline", "kTheCourseTagline"), ("Overview", "kTheCourseOverview")], None),
    ]
    for index, spec in enumerate(object_flows, start=2):
        title, source_file, list_name, item_type, pairs, builder = spec
        add_object_flow(lines, index, title, source_file, list_name, item_type, pairs, files, file_consts, all_consts, builder)
    add_moon_return(lines, 9, file_consts, all_consts)
    more_object_flows = [
        ("The Wag", "the_wag_flow.dart", "kWagEvents", "WagEvent", [("Key", "kTheWagFlowKey"), ("Tagline", "kTheWagTagline"), ("Overview", "kTheWagOverview")], None),
    ]
    for index, spec in enumerate(more_object_flows, start=10):
        title, source_file, list_name, item_type, pairs, builder = spec
        add_object_flow(lines, index, title, source_file, list_name, item_type, pairs, files, file_consts, all_consts, builder)
    add_decan_watch(lines, 11, file_consts, all_consts)
    final_object_flows = [
        ("The Days Outside the Year", "the_days_outside_year_flow.dart", "kDaysOutsideEvents", "DaysOutsideEvent", [("Key", "kDaysOutsideTheYearFlowKey"), ("Tagline", "kDaysOutsideTheYearTagline"), ("Overview", "kDaysOutsideTheYearOverview"), ("Confidence", "kDaysOutsideTheYearConfidenceLabel")], None),
        ("The Open Hand", "the_open_hand_flow.dart", "kOpenHandEvents", "OpenHandEvent", [("Key", "kOpenHandFlowKey"), ("Tagline", "kOpenHandTagline"), ("Overview", "kOpenHandOverview"), ("Confidence", "kOpenHandConfidenceLabel")], None),
        ("The Djed", "the_djed_flow.dart", "kDjedEvents", "DjedEvent", [("Key", "kTheDjedFlowKey"), ("Tagline", "kTheDjedTagline"), ("Overview", "kDjedOverview"), ("Confidence", "kDjedConfidenceLabel")], None),
        ("The Reading House", "the_reading_house_flow.dart", "kReadingHouseSittings", "ReadingHouseSitting", [("Key", "kReadingHouseFlowKey"), ("Tagline", "kReadingHouseTagline"), ("Overview", "kReadingHouseOverview")], None),
        ("Legacy Evening Threshold", "evening_threshold_flow.dart", "kEveningThresholdEvents", "EveningThresholdEvent", [("Key", "kEveningThresholdFlowKey"), ("Tagline", "kEveningThresholdTagline"), ("Overview", "kEveningThresholdOverview"), ("Enrollment copy", "kEveningThresholdEnrollmentCopy")], None),
    ]
    for index, spec in enumerate(final_object_flows, start=12):
        title, source_file, list_name, item_type, pairs, builder = spec
        add_object_flow(lines, index, title, source_file, list_name, item_type, pairs, files, file_consts, all_consts, builder)
    add_decan_flows(lines, 17, files, file_consts, all_consts)
    return "\n".join(lines).rstrip() + "\n"


def main() -> None:
    OUTPUT.write_text(generate(), encoding="utf-8")
    print(f"Wrote {OUTPUT}")


if __name__ == "__main__":
    main()
