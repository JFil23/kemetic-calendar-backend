import {
  buildDecanContextKey,
  fallbackDecanLabel,
  getDecanContext,
} from "./decan_context.ts";

const KEMETIC_EPOCH_UTC_MS = Date.UTC(2025, 2, 20);
const KEMETIC_CYCLE = [365, 365, 366, 365];
const KEMETIC_CYCLE_SUM = 1461;
const DEFAULT_TIMEZONE = "America/Los_Angeles";

export type GregorianDateParts = {
  year: number;
  month: number;
  day: number;
};

export type DecanScheduleWindow = {
  start: string;
  end: string;
  sendAt: string;
  decanName: string;
  decanTheme: string | null;
  decanContextKey: string | null;
  kYear: number;
  kMonth: number;
  decanIndex: number;
};

function formatDateOnly(parts: GregorianDateParts) {
  const yyyy = parts.year.toString().padStart(4, "0");
  const mm = parts.month.toString().padStart(2, "0");
  const dd = parts.day.toString().padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getDaysBeforeKemeticYear(kYear: number) {
  if (kYear === 1) return 0;
  const y = kYear - 1;

  if (y > 0) {
    const full = Math.floor(y / 4);
    const rem = y % 4;
    let sum = full * KEMETIC_CYCLE_SUM;
    for (let i = 0; i < rem; i += 1) {
      sum += KEMETIC_CYCLE[i];
    }
    return sum;
  }

  const n = -y;
  const full = Math.floor(n / 4);
  const rem = n % 4;
  let sum = full * KEMETIC_CYCLE_SUM;
  for (let i = 0; i < rem; i += 1) {
    sum += KEMETIC_CYCLE[3 - i];
  }
  return -sum;
}

function utcDateFromEpochDay(epochDay: number) {
  const date = new Date(KEMETIC_EPOCH_UTC_MS + epochDay * 24 * 60 * 60 * 1000);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function epochDayFromGregorian(parts: GregorianDateParts) {
  const utcNoon = Date.UTC(parts.year, parts.month - 1, parts.day, 12);
  const utcMidnight = Date.UTC(
    new Date(utcNoon).getUTCFullYear(),
    new Date(utcNoon).getUTCMonth(),
    new Date(utcNoon).getUTCDate(),
  );
  return Math.floor(
    (utcMidnight - KEMETIC_EPOCH_UTC_MS) / (24 * 60 * 60 * 1000),
  );
}

function gregorianToKemetic(parts: GregorianDateParts) {
  const diff = epochDayFromGregorian(parts);

  if (diff >= 0) {
    let kYear = 1;
    let rem = diff;

    const cycles = Math.floor(rem / KEMETIC_CYCLE_SUM);
    kYear += cycles * 4;
    rem -= cycles * KEMETIC_CYCLE_SUM;

    let idx = 0;
    while (rem >= KEMETIC_CYCLE[idx]) {
      rem -= KEMETIC_CYCLE[idx];
      kYear += 1;
      idx = (idx + 1) & 3;
    }

    const dayOfYear = rem;
    if (dayOfYear < 360) {
      return {
        kYear,
        kMonth: Math.floor(dayOfYear / 30) + 1,
        kDay: (dayOfYear % 30) + 1,
      };
    }

    return {
      kYear,
      kMonth: 13,
      kDay: dayOfYear - 360 + 1,
    };
  }

  let rem = -diff - 1;
  rem %= KEMETIC_CYCLE_SUM;

  let year = 0;
  const reverseCycle = [
    KEMETIC_CYCLE[3],
    KEMETIC_CYCLE[2],
    KEMETIC_CYCLE[1],
    KEMETIC_CYCLE[0],
  ];

  for (let i = 0; i < reverseCycle.length; i += 1) {
    const len = reverseCycle[i];
    if (rem < len) {
      const dayOfYear = len - 1 - rem;
      year -= i;
      if (dayOfYear < 360) {
        return {
          kYear: year,
          kMonth: Math.floor(dayOfYear / 30) + 1,
          kDay: (dayOfYear % 30) + 1,
        };
      }

      return {
        kYear: year,
        kMonth: 13,
        kDay: dayOfYear - 360 + 1,
      };
    }
    rem -= len;
  }

  return { kYear: -3, kMonth: 13, kDay: 1 };
}

function kemeticToGregorian(kYear: number, kMonth: number, kDay: number) {
  const dayIndex = kMonth === 13
    ? 360 + (kDay - 1)
    : ((kMonth - 1) * 30) + (kDay - 1);
  const epochDays = getDaysBeforeKemeticYear(kYear) + dayIndex;
  return utcDateFromEpochDay(epochDays);
}

function addGregorianDays(parts: GregorianDateParts, days: number) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  date.setUTCDate(date.getUTCDate() + days);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function extractDateTimeParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const values: Record<string, number> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type === "literal") continue;
    values[part.type] = Number(part.value);
  }

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function getTimezoneOffsetMs(timeZone: string, utcDate: Date) {
  const zoned = extractDateTimeParts(utcDate, timeZone);
  const asUtc = Date.UTC(
    zoned.year,
    zoned.month - 1,
    zoned.day,
    zoned.hour,
    zoned.minute,
    zoned.second,
  );
  return asUtc - utcDate.getTime();
}

function zonedDateTimeToUtcIso(
  date: GregorianDateParts,
  timeZone: string,
  hour: number,
  minute: number,
) {
  const targetUtc = Date.UTC(
    date.year,
    date.month - 1,
    date.day,
    hour,
    minute,
    0,
  );
  let guess = targetUtc;

  // Two passes are enough here because 20:00 local does not hit DST gaps.
  for (let i = 0; i < 2; i += 1) {
    const offset = getTimezoneOffsetMs(timeZone, new Date(guess));
    guess = targetUtc - offset;
  }

  return new Date(guess).toISOString();
}

export function normalizeTimeZone(timeZone?: string | null) {
  const trimmed = timeZone?.trim();
  if (!trimmed) return DEFAULT_TIMEZONE;

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed }).format(new Date());
    return trimmed;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

export function computeDecanWindowForGregorianDate(
  date: GregorianDateParts,
  timeZone?: string | null,
): DecanScheduleWindow | null {
  const normalizedTimeZone = normalizeTimeZone(timeZone);
  const kemetic = gregorianToKemetic(date);
  if (kemetic.kMonth < 1 || kemetic.kMonth > 12) {
    return null;
  }

  const decanStartDay = Math.floor((kemetic.kDay - 1) / 10) * 10 + 1;
  const decanIndex = Math.floor((decanStartDay - 1) / 10) + 1;
  const decanEndDay = decanStartDay + 9;
  const start = kemeticToGregorian(
    kemetic.kYear,
    kemetic.kMonth,
    decanStartDay,
  );
  const end = kemeticToGregorian(kemetic.kYear, kemetic.kMonth, decanEndDay);
  const decanContextKey = buildDecanContextKey(kemetic.kMonth, decanIndex);
  const context = getDecanContext(decanContextKey);
  const decanName = context?.defaultLabel ??
    fallbackDecanLabel(decanContextKey) ??
    `Decan starting ${formatDateOnly(start)}`;
  const decanTheme = context?.displayName ?? null;

  return {
    start: formatDateOnly(start),
    end: formatDateOnly(end),
    sendAt: zonedDateTimeToUtcIso(end, normalizedTimeZone, 20, 0),
    decanName,
    decanTheme,
    decanContextKey,
    kYear: kemetic.kYear,
    kMonth: kemetic.kMonth,
    decanIndex,
  };
}

export function computeCurrentAndNextDecanWindows(
  now: Date,
  timeZone?: string | null,
) {
  const normalizedTimeZone = normalizeTimeZone(timeZone);
  const localNow = extractDateTimeParts(now, normalizedTimeZone);
  const today = {
    year: localNow.year,
    month: localNow.month,
    day: localNow.day,
  };

  const windows: DecanScheduleWindow[] = [];
  const current = computeDecanWindowForGregorianDate(today, normalizedTimeZone);
  if (current) {
    windows.push(current);
    let probe = addGregorianDays({
      year: Number(current.end.slice(0, 4)),
      month: Number(current.end.slice(5, 7)),
      day: Number(current.end.slice(8, 10)),
    }, 1);

    for (let i = 0; i < 10; i += 1) {
      const next = computeDecanWindowForGregorianDate(
        probe,
        normalizedTimeZone,
      );
      if (next && next.start !== current.start) {
        windows.push(next);
        break;
      }
      probe = addGregorianDays(probe, 1);
    }
    return windows;
  }

  let probe = today;
  for (let i = 0; i < 10; i += 1) {
    probe = addGregorianDays(probe, 1);
    const next = computeDecanWindowForGregorianDate(probe, normalizedTimeZone);
    if (next) {
      windows.push(next);
      break;
    }
  }

  return windows;
}

export function computePreviousCurrentAndNextDecanWindows(
  now: Date,
  timeZone?: string | null,
) {
  const normalizedTimeZone = normalizeTimeZone(timeZone);
  const windows = computeCurrentAndNextDecanWindows(now, normalizedTimeZone);

  if (!windows.length) return windows;

  const currentStart = windows[0].start;
  const [year, month, day] = currentStart.split("-").map((value) =>
    Number(value)
  );
  const previousProbe = addGregorianDays({ year, month, day }, -1);
  const previous = computeDecanWindowForGregorianDate(
    previousProbe,
    normalizedTimeZone,
  );

  if (!previous || previous.start === currentStart) {
    return windows;
  }

  return [previous, ...windows];
}

export function computeWindowSendAt(
  decanEnd: string,
  timeZone?: string | null,
) {
  const normalizedTimeZone = normalizeTimeZone(timeZone);
  const [year, month, day] = decanEnd.split("-").map((value) => Number(value));
  return zonedDateTimeToUtcIso({ year, month, day }, normalizedTimeZone, 20, 0);
}
