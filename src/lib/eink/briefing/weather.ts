// Fork（almanac ALMNC-47）：天氣來源。Open-Meteo（免金鑰）：先用地理編碼把設定的「天氣地點」換成座標，再抓當天預報。
// 不跟 Mac 定位走（計畫 v2）。網路走 Tauri http 外掛（跟 web-capture 一樣）；測試換成假的 fetch，不連外網。
// 抓不到（沒填地點、找不到城市、API 失敗、格式不對）一律回非 ok 的 SourceResult，組裝時顯示「天氣暫無資料」，不擋產生。
import type { DayPart, SourceResult, WeatherData, WeatherPart } from './types'

export const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search'
export const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
const TIMEOUT_MS = 10_000

/**
 * 早午晚夜四段的小時範圍（地點當地時間，[起, 迄)）。
 * 夜只算到當天 24 點：簡報是「今天」的天氣，不跨到隔天。
 */
export const DAY_PART_HOURS: Record<DayPart, [number, number]> = {
  morning: [6, 12],
  noon: [12, 18],
  evening: [18, 22],
  night: [22, 24],
}
const DAY_PARTS: DayPart[] = ['morning', 'noon', 'evening', 'night']

export interface GeoPlace {
  name: string
  latitude: number
  longitude: number
}

/** fetch 的最小介面：Tauri http 外掛與測試的假實作都符合。 */
export type FetchJson = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean, status: number, json: () => Promise<unknown> }>

function isNum(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function geocodingUrl(city: string, language = 'zh'): string {
  const params = new URLSearchParams({ name: city, count: '1', language, format: 'json' })
  return `${GEOCODING_URL}?${params.toString()}`
}

export function forecastUrl(place: GeoPlace, date: string): string {
  const params = new URLSearchParams({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    hourly: 'temperature_2m,precipitation_probability,weather_code',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code',
    timezone: 'auto',
    start_date: date,
    end_date: date,
  })
  return `${FORECAST_URL}?${params.toString()}`
}

/** 地理編碼回應 → 第一個結果；沒有結果回 null。 */
export function parseGeocoding(body: unknown): GeoPlace | null {
  const results = (body as { results?: unknown } | null)?.results
  if (!Array.isArray(results) || results.length === 0) return null
  const first = results[0] as Record<string, unknown>
  if (!isNum(first?.latitude) || !isNum(first?.longitude)) return null
  return { name: typeof first.name === 'string' ? first.name : '', latitude: first.latitude, longitude: first.longitude }
}

/**
 * 預報回應 → 四段天氣＋最高最低。純函式。
 * hourly.time 是地點當地時間的「YYYY-MM-DDTHH:mm」（timezone=auto），直接取字串裡的日期與小時，不受這台 Mac 的時區影響。
 * 每段：溫度取平均（四捨五入）、降雨機率取最高、天氣代碼取最嚴重（數字最大）。某段完全沒資料就不放那段。
 * 最高最低優先用 daily，缺的話用當天的逐時資料算。當天一筆逐時資料都沒有回 null。
 */
export function parseForecast(body: unknown, date: string, location: string): WeatherData | null {
  const value = (body ?? {}) as { hourly?: Record<string, unknown>, daily?: Record<string, unknown> }
  const hourly = value.hourly ?? {}
  const times = Array.isArray(hourly.time) ? hourly.time : []
  const temps = Array.isArray(hourly.temperature_2m) ? hourly.temperature_2m : []
  const rain = Array.isArray(hourly.precipitation_probability) ? hourly.precipitation_probability : []
  const codes = Array.isArray(hourly.weather_code) ? hourly.weather_code : []

  const rows: Array<{ hour: number, temp: number, rain: number, code: number }> = []
  times.forEach((time, index) => {
    if (typeof time !== 'string' || time.slice(0, 10) !== date) return
    const hour = Number(time.slice(11, 13))
    const temp = temps[index]
    if (!Number.isInteger(hour) || !isNum(temp)) return
    const r = rain[index]
    const c = codes[index]
    rows.push({ hour, temp, rain: isNum(r) ? r : 0, code: isNum(c) ? c : 0 })
  })
  if (rows.length === 0) return null

  const parts: WeatherPart[] = []
  for (const part of DAY_PARTS) {
    const [from, to] = DAY_PART_HOURS[part]
    const inPart = rows.filter(row => row.hour >= from && row.hour < to)
    if (inPart.length === 0) continue
    parts.push({
      part,
      temperature: Math.round(inPart.reduce((sum, row) => sum + row.temp, 0) / inPart.length),
      precipitationProbability: Math.round(Math.max(...inPart.map(row => row.rain))),
      weatherCode: Math.max(...inPart.map(row => row.code)),
    })
  }

  const daily = value.daily ?? {}
  const dailyIndex = Array.isArray(daily.time) ? daily.time.indexOf(date) : -1
  const pick = (key: string): number | null => {
    const list = daily[key]
    if (dailyIndex < 0 || !Array.isArray(list)) return null
    return isNum(list[dailyIndex]) ? list[dailyIndex] : null
  }
  const high = pick('temperature_2m_max') ?? Math.max(...rows.map(row => row.temp))
  const low = pick('temperature_2m_min') ?? Math.min(...rows.map(row => row.temp))
  const rainMax = pick('precipitation_probability_max') ?? Math.max(...rows.map(row => row.rain))
  const code = pick('weather_code') ?? Math.max(...rows.map(row => row.code))

  return {
    location,
    parts,
    high: Math.round(high),
    low: Math.round(low),
    precipitationProbability: Math.round(rainMax),
    weatherCode: code,
  }
}

async function getJson(fetchJson: FetchJson, url: string): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetchJson(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

async function tauriFetchJson(url: string, init?: { signal?: AbortSignal }) {
  const { fetch } = await import('@tauri-apps/plugin-http')
  return fetch(url, { method: 'GET', signal: init?.signal, headers: { Accept: 'application/json' } })
}

/** 同一個城市名稱只查一次座標（app 執行期間）。 */
const geoCache = new Map<string, GeoPlace>()

export function clearGeocodingCache(): void {
  geoCache.clear()
}

/**
 * 抓 date（YYYY-MM-DD）的天氣。沒填地點回 empty；找不到城市、連不上、格式不對回 error。
 * 不丟錯。
 */
export async function fetchWeather(city: string, date: string, fetchJson: FetchJson = tauriFetchJson): Promise<SourceResult<WeatherData>> {
  const name = city.trim()
  if (!name) return { status: 'empty' }
  try {
    let place = geoCache.get(name)
    if (!place) {
      const found = parseGeocoding(await getJson(fetchJson, geocodingUrl(name)))
      if (!found) return { status: 'error', message: 'city not found' }
      place = found
      geoCache.set(name, place)
    }
    const weather = parseForecast(await getJson(fetchJson, forecastUrl(place, date)), date, place.name || name)
    return weather ? { status: 'ok', data: weather } : { status: 'error', message: 'no forecast for date' }
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : 'unknown error' }
  }
}
