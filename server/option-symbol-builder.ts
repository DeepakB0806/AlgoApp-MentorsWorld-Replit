const LOG_PREFIX = "[SYMBOL-BUILDER]";

const MONTH_CODES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

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

export function getATMStrike(spotPrice: number, strikeInterval: number): number {
  return Math.round(spotPrice / strikeInterval) * strikeInterval;
}

export function getOTMStrike(
  atmStrike: number,
  spec: StrikeSpec,
  strikeInterval: number,
  optionType: "CE" | "PE"
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

export function getNextExpiry(expiryDay: string = "Thursday", expiryType: string = "weekly"): Date {
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

export function buildKotakOptionSymbol(
  ticker: string,
  spotPrice: number,
  strikeSpecStr: string,
  optionType: "CE" | "PE",
  strikeInterval: number,
  expiryDay: string = "Thursday",
  expiryType: string = "weekly"
): string {
  const spec = parseStrikeSpec(strikeSpecStr);
  const atm = getATMStrike(spotPrice, strikeInterval);
  const strike = getOTMStrike(atm, spec, strikeInterval, optionType);
  const expiry = getNextExpiry(expiryDay, expiryType);

  const dd = String(expiry.getDate()).padStart(2, "0");
  const mon = MONTH_CODES[expiry.getMonth()];
  const yy = String(expiry.getFullYear()).slice(-2);

  const symbol = `${ticker}${dd}${mon}${yy}${strike}${optionType}`;

  console.log(`${LOG_PREFIX} ${ticker} spot=${spotPrice} ATM=${atm} ${spec.direction}${spec.offset} ${optionType} → strike=${strike} expiry=${dd}${mon}${yy} → ${symbol}`);

  return symbol;
}

export function isOptionExchange(exchange: string): boolean {
  return ["NFO", "BFO", "MCX"].includes(exchange?.toUpperCase());
}

export function isStrikeSpec(strike: string): boolean {
  if (!strike) return false;
  return /^(OTM|ITM|ATM)\s*\d*$/i.test(strike);
}
