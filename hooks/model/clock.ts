// The farm's calendar and sky: local time, the eight sky steps, seasons, the moon, the day's weather and the rare
// events. Pure: `now` always comes in as an argument, and every roll is seeded by the farm and the local date, so
// every session and every redraw of a day agrees on what the sky does.

import { SHIPPED_BUILDS } from '../contracts'
import type { Hemisphere, Ms, Season, SkyStep, Weather } from '../contracts'
import type { Bank } from '../../types'
import { roll } from './rng'
import { BUILD_ORDER } from './layout'

const MIN = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

// ---- local time ----

type Ymd = { y: number; mo: number; d: number }
type Parts = Ymd & { h: number; mi: number }

const FORMATS = new Map<string, Intl.DateTimeFormat | null>()
const formatFor = (tz: string): Intl.DateTimeFormat | null => {
  let f = FORMATS.get(tz)
  if (f === undefined) {
    try {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
      })
    } catch {
      f = null
    }
    FORMATS.set(tz, f)
  }
  return f
}

/** The calendar parts of a moment: in a named time zone if one is given and known, else in the machine's own. */
const partsOf = (now: Ms, tz?: string): Parts => {
  const f = tz ? formatFor(tz) : null
  if (f) {
    const p: Record<string, number> = {}
    for (const x of f.formatToParts(now)) if (x.type !== 'literal') p[x.type] = Number(x.value)
    return { y: p.year ?? 1970, mo: p.month ?? 1, d: p.day ?? 1, h: (p.hour ?? 0) % 24, mi: p.minute ?? 0 }
  }
  const t = new Date(now)
  return { y: t.getFullYear(), mo: t.getMonth() + 1, d: t.getDate(), h: t.getHours(), mi: t.getMinutes() }
}

const pad = (n: number): string => String(n).padStart(2, '0')
const keyOf = ({ y, mo, d }: Ymd): string => `${y}-${pad(mo)}-${pad(d)}`
const parse = (date: string): Ymd => {
  const [y, mo, d] = date.split('-').map(Number)
  return { y: y ?? 1970, mo: mo ?? 1, d: d ?? 1 }
}
/** The calendar day `n` days after (or before) this one. */
const addDays = ({ y, mo, d }: Ymd, n: number): Ymd => {
  const t = new Date(Date.UTC(y, mo - 1, d + n))
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() }
}
const dayOfYearOf = ({ y, mo, d }: Ymd): number => Math.round((Date.UTC(y, mo - 1, d) - Date.UTC(y, 0, 1)) / DAY) + 1
/** 0 is Sunday. */
const weekdayOf = ({ y, mo, d }: Ymd): number => new Date(Date.UTC(y, mo - 1, d)).getUTCDay()
/** A local wall time on a day, `minutes` after its midnight (past 1,440 runs into the next day), as epoch ms. */
const wall = ({ y, mo, d }: Ymd, minutes: number): Ms => new Date(y, mo - 1, d, 0, minutes).getTime()

/** The local date (YYYY-MM-DD), hour (0–23), day of the year (1 on 1 January) and minutes since midnight. */
export const localTime = (now: Ms, tz?: string): { date: string; hour: number; dayOfYear: number; minutes: number } => {
  const p = partsOf(now, tz)
  return { date: keyOf(p), hour: p.h, dayOfYear: dayOfYearOf(p), minutes: p.h * 60 + p.mi }
}

// ---- sun and sky ----

/**
 * Sunrise and sunset in minutes after local midnight, for a cartoon latitude of 45°: about 05:00 and 21:00 at the
 * June solstice, 07:30 and 16:30 at the December one. The south has the same year half a year on.
 */
export const sunTimes = (dayOfYear: number, hemi: Hemisphere): { rise: number; set: number } => {
  const d = hemi === 'south' ? dayOfYear + 182 : dayOfYear
  const c = Math.cos((2 * Math.PI * (d - 172)) / 365)
  return { rise: Math.round((6.25 - 1.25 * c) * 60), set: Math.round((18.75 + 2.25 * c) * 60) }
}

/** The sky steps in the order a day runs through them, starting at the first light. */
export const SKY_STEPS: readonly SkyStep[] = ['predawn', 'sunrise', 'morning', 'day', 'golden', 'sunset', 'dusk', 'night']

/** Each step's wash over the world (under the UI); none in plain daylight. */
export const WASH: Readonly<Record<SkyStep, string | undefined>> = {
  night: 'rgba(20,28,70,.46)', predawn: 'rgba(60,60,120,.30)', sunrise: 'rgba(255,179,138,.14)', morning: undefined,
  day: undefined, golden: 'rgba(255,200,120,.10)', sunset: 'rgba(255,138,61,.16)', dusk: 'rgba(70,50,110,.30)',
}

/** When each step starts on a local day, in minutes after its midnight; night runs on into the next day. */
const stepMinutes = (day: Ymd, hemi: Hemisphere): number[] => {
  const { rise, set } = sunTimes(dayOfYearOf(day), hemi)
  return [rise - 60, rise, rise + 60, 11 * 60, set - 120, set - 30, set + 30, set + 75]
}
const stepStarts = (day: Ymd, hemi: Hemisphere): Ms[] => stepMinutes(day, hemi).map(m => wall(day, m))

/** The sky step at a moment, with when it began and when it ends. */
export const skySpan = (now: Ms, hemi: Hemisphere): { step: SkyStep; from: Ms; to: Ms } => {
  const today = partsOf(now)
  const starts = stepStarts(today, hemi)
  const first = starts[0] as Ms
  if (now < first) {
    const yesterday = stepStarts(addDays(today, -1), hemi)
    return { step: 'night', from: yesterday[7] as Ms, to: first }
  }
  let i = 0
  while (i + 1 < starts.length && (starts[i + 1] as Ms) <= now) i++
  const to = i + 1 < starts.length ? (starts[i + 1] as Ms) : (stepStarts(addDays(today, 1), hemi)[0] as Ms)
  return { step: SKY_STEPS[i] as SkyStep, from: starts[i] as Ms, to }
}

/** The sky now: its step, the step's wash, and how far the 8 s cross-fade from the last step has gone (0 to 1). */
export const sky = (now: Ms, hemi: Hemisphere): { step: SkyStep; wash?: string; fade: number } => {
  const s = skySpan(now, hemi)
  const fade = Math.min(1, Math.max(0, (now - s.from) / 8000))
  const wash = WASH[s.step]
  return wash ? { step: s.step, wash, fade } : { step: s.step, fade }
}

/** Light enough to fish, fly and bask: sunrise to the end of sunset. */
export const isDaylight = (step: SkyStep): boolean =>
  step === 'sunrise' || step === 'morning' || step === 'day' || step === 'golden' || step === 'sunset'
/** Bedtime for idle crabs and the hens. */
export const isDark = (step: SkyStep): boolean => step === 'dusk' || step === 'night'

// ---- seasons, hemisphere, moon ----

const NORTH_SEASONS: readonly Season[] = [
  'winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter',
]
const seasonOfMonth = (mo: number, hemi: Hemisphere): Season =>
  NORTH_SEASONS[((mo - 1 + (hemi === 'south' ? 6 : 0)) % 12 + 12) % 12] as Season

/** The meteorological season: spring is March to May in the north and September to November in the south. */
export const seasonOf = (now: Ms, hemi: Hemisphere): Season => seasonOfMonth(partsOf(now).mo, hemi)

const SOUTH = /^(Australia\/.+|Pacific\/(Auckland|Chatham)|America\/(Santiago|Argentina\/.+|Buenos_Aires|Montevideo|Sao_Paulo)|Africa\/(Johannesburg|Maputo)|Antarctica\/.+)$/

/** The farm's hemisphere: the option when set, else guessed from the time zone (north unless it is a southern one). */
export const hemisphereOf = (tz: string | undefined, opt: 'auto' | 'north' | 'south'): Hemisphere =>
  opt !== 'auto' ? opt : tz && SOUTH.test(tz) ? 'south' : 'north'

const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14)
const SYNODIC = 29.530589

/** The moon's age as a fraction of its month: 0 new, 0.5 full. */
export const moonPhase = (now: Ms): number => {
  const p = ((now - NEW_MOON) / DAY / SYNODIC) % 1
  return p < 0 ? p + 1 : p
}

// ---- weather ----

type Kind = 'snow' | 'rain' | 'fog' | 'windy' | 'cloudy'
/** Rain and snow are rolled first at their rates; fog, wind and cloud then share the days left, in that order. */
const WEATHER_ORDER: readonly Kind[] = ['snow', 'rain', 'fog', 'windy', 'cloudy']
export const WEATHER_RATES: Readonly<Record<Season, Partial<Record<Kind, number>>>> = {
  spring: { rain: 0.2, cloudy: 0.35, fog: 0.05, windy: 0.1 },
  summer: { rain: 0.12, cloudy: 0.3, windy: 0.05 },
  autumn: { rain: 0.25, cloudy: 0.4, fog: 0.2, windy: 0.5 },
  winter: { rain: 0.15, snow: 0.25, cloudy: 0.4, fog: 0.1, windy: 0.1 },
}

/**
 * The day's one block of weather, or null on a clear day: 1 to 3 hours on the quarter hour between 08:00 and
 * 20:00, never all day. Fog lifts at 10:00.
 */
export const weatherOf = (seed: number, date: string, season: Season): Weather => {
  const rates = WEATHER_RATES[season]
  const kind = WEATHER_ORDER.find(k => roll(seed, 'wx', date, k) < (rates[k] ?? 0))
  if (!kind) return null
  const day = parse(date)
  if (kind === 'fog') return { kind, from: wall(day, 8 * 60), to: wall(day, 10 * 60) }
  const quarters = 4 + Math.floor(roll(seed, 'wx-len', date) * 9)            // 4 to 12 quarter hours
  const start = Math.floor(roll(seed, 'wx-at', date) * (48 - quarters + 1))  // the block ends by 20:00
  return { kind, from: wall(day, 8 * 60 + 15 * start), to: wall(day, 8 * 60 + 15 * (start + quarters)) }
}

/** The day's weather block for a moment's local date and season. */
export const dayWeather = (seed: number, now: Ms, hemi: Hemisphere): Weather => {
  const p = partsOf(now)
  return weatherOf(seed, keyOf(p), seasonOfMonth(p.mo, hemi))
}

/** The weather now: the day's block while it lasts, else null. */
export const weatherAt = (seed: number, now: Ms, hemi: Hemisphere): Weather => {
  const w = dayWeather(seed, now, hemi)
  return w && w.from <= now && now < w.to ? w : null
}

/** Rain or snow falling: idle crabs take shelter, hens stay in, bees and butterflies stay home. */
export const isWet = (w: Weather, at?: Ms): boolean =>
  !!w && (w.kind === 'rain' || w.kind === 'snow') && (at === undefined || (w.from <= at && at < w.to))

// ---- rare events ----

/** An event's time on the farm: it fades in at `from` and out at `to`. */
export type EventWindow = { id: string; from: Ms; to: Ms }

/** Who calls on a weekday, Sunday first: merchant Monday and Thursday, pigeon Wednesday, neighbour Friday. */
const REGULARS: readonly (string | undefined)[] = [undefined, 'merchant', undefined, 'pigeon', 'merchant', 'neighbour', undefined]
/** Nights of the year's big meteor showers (the evening they start), as month and day. */
const SHOWERS: readonly (readonly [number, number])[] = [[1, 3], [8, 12], [12, 13]]

const isClearDay = (w: Weather): boolean => !w || w.kind === 'windy'
const sameDay = (a: Ymd, b: Ymd): boolean => a.y === b.y && a.mo === b.mo && a.d === b.d
const md = (day: Ymd, mo: number, d: number): boolean => day.mo === mo && day.d === d

/** The first day of the meteorological winter that holds this day, and its last day, or undefined outside winter. */
const winterOf = (day: Ymd, hemi: Hemisphere): { start: Ymd; end: Ymd } | undefined => {
  if (seasonOfMonth(day.mo, hemi) !== 'winter') return undefined
  if (hemi === 'south') return { start: { y: day.y, mo: 6, d: 1 }, end: { y: day.y, mo: 8, d: 31 } }
  const y = day.mo === 12 ? day.y : day.y - 1
  return { start: { y, mo: 12, d: 1 }, end: addDays({ y: y + 1, mo: 3, d: 1 }, -1) }
}

const FIRST_SNOW = new Map<string, Ymd | null>()
/** The first day of a winter with snow, if it snows at all that winter. */
const firstSnow = (seed: number, start: Ymd, end: Ymd): Ymd | undefined => {
  const k = `${seed}|${keyOf(start)}`
  let hit = FIRST_SNOW.get(k)
  if (hit === undefined) {
    hit = null
    for (let day = start; !sameDay(day, addDays(end, 1)); day = addDays(day, 1)) {
      if (weatherOf(seed, keyOf(day), 'winter')?.kind === 'snow') { hit = day; break }
    }
    if (FIRST_SNOW.size > 64) FIRST_SNOW.clear()
    FIRST_SNOW.set(k, hit)
  }
  return hit ?? undefined
}

/**
 * Every event that starts on a local date (night events run on past midnight), seeded by the date so every session
 * agrees. Without `bank` the farm's own dates (birthday, day 100, the last build's fireworks) are left out.
 */
export const eventWindows = (seed: number, date: string, hemi: Hemisphere = 'north', bank?: Bank): EventWindow[] => {
  const day = parse(date)
  const next = addDays(day, 1)
  const out: EventWindow[] = []
  const add = (id: string, from: Ms, to: Ms): void => { if (to > from) out.push({ id, from, to }) }
  const season = seasonOfMonth(day.mo, hemi)
  const wx = weatherOf(seed, date, season)
  // Minutes after midnight that the sunrise, sunset and night steps begin.
  const steps = stepMinutes(day, hemi)
  const sunrise = steps[1] as number, sunset = steps[5] as number, night = steps[7] as number
  const nightFrom = wall(day, night)
  const nightTo = wall(next, (stepMinutes(next, hemi)[0] as number))
  const allDay = (id: string): void => add(id, wall(day, 0), wall(day, 1440))
  const isSouth = hemi === 'south'

  // The visitor of the day, weekdays only, for 1 to 2 hours between 10:00 and 16:00.
  const dow = weekdayOf(day)
  if (dow >= 1 && dow <= 5) {
    const r = roll(seed, 'visitor', date)
    const who = r < 0.05 ? 'balloon' : r < 0.15 ? 'musician' : REGULARS[dow]
    if (who) {
      const quarters = 4 + Math.floor(roll(seed, 'visitor-len', date) * 5)
      const start = Math.floor(roll(seed, 'visitor-at', date) * (24 - quarters + 1))
      add(`visitor:${who}`, wall(day, 600 + 15 * start), wall(day, 600 + 15 * (start + quarters)))
    }
  }

  // A rainbow after daytime rain, half the time, for 45 minutes; one in seven of those is double.
  if (wx?.kind === 'rain' && wx.to <= wall(day, sunset) && roll(seed, 'rainbow', date) < 0.5) {
    add(roll(seed, 'rainbow2', date) < 0.15 ? 'rainbow:double' : 'rainbow', wx.to, wx.to + 45 * MIN)
  }

  // Night visitors and night skies.
  if (roll(seed, 'owl', date) < 0.2) add('owl', nightFrom, Math.min(nightTo, nightFrom + 3 * HOUR))
  if (roll(seed, 'fox', date) < 1 / 8) {
    const at = 22 * 60 + 15 * Math.floor(roll(seed, 'fox-at', date) * 23)    // 22:00 to 03:30
    add('fox', wall(day, at), wall(day, at + 15 + 5 * Math.floor(roll(seed, 'fox-len', date) * 3)))
  }
  const clear = isClearDay(wx)
  if (SHOWERS.some(([m, d]) => md(day, m, d)) || (clear && roll(seed, 'meteors', date) < 0.05)) {
    add('meteors', wall(day, 21 * 60), wall(day, 27 * 60))
  }
  if (season === 'winter' && clear && roll(seed, 'aurora', date) < 1 / 30) {
    add('aurora', nightFrom + HOUR, Math.min(nightTo, nightFrom + 3 * HOUR))
  }
  if (roll(seed, 'comet', date) < 1 / 365) add('comet', nightFrom, nightTo)
  if (roll(seed, 'stag', date) < 1 / 120) add('stag', wall(day, sunrise), wall(day, sunrise + 20))
  const summer = isSouth ? [11, 12, 1, 2, 3] : [5, 6, 7, 8, 9]
  if (summer.includes(day.mo)) add('fireflies', nightFrom, nightTo)

  // Geese fly south in the autumn, one day in five, for a few minutes in the day.
  const geese = isSouth ? [4, 5] : [10, 11]
  if (geese.includes(day.mo) && roll(seed, 'geese', date) < 0.2) {
    const at = 9 * 60 + 15 * Math.floor(roll(seed, 'geese-at', date) * 29)
    add('geese', wall(day, at), wall(day, at + 4))
  }

  // The harvest moon: the full moon nearest the autumn equinox, on the night it is fullest at midnight.
  const equinox: Ymd = isSouth ? { y: day.y, mo: 3, d: 20 } : { y: day.y, mo: 9, d: 22 }
  const fromEquinox = Math.round((Date.UTC(day.y, day.mo - 1, day.d) - Date.UTC(equinox.y, equinox.mo - 1, equinox.d)) / DAY)
  if (Math.abs(fromEquinox) <= 15 && Math.abs(moonPhase(wall(next, 0)) - 0.5) <= 0.5 / SYNODIC) {
    add('harvestMoon', wall(day, sunset), nightTo)
  }

  // Festivals. The equinox and solstice ones follow the hemisphere; Lantern Night and Winter Lights keep the calendar.
  if (isSouth ? md(day, 9, 22) : md(day, 3, 20)) allDay('blossomDay')
  if (isSouth ? md(day, 12, 21) : md(day, 6, 21)) add('midsummer', wall(day, sunset), wall(day, 1500))
  const fair = isSouth ? { mo: 3, d: 20 } : { mo: 9, d: 22 }
  if (day.mo === fair.mo && day.d >= fair.d && day.d < fair.d + 7) allDay('harvestFair')
  if (md(day, 10, 31)) add('lanternNight', wall(day, sunset), wall(day, 1440))
  if ((day.mo === 12 && day.d >= 21) || md(day, 1, 1)) allDay('winterLights')
  if (md(day, 1, 1)) add('newYear', wall(day, 0), wall(day, 10))

  // The first snow of a winter brings a snowman that stands until the winter ends.
  const winter = winterOf(day, hemi)
  const first = winter && firstSnow(seed, winter.start, winter.end)
  if (first && Date.UTC(first.y, first.mo - 1, first.d) <= Date.UTC(day.y, day.mo - 1, day.d)) {
    const snow = sameDay(first, day) ? weatherOf(seed, date, 'winter') : null
    add('snowman', snow ? snow.to : wall(day, 0), wall(day, 1440))
  }

  // The farm's own days.
  if (bank) {
    const born = partsOf(bank.bornAt)
    const isLeap = (y: number): boolean => new Date(Date.UTC(y, 1, 29)).getUTCMonth() === 1
    const bornMd = born.mo === 2 && born.d === 29 && !isLeap(day.y) ? { mo: 2, d: 28 } : { mo: born.mo, d: born.d }
    if (day.y > born.y && md(day, bornMd.mo, bornMd.d)) allDay('birthday')
    if (sameDay(addDays(born, 99), day)) allDay('day100')
    // The last build of the version: a "tonight" pennant from the moment it stands, fireworks through that dusk.
    const last = BUILD_ORDER[SHIPPED_BUILDS - 1]
    const builtAt = last ? bank.builtAt[last] : undefined
    if (builtAt !== undefined) {
      const b = partsOf(builtAt)
      const show = builtAt < wall(b, stepMinutes(b, hemi)[6] as number) ? b : addDays(b, 1)
      const [, , , , , , showDusk, showNight] = stepMinutes(show, hemi) as number[]
      if (sameDay(b, day)) add('pennant', builtAt, wall(show, showNight ?? 1440))
      if (sameDay(show, day)) add('fireworks', wall(day, showDusk ?? 1200), wall(day, showNight ?? 1245))
    }
  }
  return out
}

/** The events on the farm at a moment: those that began today, and last night's that run on past midnight. */
export const eventsAt = (seed: number, now: Ms, bank: Bank, hemi: Hemisphere = 'north'): string[] => {
  const today = partsOf(now)
  const ids = new Set<string>()
  for (const day of [addDays(today, -1), today]) {
    for (const w of eventWindows(seed, keyOf(day), hemi, bank)) if (w.from <= now && now < w.to) ids.add(w.id)
  }
  return [...ids].sort()
}

/**
 * The next moment the sky, the weather, an event or the hour changes, after `now`: the scene's clock key holds
 * until then. Hourly at the latest, since the cat's sun patch and the hens' day move by the hour. The farm's own
 * dates (birthday, fireworks) start and end on these same boundaries: midnight, dusk and night.
 */
export const nextChange = (seed: number, now: Ms, hemi: Hemisphere): Ms => {
  const today = partsOf(now)
  const tomorrow = addDays(today, 1)
  const times: Ms[] = [
    ...stepStarts(today, hemi), ...stepStarts(tomorrow, hemi),
    wall(today, (today.h + 1) * 60), wall(today, 13 * 60 + 30), wall(today, 1440),
  ]
  const wx = dayWeather(seed, now, hemi)
  if (wx) times.push(wx.from, wx.to)
  for (const day of [addDays(today, -1), today, tomorrow]) {
    for (const w of eventWindows(seed, keyOf(day), hemi)) times.push(w.from, w.to)
  }
  return times.reduce((best, t) => (t > now && t < best ? t : best), now + HOUR)
}
