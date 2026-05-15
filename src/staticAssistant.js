const STORAGE_KEY = 'personal-assistant-static-v1'

const DEFAULT_DAILY_PLAN = `7:00 AM
8:00 AM
9:00 AM
11:00 AM
1:00 PM
3:00 PM
5:00 PM
7:00 PM
9:00 PM`

const DEFAULT_WEEKLY_PLAN = `Monday
- 

Tuesday
- 

Wednesday
- 

Thursday
- 

Friday
- 

Saturday
- 

Sunday
- `

const QUOTE_BANK = [
  ['Small steady work still changes the day.', 'local studio note'],
  ['A routine is softer when it makes room for real life.', 'local studio note'],
  ['The best reset is usually the next honest action.', 'local studio note'],
  ['Momentum grows faster when the pressure drops.', 'local studio note'],
  ['Quiet structure can carry more than loud motivation.', 'local studio note'],
  ['A softer pace still counts as progress.', 'local studio note'],
]

function now() {
  return new Date()
}

function todayKey() {
  return now().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

function readStore() {
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (raw) {
    return JSON.parse(raw)
  }
  const seed = {
    routines: {
      daily: { kind: 'daily', content: DEFAULT_DAILY_PLAN, updated_at: now().toISOString() },
      weekly: { kind: 'weekly', content: DEFAULT_WEEKLY_PLAN, updated_at: now().toISOString() },
    },
    reminders: [],
    checkins: [],
    waterSettings: { intervalMinutes: 120, paused: false },
    currentQuote: {
      text: QUOTE_BANK[0][0],
      source: QUOTE_BANK[0][1],
      updatedAt: now().toISOString(),
    },
    quoteHistory: [
      { id: 1, quote_text: QUOTE_BANK[0][0], source: QUOTE_BANK[0][1], created_at: now().toISOString() },
    ],
    notes: [],
    projects: [],
    permissions: { calendar: false, web: false, llm: false, quotes: false },
  }
  writeStore(seed)
  return seed
}

function writeStore(store) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
}

function withDerived(store) {
  const reminders = [...store.reminders].sort((a, b) => new Date(a.remind_at) - new Date(b.remind_at)).map((item) => {
    const local = new Date(item.remind_at)
    return {
      ...item,
      displayTime: local.toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
      dayKey: local.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }),
    }
  })
  const checkins = store.checkins.map((item) => ({
    ...item,
    isDoneToday: item.last_completed_on === todayKey(),
  }))
  return {
    ...store,
    reminders,
    checkins,
    calendar: {
      connected: false,
      message: 'This deployed version is frontend-only for now.',
      events: [],
      connectSteps: [
        'For the public demo, calendar is not connected yet.',
        'The local version can be extended with OAuth later.',
        'For now, use reminders and check-ins directly in the app.',
      ],
    },
    briefing: {
      dayLabel: now().toLocaleDateString('en-IN', {
        weekday: 'long',
        day: '2-digit',
        month: 'short',
      }),
      summary: reminders[0]
        ? `Next up: ${reminders[0].text} at ${reminders[0].displayTime}.`
        : 'No timed reminder is waiting at the moment.',
      quote: store.currentQuote,
      openCheckins: checkins.filter((item) => item.status === 'active' && !item.isDoneToday).length,
    },
    stats: {
      todaysReminders: reminders.filter((item) => item.dayKey === todayKey()).length,
      openCheckins: checkins.filter((item) => item.status === 'active' && !item.isDoneToday).length,
      activeProjects: store.projects.filter((item) => item.status === 'active').length,
    },
  }
}

function rotateQuote(store, force = false) {
  const latest = store.currentQuote
  const latestTime = latest?.updatedAt ? new Date(latest.updatedAt) : null
  if (!force && latestTime && (Date.now() - latestTime.getTime()) < 3 * 60 * 60 * 1000) {
    return store
  }
  const used = new Set(store.quoteHistory.map((item) => item.quote_text))
  let chosen = QUOTE_BANK.find(([text]) => !used.has(text)) || QUOTE_BANK[0]
  const nextQuote = { text: chosen[0], source: chosen[1], updatedAt: now().toISOString() }
  const nextHistory = [
    { id: Date.now(), quote_text: chosen[0], source: chosen[1], created_at: now().toISOString() },
    ...store.quoteHistory,
  ].slice(0, 30)
  return {
    ...store,
    currentQuote: nextQuote,
    quoteHistory: nextHistory,
  }
}

export async function loadStaticState() {
  const store = rotateQuote(readStore(), false)
  writeStore(store)
  return withDerived(store)
}

export async function staticPost(path, body) {
  let store = readStore()

  if (path === '/routines/daily') {
    store.routines.daily = { kind: 'daily', content: body.content || DEFAULT_DAILY_PLAN, updated_at: now().toISOString() }
    writeStore(store)
    return { message: 'Daily plan saved.' }
  }

  if (path === '/routines/weekly') {
    store.routines.weekly = { kind: 'weekly', content: body.content || DEFAULT_WEEKLY_PLAN, updated_at: now().toISOString() }
    writeStore(store)
    return { message: 'Weekly routine saved.' }
  }

  if (path === '/reminders') {
    store.reminders.unshift({
      id: Date.now(),
      text: body.text,
      remind_at: new Date(body.remindAt).toISOString(),
      status: 'active',
      created_at: now().toISOString(),
    })
    writeStore(store)
    return { message: 'Reminder saved.' }
  }

  if (path === '/checkins') {
    store.checkins.push({
      id: Date.now(),
      text: body.text,
      time_of_day: body.timeOfDay,
      status: 'active',
      last_completed_on: '',
      created_at: now().toISOString(),
    })
    writeStore(store)
    return { message: 'Daily check-in saved.' }
  }

  if (path === '/quotes/custom') {
    const quote = {
      text: body.text,
      source: body.source || 'saved by you',
      updatedAt: now().toISOString(),
    }
    store.currentQuote = quote
    store.quoteHistory = [
      { id: Date.now(), quote_text: quote.text, source: quote.source, created_at: now().toISOString() },
      ...store.quoteHistory,
    ].slice(0, 30)
    writeStore(store)
    return quote
  }

  if (path === '/water-settings') {
    store.waterSettings = body
    writeStore(store)
    return { message: 'Water settings updated.' }
  }

  if (path === '/notes') {
    store.notes.unshift({ id: Date.now(), text: body.text, color: 'wine', created_at: now().toISOString() })
    writeStore(store)
    return { message: 'Sticky note added.' }
  }

  if (path === '/projects') {
    store.projects.unshift({
      id: Date.now(),
      name: body.name,
      detail: body.detail || '',
      status: 'active',
      created_at: now().toISOString(),
    })
    writeStore(store)
    return { message: 'Project added.' }
  }

  if (path === '/search/source') {
    return summarizeStaticSource(body.url, body.title, body.question || '')
  }

  return { message: 'Done.' }
}

export async function staticPatch(path, body) {
  let store = readStore()
  const parts = path.split('/').filter(Boolean)
  if (parts[0] === 'checkins') {
    store.checkins = store.checkins.map((item) => {
      if (String(item.id) !== parts[1]) return item
      return {
        ...item,
        status: body.status ?? item.status,
        last_completed_on: body.markDone ? todayKey() : item.last_completed_on,
      }
    })
    writeStore(store)
    return { message: 'Check-in updated.' }
  }
  if (parts[0] === 'projects') {
    store.projects = store.projects.map((item) => (
      String(item.id) === parts[1] ? { ...item, status: body.status ?? item.status } : item
    ))
    writeStore(store)
    return { message: 'Project updated.' }
  }
  if (parts[0] === 'permissions') {
    store.permissions[parts[1]] = Boolean(body.enabled)
    writeStore(store)
    return { message: `${parts[1]} permission updated.` }
  }
  return { message: 'Updated.' }
}

export async function staticDelete(path) {
  let store = readStore()
  const parts = path.split('/').filter(Boolean)
  if (parts[0] === 'reminders') {
    store.reminders = store.reminders.filter((item) => String(item.id) !== parts[1])
    writeStore(store)
    return { message: 'Reminder deleted.' }
  }
  if (parts[0] === 'notes') {
    store.notes = store.notes.filter((item) => String(item.id) !== parts[1])
    writeStore(store)
    return { message: 'Sticky note removed.' }
  }
  return { message: 'Deleted.' }
}

export async function staticQuote() {
  const store = rotateQuote(readStore(), true)
  writeStore(store)
  return store.currentQuote
}

export async function staticSearch(query) {
  const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=&format=json&origin=*`
  const response = await fetch(wikiUrl)
  const payload = await response.json()
  const wikiResults = (payload.query?.search || []).slice(0, 4).map((item) => ({
    title: item.title,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}`,
    snippet: item.snippet.replace(/<[^>]+>/g, ''),
    domain: 'wikipedia.org',
  }))
  const extraResults = [
    {
      title: `Search on DuckDuckGo: ${query}`,
      url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
      snippet: 'Open broader web results for this query.',
      domain: 'duckduckgo.com',
    },
    {
      title: `Search on YouTube: ${query}`,
      url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
      snippet: 'Open video results for this query.',
      domain: 'youtube.com',
    },
  ]
  return {
    query,
    results: [...wikiResults, ...extraResults],
    message: `I found a few places to start for “${query}”. Pick the source you want.`,
  }
}

export async function summarizeStaticSource(url, title, question) {
  if (url.includes('wikipedia.org/wiki/')) {
    const pageTitle = decodeURIComponent(url.split('/wiki/')[1] || '').replace(/_/g, ' ')
    const response = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle)}`)
    const payload = await response.json()
    return {
      title,
      url,
      answer: payload.extract || 'I could open the source, but I could not pull a summary from it.',
      source: `Source: ${title} — ${url}`,
      question,
    }
  }
  return {
    title,
    url,
    answer: 'I can open this source for you, but in the deployed version I can only summarize Wikipedia pages directly for now.',
    source: `Source: ${title} — ${url}`,
    question,
  }
}
