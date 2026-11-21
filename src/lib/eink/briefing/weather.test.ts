// almanac ALMNC-47：天氣來源（Open-Meteo 地理編碼＋預報；早午晚夜四段＋最高最低；API 失敗不丟錯）。不連外網。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearGeocodingCache, fetchWeather, forecastUrl, geocodingUrl, parseForecast, parseGeocoding, type FetchJson } from './weather'

const DATE = '2026-11-21'

function hourly(date: string) {
  const time: string[] = []
  const temperature_2m: number[] = []
  const precipitation_probability: number[] = []
  const weather_code: number[] = []
  for (let hour = 0; hour < 24; hour++) {
    time.push(`${date}T${String(hour).padStart(2, '0')}:00`)
    temperature_2m.push(10 + hour / 2) // 10 → 21.5
    precipitation_probability.push(hour === 15 ? 80 : hour === 20 ? 40 : 10)
    weather_code.push(hour === 15 ? 61 : hour === 20 ? 3 : 1)
  }
  return { time, temperature_2m, precipitation_probability, weather_code }
}

const FORECAST = {
  hourly: {
    ...hourly(DATE),
    // 隔天的資料不算進今天
    time: [...hourly(DATE).time, '2026-11-22T00:00'],
    temperature_2m: [...hourly(DATE).temperature_2m, 99],
    precipitation_probability: [...hourly(DATE).precipitation_probability, 100],
    weather_code: [...hourly(DATE).weather_code, 95],
  },
  daily: {
    time: [DATE],
    temperature_2m_max: [22.4],
    temperature_2m_min: [9.6],
    precipitation_probability_max: [80],
    weather_code: [61],
  },
}

const GEO = { results: [{ name: '臺北市', latitude: 25.05, longitude: 121.53 }] }

function fakeFetch(handler: (url: string) => { ok?: boolean, status?: number, body?: unknown } | Error): FetchJson & ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string) => {
    const result = handler(url)
    if (result instanceof Error) throw result
    return { ok: result.ok ?? true, status: result.status ?? 200, json: async () => result.body }
  }) as unknown as FetchJson & ReturnType<typeof vi.fn>
}

beforeEach(() => clearGeocodingCache())

describe('parseForecast', () => {
  it('早午晚夜四段：溫度平均、降雨機率取最高、天氣代碼取最嚴重；最高最低用 daily', () => {
    const weather = parseForecast(FORECAST, DATE, '臺北市')
    expect(weather).toEqual({
      location: '臺北市',
      parts: [
        { part: 'morning', temperature: 14, precipitationProbability: 10, weatherCode: 1 }, // 6–11 時：13～15.5，平均 14.25
        { part: 'noon', temperature: 17, precipitationProbability: 80, weatherCode: 61 }, // 12–17 時：16～18.5
        { part: 'evening', temperature: 20, precipitationProbability: 40, weatherCode: 3 }, // 18–21 時：19～20.5
        { part: 'night', temperature: 21, precipitationProbability: 10, weatherCode: 1 }, // 22–23 時：21～21.5
      ],
      high: 22,
      low: 10,
      precipitationProbability: 80,
      weatherCode: 61,
    })
  })

  it('沒有 daily 時用當天逐時資料算最高最低', () => {
    const weather = parseForecast({ hourly: hourly(DATE) }, DATE, 'X')
    expect(weather).toMatchObject({ high: 22, low: 10, precipitationProbability: 80, weatherCode: 61 })
  })

  it('當天沒有任何逐時資料回 null', () => {
    expect(parseForecast({ hourly: hourly('2026-11-20') }, DATE, 'X')).toBeNull()
    expect(parseForecast(null, DATE, 'X')).toBeNull()
  })
})

describe('parseGeocoding／網址', () => {
  it('取第一個結果；沒有結果回 null', () => {
    expect(parseGeocoding(GEO)).toEqual({ name: '臺北市', latitude: 25.05, longitude: 121.53 })
    expect(parseGeocoding({})).toBeNull()
    expect(parseGeocoding({ results: [] })).toBeNull()
  })

  it('預報只抓那一天、時區跟著地點', () => {
    const url = new URL(forecastUrl({ name: 'X', latitude: 1, longitude: 2 }, DATE))
    expect(url.searchParams.get('start_date')).toBe(DATE)
    expect(url.searchParams.get('end_date')).toBe(DATE)
    expect(url.searchParams.get('timezone')).toBe('auto')
    expect(new URL(geocodingUrl('臺北')).searchParams.get('name')).toBe('臺北')
  })
})

describe('fetchWeather（天氣 adapter）', () => {
  it('地理編碼後抓預報', async () => {
    const fetch = fakeFetch(url => (url.includes('geocoding') ? { body: GEO } : { body: FORECAST }))
    const result = await fetchWeather('臺北', DATE, fetch)
    expect(result.status).toBe('ok')
    expect(result.status === 'ok' && result.data.parts).toHaveLength(4)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('同一個城市只查一次座標', async () => {
    const fetch = fakeFetch(url => (url.includes('geocoding') ? { body: GEO } : { body: FORECAST }))
    await fetchWeather('臺北', DATE, fetch)
    await fetchWeather('臺北', DATE, fetch)
    expect(fetch.mock.calls.filter(([url]) => String(url).includes('geocoding'))).toHaveLength(1)
  })

  it('天氣 API 失敗（HTTP 500）回 error，不丟錯', async () => {
    const fetch = fakeFetch(url => (url.includes('geocoding') ? { body: GEO } : { ok: false, status: 500 }))
    await expect(fetchWeather('臺北', DATE, fetch)).resolves.toEqual({ status: 'error', message: 'HTTP 500' })
  })

  it('連不上（fetch 丟錯）回 error', async () => {
    const fetch = fakeFetch(() => new Error('network down'))
    await expect(fetchWeather('臺北', DATE, fetch)).resolves.toEqual({ status: 'error', message: 'network down' })
  })

  it('找不到城市回 error；沒填地點回 empty、不連網', async () => {
    const fetch = fakeFetch(() => ({ body: { results: [] } }))
    await expect(fetchWeather('不存在市', DATE, fetch)).resolves.toMatchObject({ status: 'error' })
    const idle = fakeFetch(() => ({ body: {} }))
    await expect(fetchWeather('  ', DATE, idle)).resolves.toEqual({ status: 'empty' })
    expect(idle).not.toHaveBeenCalled()
  })
})
