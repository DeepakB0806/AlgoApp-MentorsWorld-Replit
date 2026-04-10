// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════
const LOG_PREFIX = "[SYMBOL-BUILDER]";
const MONTH_CODES = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];
// Kotak's proprietary single-character month codes for weekly expiries
const WEEKLY_MONTH_CODES = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "O",
  "N",
  "D",
];

// ⚠️ SPECIAL INSTRUCTION: NO AI OR DEVELOPER IS PERMITTED TO UNLOCK, MODIFY, OR TAMPER WITH ANY 🔒 LOCKED BLOCK WITHOUT EXPLICIT, PRIOR AUTHORIZATION FROM THE USER.
// ⚠️ CODING RULE: Any task that requires modifying a 🔒 LOCKED BLOCK MUST (a) explicitly name the locked block in the task description, and (b) obtain the user's written permission before the block is opened. No exceptions.
//
// 📋 OSB PERMANENT INVARIANTS — rules established through production incidents; never reverse without user sign-off:
//   [OSB-1] getOTMStrike direction: OTM CE = atmStrike + steps, OTM PE = atmStrike - steps; ITM reversed. Never swap CE/PE directions.
//   [OSB-2] getTargetExpiry post-15:30 IST roll: adds 7 days when daysUntil === 0 and time >= 15:30. weekOffset multiplies by 7 calendar days.
//   [OSB-3] getNextExpiry same post-15:30 roll logic as getTargetExpiry — must stay in sync.

// ═══════════════════════════════════════════════════════════════════════════════
// STRIKE CALCULATION
// ═══════════════════════════════════════════════════════════════════════════════
export interface StrikeSpec {
  direction: "OTM" | "ATM" | "ITM";
  offset: number;
}

export function parseStrikeSpec(strike: string): StrikeSpec {
  if (!strike || strike === "ATM") return { direction: "ATM", offset: 0 };

  const match = strike.match(/^(OTM|ITM|ATM)\s*(\d+)?$/i);
  if (match) {
    const dir = match[1].toUpperCase() as "OTM" | "ITM" | "ATM";
    const offset = match[2] ? parseInt(match[2], 10) : 0;
    return { direction: dir, offset };
  }

  const numMatch = strike.match(/^(\d+)$/);
  if (numMatch) {
    return { direction: "ATM", offset: 0 };
  }

  return { direction: "ATM", offset: 0 };
}

export function getATMStrike(
  spotPrice: number,
  strikeInterval: number,
): number {
  return Math.round(spotPrice / strikeInterval) * strikeInterval;
}

// 🔒 LOCKED BLOCK START — OSB getOTMStrike: OTM CE = atmStrike+steps, OTM PE = atmStrike-steps; ITM reversed; never swap CE/PE directions [OSB-1]
export function getOTMStrike(
  atmStrike: number,
  spec: StrikeSpec,
  strikeInterval: number,
  optionType: "CE" | "PE",
): number {
  if (spec.direction === "ATM") return atmStrike;

  const steps = spec.offset * strikeInterval;

  if (spec.direction === "OTM") {
    return optionType === "CE" ? atmStrike + steps : atmStrike - steps;
  }

  if (spec.direction === "ITM") {
    return optionType === "CE" ? atmStrike - steps : atmStrike + steps;
  }

  return atmStrike;
}
// 🔒 LOCKED BLOCK END

// ═══════════════════════════════════════════════════════════════════════════════
// EXPIRY CALCULATION
// ═══════════════════════════════════════════════════════════════════════════════
// 🔒 LOCKED BLOCK START — OSB getNextExpiry: post-15:30 IST roll (daysUntil += 7) and monthly resolution logic must stay in sync with getTargetExpiry [OSB-3]
export function getNextExpiry(
  expiryDay: string = "Thursday",
  expiryType: string = "weekly",
): Date {
  const dayMap: Record<string, number> = {
    Sunday: 0,
    Monday: 1,
    Tuesday: 2,
    Wednesday: 3,
    Thursday: 4,
    Friday: 5,
    Saturday: 6,
  };

  const targetDay = dayMap[expiryDay] ?? 4;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const currentDay = today.getDay();

  let daysUntil = targetDay - currentDay;
  if (daysUntil < 0) daysUntil += 7;
  if (daysUntil === 0) {
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    if (currentHour > 15 || (currentHour === 15 && currentMinute >= 30)) {
      daysUntil = 7;
    }
  }

  const expiry = new Date(today);
  expiry.setDate(today.getDate() + daysUntil);

  if (expiryType === "monthly") {
    const month = expiry.getMonth();
    while (expiry.getMonth() === month) {
      expiry.setDate(expiry.getDate() + 7);
    }
    expiry.setDate(expiry.getDate() - 7);
  }

  return expiry;
}
// 🔒 LOCKED BLOCK END

// ═══════════════════════════════════════════════════════════════════════════════
// EXPIRY DATE RESOLUTION
// Resolves the target expiry date from plan timeLogic settings:
//   expiryDay  — "Tuesday" / "Monday" / "Thursday" (from instrument_configs)
//   expiryType — "weekly" / "monthly"
//   weekOffset — 0 = current week, 1 = next week, 2 = week after
// Returns a Date representing the target expiry for cache key lookup.
// ═══════════════════════════════════════════════════════════════════════════════
// 🔒 LOCKED BLOCK START — OSB getTargetExpiry: post-15:30 IST roll (daysUntil += 7) and weekOffset * 7 calendar days must not be altered [OSB-2]
export function getTargetExpiry(
  expiryDay: string = "Thursday",
  expiryType: string = "weekly",
  weekOffset: number = 0,
): Date {
  const dayMap: Record<string, number> = {
    Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3,
    Thursday: 4, Friday: 5, Saturday: 6,
  };

  const targetDay = dayMap[expiryDay] ?? 4;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const currentDay = today.getDay();

  let daysUntil = targetDay - currentDay;
  if (daysUntil < 0) daysUntil += 7;
  if (daysUntil === 0) {
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    if (currentHour > 15 || (currentHour === 15 && currentMinute >= 30)) {
      daysUntil = 7;
    }
  }

  const expiry = new Date(today);
  if (expiryType === "monthly") {
    expiry.setDate(today.getDate() + daysUntil);
    const month = expiry.getMonth();
    while (expiry.getMonth() === month) {
      expiry.setDate(expiry.getDate() + 7);
    }
    expiry.setDate(expiry.getDate() - 7);
  } else {
    expiry.setDate(today.getDate() + daysUntil + (weekOffset * 7));
  }

  return expiry;
}
// 🔒 LOCKED BLOCK END

// ═══════════════════════════════════════════════════════════════════════════════
// SYMBOL BUILDING
// Assembles the full Kotak option trading symbol
// ═══════════════════════════════════════════════════════════════════════════════
export function buildKotakOptionSymbol(
  ticker: string,
  spotPrice: number,
  strikeSpecStr: string,
  optionType: "CE" | "PE",
  strikeInterval: number,
  expiryDay: string = "Thursday",
  expiryType: string = "weekly",
): string {
  const spec = parseStrikeSpec(strikeSpecStr);
  const atm = getATMStrike(spotPrice, strikeInterval);
  const strike = getOTMStrike(atm, spec, strikeInterval, optionType);
  const expiry = getNextExpiry(expiryDay, expiryType);

  const yy = String(expiry.getFullYear()).slice(-2);
  let symbol = "";

  // AUTO-DETECT MONTHLY EXPIRY: Is this the last occurrence of this weekday in the month?
  const nextWeek = new Date(expiry);
  nextWeek.setDate(expiry.getDate() + 7);
  const isMonthlyExpiry = nextWeek.getMonth() !== expiry.getMonth();

  if (expiryType === "monthly" || isMonthlyExpiry) {
    // Kotak Monthly Format: {TICKER}{YY}{MON}{STRIKE}{CE/PE}
    // Example: NIFTY26MAR20150PE
    const mon = MONTH_CODES[expiry.getMonth()];
    symbol = `${ticker}${yy}${mon}${strike}${optionType}`;
  } else {
    // Kotak Weekly Format: {TICKER}{YY}{M}{DD}{STRIKE}{CE/PE}
    // Example: NIFTY2632430450PE
    const singleCharMon = WEEKLY_MONTH_CODES[expiry.getMonth()];
    const ddPadded = String(expiry.getDate()).padStart(2, "0");
    symbol = `${ticker}${yy}${singleCharMon}${ddPadded}${strike}${optionType}`;
  }

  console.log(
    `${LOG_PREFIX} ${ticker} spot=${spotPrice} strike=${strike} isMonthlyWeek=${isMonthlyExpiry} → ${symbol}`,
  );

  return symbol;
}

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITY HELPERS
// ═══════════════════════════════════════════════════════════════════════════════
export function isOptionExchange(exchange: string): boolean {
  return ["NFO", "BFO", "MCX"].includes(exchange?.toUpperCase());
}

export function isStrikeSpec(strike: string): boolean {
  if (!strike) return false;
  return /^(OTM|ITM|ATM)\s*\d*$/i.test(strike);
}
