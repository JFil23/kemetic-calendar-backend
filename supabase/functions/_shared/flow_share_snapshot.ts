type Row = Record<string, unknown>;

export function buildFlowShareSnapshot(
  flow: Row,
  events: Row[],
  timeZone: string,
) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  function civil(raw: unknown) {
    const date = new Date(String(raw));
    if (!Number.isFinite(date.getTime())) {
      throw new Error("Invalid flow event date");
    }
    const parts = Object.fromEntries(
      formatter.formatToParts(date).map((p) => [p.type, p.value]),
    );
    return {
      day: `${parts.year}-${parts.month}-${parts.day}`,
      time: `${parts.hour}:${parts.minute}`,
    };
  }
  const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`) / 86400000;
  const firstDay = events.length ? civil(events[0].starts_at).day : null;
  const baseDay = typeof flow.start_date === "string"
    ? flow.start_date.slice(0, 10)
    : firstDay;
  return {
    flow_id: flow.id,
    name: flow.name,
    color: flow.color,
    notes: flow.notes ?? null,
    rules: Array.isArray(flow.rules) ? flow.rules : [],
    appearance: flow.appearance ?? null,
    start_date: flow.start_date ?? null,
    end_date: flow.end_date ?? null,
    events: events.map((event) => {
      const start = civil(event.starts_at);
      const end = event.ends_at ? civil(event.ends_at) : null;
      return {
        offset_days: dayNumber(start.day) - dayNumber(baseDay ?? start.day),
        title: event.title || flow.name,
        detail: event.detail ?? null,
        location: event.location ?? null,
        all_day: event.all_day === true,
        action_id: event.action_id ?? null,
        behavior_payload: event.behavior_payload ?? null,
        ...(!event.all_day
          ? {
            start_time: start.time,
            end_time: end?.time ?? null,
            end_offset_days: end
              ? dayNumber(end.day) - dayNumber(start.day)
              : null,
          }
          : {}),
      };
    }),
  };
}
