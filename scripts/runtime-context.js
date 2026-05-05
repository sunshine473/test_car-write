#!/usr/bin/env node

const DEFAULT_RUN_TIMEZONE = 'Asia/Shanghai';

function getDatePartMap(date, options) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: getRunTimeZone(),
    ...options
  });

  return Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value])
  );
}

export function getRunTimeZone() {
  return process.env.RUN_TIMEZONE || process.env.TZ || DEFAULT_RUN_TIMEZONE;
}

export function getRunDate(date = new Date()) {
  const { year, month, day } = getDatePartMap(date, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  return `${year}-${month}-${day}`;
}

export function getRunDateWithOffset(days, baseDate = new Date()) {
  return getRunDate(new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000));
}

export function getRunYear(date = new Date()) {
  const { year } = getDatePartMap(date, { year: 'numeric' });
  return Number(year);
}
