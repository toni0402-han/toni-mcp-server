import { createMcpHandler } from 'mcp-handler'
import { z } from 'zod'
import { InferenceClient } from '@huggingface/inference'

const SERVER_NAME = 'toni-mcp-server'
const SERVER_VERSION = '1.0.0'
const SERVER_START_TIME = new Date()

const REGISTERED_TOOLS = [
    {
        name: 'greet',
        description: '이름과 언어를 입력하면 인사말을 반환합니다.',
        params: 'name: string, language?: "ko" | "en"'
    },
    {
        name: 'calc',
        description: '두 숫자와 연산자를 입력하면 사칙연산 결과를 반환합니다.',
        params: 'a: number, b: number, operator: "+" | "-" | "*" | "/"'
    },
    {
        name: 'now_time',
        description: '나라 이름을 입력하면 해당 나라의 현재 시간을 반환합니다.',
        params: 'country: string'
    },
    {
        name: 'geocode',
        description: '도시 이름이나 주소를 입력하면 위도/경도 좌표를 반환합니다.',
        params: 'query: string, limit?: number'
    },
    {
        name: 'get-weather',
        description: '위도, 경도, 예보 기간을 입력하면 현재 날씨와 예보를 반환합니다.',
        params: 'latitude: number, longitude: number, forecast_days?: number'
    },
    {
        name: 'generate-image',
        description: '텍스트 프롬프트로 FLUX.1-schnell 모델을 이용해 이미지를 생성합니다.',
        params: 'prompt: string, num_inference_steps?: number'
    }
]

const WMO_CODES: Record<number, string> = {
    0: '맑음 ☀️',
    1: '대체로 맑음 🌤️',
    2: '부분적으로 흐림 ⛅',
    3: '흐림 ☁️',
    45: '안개 🌫️',
    48: '결빙 안개 🌫️',
    51: '이슬비 (약함) 🌦️',
    53: '이슬비 (보통) 🌦️',
    55: '이슬비 (강함) 🌦️',
    56: '어는 이슬비 (약함) 🌧️',
    57: '어는 이슬비 (강함) 🌧️',
    61: '비 (약함) 🌧️',
    63: '비 (보통) 🌧️',
    65: '비 (강함) 🌧️',
    66: '어는 비 (약함) 🌨️',
    67: '어는 비 (강함) 🌨️',
    71: '눈 (약함) 🌨️',
    73: '눈 (보통) 🌨️',
    75: '눈 (강함) ❄️',
    77: '눈보라 ❄️',
    80: '소나기 (약함) 🌦️',
    81: '소나기 (보통) 🌧️',
    82: '소나기 (강함) ⛈️',
    85: '눈 소나기 (약함) 🌨️',
    86: '눈 소나기 (강함) ❄️',
    95: '뇌우 ⛈️',
    96: '우박 동반 뇌우 (약함) ⛈️',
    99: '우박 동반 뇌우 (강함) ⛈️'
}

function getWeatherDesc(code: number): string {
    return WMO_CODES[code] ?? `날씨 코드 ${code}`
}

function windDirection(deg: number): string {
    const dirs = ['북', '북동', '동', '남동', '남', '남서', '서', '북서']
    return dirs[Math.round(deg / 45) % 8]
}

const handler = createMcpHandler(
    (server) => {
        server.registerTool(
            'greet',
            {
                description: '이름과 언어를 입력하면 인사말을 반환합니다.',
                inputSchema: {
                    name: z.string().describe('인사할 사람의 이름'),
                    language: z
                        .enum(['ko', 'en'])
                        .optional()
                        .default('en')
                        .describe('인사 언어 (기본값: en)')
                }
            },
            async ({ name, language }) => {
                const greeting =
                    language === 'ko'
                        ? `안녕하세요, ${name}님!`
                        : `Hey there, ${name}! 👋 Nice to meet you!`
                return {
                    content: [{ type: 'text' as const, text: greeting }]
                }
            }
        )

        server.registerTool(
            'calc',
            {
                description: '두 숫자와 연산자를 입력하면 사칙연산 결과를 반환합니다.',
                inputSchema: {
                    a: z.number().describe('첫 번째 숫자'),
                    b: z.number().describe('두 번째 숫자'),
                    operator: z
                        .enum(['+', '-', '*', '/'])
                        .describe('연산자 (+, -, *, /)')
                }
            },
            async ({ a, b, operator }) => {
                let result: number
                if (operator === '+') result = a + b
                else if (operator === '-') result = a - b
                else if (operator === '*') result = a * b
                else {
                    if (b === 0) {
                        return {
                            content: [
                                {
                                    type: 'text' as const,
                                    text: '오류: 0으로 나눌 수 없습니다.'
                                }
                            ]
                        }
                    }
                    result = a / b
                }
                return {
                    content: [{ type: 'text' as const, text: `${a} ${operator} ${b} = ${result}` }]
                }
            }
        )

        server.registerTool(
            'now_time',
            {
                description: '나라 이름을 입력하면 해당 나라의 현재 시간을 반환합니다.',
                inputSchema: {
                    country: z
                        .string()
                        .describe(
                            '현재 시간을 조회할 나라 이름 (예: Korea, Japan, USA, France)'
                        )
                }
            },
            async ({ country }) => {
                const countryTimezoneMap: Record<string, string> = {
                    korea: 'Asia/Seoul',
                    'south korea': 'Asia/Seoul',
                    한국: 'Asia/Seoul',
                    대한민국: 'Asia/Seoul',
                    japan: 'Asia/Tokyo',
                    일본: 'Asia/Tokyo',
                    china: 'Asia/Shanghai',
                    중국: 'Asia/Shanghai',
                    usa: 'America/New_York',
                    'united states': 'America/New_York',
                    미국: 'America/New_York',
                    uk: 'Europe/London',
                    'united kingdom': 'Europe/London',
                    england: 'Europe/London',
                    영국: 'Europe/London',
                    france: 'Europe/Paris',
                    프랑스: 'Europe/Paris',
                    germany: 'Europe/Berlin',
                    독일: 'Europe/Berlin',
                    australia: 'Australia/Sydney',
                    호주: 'Australia/Sydney',
                    canada: 'America/Toronto',
                    캐나다: 'America/Toronto',
                    brazil: 'America/Sao_Paulo',
                    브라질: 'America/Sao_Paulo',
                    india: 'Asia/Kolkata',
                    인도: 'Asia/Kolkata',
                    russia: 'Europe/Moscow',
                    러시아: 'Europe/Moscow',
                    singapore: 'Asia/Singapore',
                    싱가포르: 'Asia/Singapore',
                    'new zealand': 'Pacific/Auckland',
                    뉴질랜드: 'Pacific/Auckland',
                    uae: 'Asia/Dubai',
                    아랍에미리트: 'Asia/Dubai',
                    egypt: 'Africa/Cairo',
                    이집트: 'Africa/Cairo',
                    argentina: 'America/Argentina/Buenos_Aires',
                    아르헨티나: 'America/Argentina/Buenos_Aires',
                    mexico: 'America/Mexico_City',
                    멕시코: 'America/Mexico_City',
                    thailand: 'Asia/Bangkok',
                    태국: 'Asia/Bangkok',
                    vietnam: 'Asia/Ho_Chi_Minh',
                    베트남: 'Asia/Ho_Chi_Minh',
                    indonesia: 'Asia/Jakarta',
                    인도네시아: 'Asia/Jakarta',
                    philippines: 'Asia/Manila',
                    필리핀: 'Asia/Manila'
                }

                const key = country.toLowerCase().trim()
                const timezone = countryTimezoneMap[key]

                if (!timezone) {
                    return {
                        content: [
                            {
                                type: 'text' as const,
                                text: `'${country}'에 해당하는 시간대를 찾을 수 없습니다. 다른 나라 이름으로 시도해 보세요.`
                            }
                        ]
                    }
                }

                const now = new Date()
                const formatter = new Intl.DateTimeFormat('ko-KR', {
                    timeZone: timezone,
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false
                })

                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `${country}의 현재 시간: ${formatter.format(now)} (${timezone})`
                        }
                    ]
                }
            }
        )

        server.registerTool(
            'geocode',
            {
                description:
                    '도시 이름이나 주소를 입력하면 Nominatim OpenStreetMap API를 통해 위도와 경도 좌표를 반환합니다.',
                inputSchema: {
                    query: z
                        .string()
                        .describe(
                            '좌표를 조회할 도시 이름 또는 주소 (예: 서울, Tokyo, Paris, 1600 Pennsylvania Ave Washington DC)'
                        ),
                    limit: z
                        .number()
                        .int()
                        .min(1)
                        .max(10)
                        .optional()
                        .default(3)
                        .describe('반환할 최대 결과 수 (기본값: 3, 최대: 10)')
                }
            },
            async ({ query, limit }) => {
                const url = new URL('https://nominatim.openstreetmap.org/search')
                url.searchParams.set('q', query)
                url.searchParams.set('format', 'json')
                url.searchParams.set('limit', String(limit))
                url.searchParams.set('addressdetails', '1')

                const response = await fetch(url.toString(), {
                    headers: {
                        'User-Agent': 'toni-mcp-server/1.0.0 (MCP Geocode Tool)',
                        'Accept-Language': 'ko,en'
                    }
                })

                if (!response.ok) {
                    return {
                        content: [
                            {
                                type: 'text' as const,
                                text: `Nominatim API 오류: HTTP ${response.status} ${response.statusText}`
                            }
                        ]
                    }
                }

                const results = (await response.json()) as Array<{
                    lat: string
                    lon: string
                    display_name: string
                    type: string
                    importance: number
                }>

                if (results.length === 0) {
                    return {
                        content: [
                            {
                                type: 'text' as const,
                                text: `'${query}'에 대한 검색 결과를 찾을 수 없습니다.`
                            }
                        ]
                    }
                }

                const lines = results.map((r, i) => {
                    const lat = parseFloat(r.lat).toFixed(6)
                    const lon = parseFloat(r.lon).toFixed(6)
                    return `[${i + 1}] ${r.display_name}\n    위도(lat): ${lat}, 경도(lon): ${lon}`
                })

                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `"${query}" 검색 결과 (${results.length}건):\n\n${lines.join('\n\n')}`
                        }
                    ]
                }
            }
        )

        server.registerTool(
            'get-weather',
            {
                description:
                    '위도, 경도, 예보 기간을 입력하면 Open-Meteo API를 통해 현재 날씨와 일별 예보를 반환합니다.',
                inputSchema: {
                    latitude: z
                        .number()
                        .min(-90)
                        .max(90)
                        .describe('위도 (예: 37.5665 = 서울)'),
                    longitude: z
                        .number()
                        .min(-180)
                        .max(180)
                        .describe('경도 (예: 126.9780 = 서울)'),
                    forecast_days: z
                        .number()
                        .int()
                        .min(1)
                        .max(16)
                        .optional()
                        .default(3)
                        .describe('예보 기간 (일 단위, 기본값: 3, 최대: 16)')
                }
            },
            async ({ latitude, longitude, forecast_days }) => {
                const url = new URL('https://api.open-meteo.com/v1/forecast')
                url.searchParams.set('latitude', String(latitude))
                url.searchParams.set('longitude', String(longitude))
                url.searchParams.set('timezone', 'auto')
                url.searchParams.set('forecast_days', String(forecast_days))
                url.searchParams.set(
                    'current',
                    [
                        'temperature_2m',
                        'relative_humidity_2m',
                        'apparent_temperature',
                        'is_day',
                        'precipitation',
                        'weather_code',
                        'cloud_cover',
                        'wind_speed_10m',
                        'wind_direction_10m',
                        'wind_gusts_10m'
                    ].join(',')
                )
                url.searchParams.set(
                    'daily',
                    [
                        'weather_code',
                        'temperature_2m_max',
                        'temperature_2m_min',
                        'precipitation_sum',
                        'precipitation_probability_max',
                        'wind_speed_10m_max',
                        'sunrise',
                        'sunset'
                    ].join(',')
                )

                const response = await fetch(url.toString())

                if (!response.ok) {
                    const body = (await response.json().catch(() => ({}))) as {
                        reason?: string
                    }
                    return {
                        content: [
                            {
                                type: 'text' as const,
                                text: `Open-Meteo API 오류: ${body.reason ?? `HTTP ${response.status}`}`
                            }
                        ]
                    }
                }

                const data = (await response.json()) as {
                    timezone: string
                    timezone_abbreviation: string
                    current: {
                        time: string
                        temperature_2m: number
                        relative_humidity_2m: number
                        apparent_temperature: number
                        is_day: number
                        precipitation: number
                        weather_code: number
                        cloud_cover: number
                        wind_speed_10m: number
                        wind_direction_10m: number
                        wind_gusts_10m: number
                    }
                    current_units: Record<string, string>
                    daily: {
                        time: string[]
                        weather_code: number[]
                        temperature_2m_max: number[]
                        temperature_2m_min: number[]
                        precipitation_sum: number[]
                        precipitation_probability_max: number[]
                        wind_speed_10m_max: number[]
                        sunrise: string[]
                        sunset: string[]
                    }
                }

                const c = data.current
                const cu = data.current_units
                const d = data.daily

                const currentLines = [
                    `📍 위치: 위도 ${latitude}, 경도 ${longitude} (${data.timezone} / ${data.timezone_abbreviation})`,
                    `🕐 기준 시각: ${c.time}`,
                    ``,
                    `━━━ 현재 날씨 ━━━`,
                    `날씨 상태: ${getWeatherDesc(c.weather_code)}`,
                    `기온: ${c.temperature_2m}${cu.temperature_2m} (체감 ${c.apparent_temperature}${cu.apparent_temperature})`,
                    `습도: ${c.relative_humidity_2m}${cu.relative_humidity_2m}`,
                    `강수량: ${c.precipitation}${cu.precipitation}`,
                    `구름량: ${c.cloud_cover}${cu.cloud_cover}`,
                    `풍속: ${c.wind_speed_10m}${cu.wind_speed_10m} (${windDirection(c.wind_direction_10m)}풍, 돌풍 ${c.wind_gusts_10m}${cu.wind_gusts_10m})`,
                    `낮/밤: ${c.is_day ? '낮 ☀️' : '밤 🌙'}`
                ]

                const forecastLines = d.time.map((date, i) => {
                    const sunrise = d.sunrise[i].split('T')[1]
                    const sunset = d.sunset[i].split('T')[1]
                    return [
                        ``,
                        `📅 ${date}`,
                        `  날씨: ${getWeatherDesc(d.weather_code[i])}`,
                        `  기온: 최고 ${d.temperature_2m_max[i]}°C / 최저 ${d.temperature_2m_min[i]}°C`,
                        `  강수량: ${d.precipitation_sum[i]}mm (강수확률 ${d.precipitation_probability_max[i]}%)`,
                        `  최대 풍속: ${d.wind_speed_10m_max[i]}km/h`,
                        `  일출: ${sunrise} / 일몰: ${sunset}`
                    ].join('\n')
                })

                const text = [
                    ...currentLines,
                    ``,
                    `━━━ ${forecast_days}일 예보 ━━━`,
                    ...forecastLines
                ].join('\n')

                return {
                    content: [{ type: 'text' as const, text }]
                }
            }
        )

        server.registerTool(
            'generate-image',
            {
                description:
                    '텍스트 프롬프트를 입력하면 HuggingFace FLUX.1-schnell 모델로 이미지를 생성해 반환합니다.',
                inputSchema: {
                    prompt: z.string().describe('이미지 생성 프롬프트 (영어 권장)'),
                    num_inference_steps: z
                        .number()
                        .int()
                        .min(1)
                        .max(10)
                        .optional()
                        .default(4)
                        .describe(
                            '추론 스텝 수 (기본값: 4, 범위: 1~10). 높을수록 품질이 좋아지지만 느려집니다.'
                        )
                }
            },
            async ({ prompt, num_inference_steps }) => {
                const token = process.env.HF_TOKEN
                if (!token) {
                    return {
                        content: [
                            {
                                type: 'text' as const,
                                text: '오류: HF_TOKEN 환경변수가 설정되지 않았습니다. HuggingFace API 토큰을 설정해주세요.'
                            }
                        ]
                    }
                }

                try {
                    const client = new InferenceClient(token)
                    const blob = await client.textToImage(
                        {
                            provider: 'together',
                            model: 'black-forest-labs/FLUX.1-schnell',
                            inputs: prompt,
                            parameters: { num_inference_steps }
                        },
                        { outputType: 'blob' }
                    )

                    const arrayBuffer = await blob.arrayBuffer()
                    const base64 = Buffer.from(arrayBuffer).toString('base64')

                    return {
                        content: [
                            {
                                type: 'image' as const,
                                data: base64,
                                mimeType: 'image/png'
                            }
                        ]
                    }
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err)
                    return {
                        content: [
                            {
                                type: 'text' as const,
                                text: `이미지 생성 실패: ${message}`
                            }
                        ]
                    }
                }
            }
        )

        server.registerResource(
            'server-info',
            'server://info',
            {
                title: '서버 정보',
                description: 'toni-mcp-server의 이름, 버전, 등록된 도구 목록을 반환합니다.',
                mimeType: 'application/json'
            },
            async (uri) => {
                const info = {
                    name: SERVER_NAME,
                    version: SERVER_VERSION,
                    startedAt: SERVER_START_TIME.toISOString(),
                    tools: REGISTERED_TOOLS,
                    resources: [
                        {
                            uri: 'server://info',
                            title: '서버 정보',
                            description: '서버 이름, 버전, 도구 목록'
                        },
                        {
                            uri: 'server://status',
                            title: '서버 상태',
                            description: '실시간 가동 시간, 메모리 사용량, 현재 시각'
                        }
                    ]
                }

                return {
                    contents: [
                        {
                            uri: uri.toString(),
                            mimeType: 'application/json',
                            text: JSON.stringify(info, null, 2)
                        }
                    ]
                }
            }
        )

        server.registerResource(
            'server-status',
            'server://status',
            {
                title: '서버 상태',
                description:
                    'toni-mcp-server의 실시간 가동 시간, 메모리 사용량, 현재 시각을 반환합니다.',
                mimeType: 'application/json'
            },
            async (uri) => {
                const now = new Date()
                const uptimeMs = now.getTime() - SERVER_START_TIME.getTime()
                const uptimeSec = Math.floor(uptimeMs / 1000)
                const uptimeMin = Math.floor(uptimeSec / 60)
                const uptimeHour = Math.floor(uptimeMin / 60)

                const mem = process.memoryUsage()

                const status = {
                    currentTime: now.toISOString(),
                    uptime: {
                        hours: uptimeHour,
                        minutes: uptimeMin % 60,
                        seconds: uptimeSec % 60,
                        formatted: `${String(uptimeHour).padStart(2, '0')}:${String(uptimeMin % 60).padStart(2, '0')}:${String(uptimeSec % 60).padStart(2, '0')}`
                    },
                    memory: {
                        heapUsed: `${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB`,
                        heapTotal: `${(mem.heapTotal / 1024 / 1024).toFixed(2)} MB`,
                        rss: `${(mem.rss / 1024 / 1024).toFixed(2)} MB`,
                        external: `${(mem.external / 1024 / 1024).toFixed(2)} MB`
                    },
                    process: {
                        pid: process.pid,
                        platform: process.platform,
                        nodeVersion: process.version
                    }
                }

                return {
                    contents: [
                        {
                            uri: uri.toString(),
                            mimeType: 'application/json',
                            text: JSON.stringify(status, null, 2)
                        }
                    ]
                }
            }
        )

        server.registerPrompt(
            'code-review',
            {
                title: '코드 리뷰',
                description:
                    '코드를 입력하면 품질, 가독성, 보안, 성능 관점에서 전문적인 코드 리뷰를 제공합니다.',
                argsSchema: {
                    code: z.string().describe('리뷰할 코드'),
                    language: z
                        .string()
                        .optional()
                        .describe(
                            '프로그래밍 언어 (예: TypeScript, Python, Java). 미입력 시 자동 감지'
                        ),
                    focus: z
                        .enum(['all', 'quality', 'security', 'performance', 'readability'])
                        .optional()
                        .default('all')
                        .describe(
                            '리뷰 집중 영역: all(전체), quality(코드 품질), security(보안), performance(성능), readability(가독성)'
                        )
                }
            },
            ({ code, language, focus }) => {
                const lang = language ?? '(자동 감지)'
                const focusLabel: Record<string, string> = {
                    all: '전체 (품질 · 보안 · 성능 · 가독성)',
                    quality: '코드 품질',
                    security: '보안',
                    performance: '성능',
                    readability: '가독성'
                }
                const focusGuide: Record<string, string> = {
                    all: `다음 4가지 관점을 **모두** 분석해주세요:\n- **코드 품질**: 구조, 설계 패턴, 중복 제거, 단일 책임 원칙\n- **보안**: 입력 검증, 인증/인가, 민감 정보 노출, 인젝션 취약점\n- **성능**: 시간/공간 복잡도, 불필요한 연산, 메모리 누수, 최적화 기회\n- **가독성**: 네이밍 컨벤션, 주석, 함수 길이, 코드 일관성`,
                    quality: `**코드 품질** 관점에 집중해주세요:\n- 구조와 설계 패턴의 적절성\n- 중복 코드(DRY 원칙) 위반 여부\n- 단일 책임 원칙(SRP) 준수 여부\n- 불필요한 복잡성 제거 가능 여부`,
                    security: `**보안** 관점에 집중해주세요:\n- 입력값 검증 및 새니타이징 여부\n- 인증/인가 처리의 적절성\n- 민감 정보(키, 패스워드, 토큰) 노출 여부\n- SQL 인젝션, XSS, CSRF 등 주요 취약점`,
                    performance: `**성능** 관점에 집중해주세요:\n- 시간 복잡도 및 공간 복잡도 분석\n- 불필요한 반복 연산 또는 중복 호출\n- 메모리 누수 가능성\n- 캐싱, 지연 로딩 등 최적화 기회`,
                    readability: `**가독성** 관점에 집중해주세요:\n- 변수/함수/클래스 네이밍 컨벤션\n- 주석의 적절성 (과도하거나 부족한 주석)\n- 함수 및 클래스의 길이와 복잡도\n- 코드 스타일 일관성`
                }

                const systemPrompt = `당신은 10년 이상 경력의 시니어 소프트웨어 엔지니어입니다.\n아래 코드를 **${focusLabel[focus ?? 'all']}** 관점에서 전문적으로 리뷰해주세요.\n\n${focusGuide[focus ?? 'all']}\n\n---\n\n## 리뷰 형식\n\n### ✅ 잘 된 점\n좋은 부분을 구체적으로 칭찬해주세요.\n\n### ⚠️ 개선이 필요한 부분\n문제점을 **심각도(높음/중간/낮음)** 와 함께 나열하고, 각 항목마다 개선된 코드 예시를 제공해주세요.\n\n### 💡 추가 제안\n선택적으로 적용할 수 있는 개선 아이디어를 제안해주세요.\n\n### 📊 종합 점수\n10점 만점으로 종합 점수를 매기고 한 줄 총평을 작성해주세요.`

                return {
                    description: `${lang} 코드 리뷰 — 집중 영역: ${focusLabel[focus ?? 'all']}`,
                    messages: [
                        {
                            role: 'user' as const,
                            content: {
                                type: 'text' as const,
                                text: `${systemPrompt}\n\n---\n\n## 리뷰 대상 코드\n언어: ${lang}\n\n\`\`\`${language?.toLowerCase() ?? ''}\n${code}\n\`\`\``
                            }
                        }
                    ]
                }
            }
        )
    },
    {},
    {
        maxDuration: 60
    }
)

export { handler as GET, handler as POST, handler as DELETE }
