import { useEffect, useState } from 'react'
import './App.css'

const apiBase = 'http://127.0.0.1:8766/api'

const emptyDraft = {
  dailyPlan: '',
  weeklyPlan: '',
  reminderText: '',
  reminderAt: '',
  checkinText: '',
  checkinTime: '09:00',
  searchQuery: '',
  searchFollowUp: '',
  customQuote: '',
  customQuoteSource: '',
  noteText: '',
  projectName: '',
  projectDetail: '',
}

function getGreeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

function formatTime12h(value) {
  if (!value) return ''
  const [hoursText, minutes] = value.split(':')
  const hours = Number(hoursText)
  const suffix = hours >= 12 ? 'PM' : 'AM'
  const hour12 = hours % 12 || 12
  return `${hour12}:${minutes} ${suffix}`
}

function App() {
  const [state, setState] = useState(null)
  const [draft, setDraft] = useState(emptyDraft)
  const [searchResult, setSearchResult] = useState(null)
  const [selectedSource, setSelectedSource] = useState(null)
  const [sourceSummary, setSourceSummary] = useState(null)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)

  async function loadState() {
    setLoading(true)
    try {
      const response = await fetch(`${apiBase}/state`)
      const payload = await response.json()
      setState(payload)
      setDraft((current) => ({
        ...current,
        dailyPlan: payload.routines.daily?.content ?? '',
        weeklyPlan: payload.routines.weekly?.content ?? '',
      }))
    } catch (error) {
      setMessage('Could not reach the local assistant server. Start assistant_server.py first.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadState()
  }, [])

  async function post(path, body) {
    const response = await fetch(`${apiBase}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return response.json()
  }

  async function patch(path, body) {
    const response = await fetch(`${apiBase}${path}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return response.json()
  }

  async function remove(path) {
    const response = await fetch(`${apiBase}${path}`, { method: 'DELETE' })
    return response.json()
  }

  async function handleDailyPlanSave() {
    if (!draft.dailyPlan.trim()) {
      setMessage('Keep at least the time slots in your daily plan.')
      return
    }
    if (!window.confirm('Save your daily plan template?')) {
      return
    }
    const result = await post('/routines/daily', { content: draft.dailyPlan.trim() })
    setMessage(result.message)
    loadState()
  }

  async function handleWeeklyPlanSave() {
    if (!draft.weeklyPlan.trim()) {
      setMessage('Add your weekly anchors before saving.')
      return
    }
    if (!window.confirm('Save your weekly routine?')) {
      return
    }
    const result = await post('/routines/weekly', { content: draft.weeklyPlan.trim() })
    setMessage(result.message)
    loadState()
  }

  async function handleReminderSave() {
    if (!draft.reminderText.trim() || !draft.reminderAt) {
      setMessage('Add reminder text and a date/time.')
      return
    }
    const formatted = new Date(draft.reminderAt).toLocaleString('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
    if (!window.confirm(`Save reminder "${draft.reminderText.trim()}" for ${formatted}?`)) {
      return
    }
    const result = await post('/reminders', {
      text: draft.reminderText.trim(),
      remindAt: draft.reminderAt,
    })
    if (result.message) {
      setMessage(result.message)
      setDraft((current) => ({ ...current, reminderText: '', reminderAt: '' }))
      loadState()
    } else {
      setMessage(result.error || 'Could not save reminder.')
    }
  }

  async function handleCheckinSave() {
    if (!draft.checkinText.trim() || !draft.checkinTime) {
      setMessage('Add a check-in and time.')
      return
    }
    if (!window.confirm(`Add daily check-in "${draft.checkinText.trim()}" at ${draft.checkinTime}?`)) {
      return
    }
    const result = await post('/checkins', {
      text: draft.checkinText.trim(),
      timeOfDay: draft.checkinTime,
    })
    setMessage(result.message)
    setDraft((current) => ({ ...current, checkinText: '', checkinTime: current.checkinTime || '09:00' }))
    loadState()
  }

  async function markCheckinDone(checkinId) {
    const result = await patch(`/checkins/${checkinId}`, { markDone: true })
    setMessage(result.message)
    loadState()
  }

  async function toggleCheckin(checkinId, currentStatus) {
    const nextStatus = currentStatus === 'active' ? 'paused' : 'active'
    const result = await patch(`/checkins/${checkinId}`, { status: nextStatus })
    setMessage(result.message)
    loadState()
  }

  async function handleWaterUpdate(nextSettings) {
    if (!window.confirm('Update water reminder settings?')) {
      return
    }
    const result = await post('/water-settings', nextSettings)
    setMessage(result.message)
    loadState()
  }

  async function fetchNewQuote() {
    const response = await fetch(`${apiBase}/quote`)
    const payload = await response.json()
    setMessage(`Quote updated from ${payload.source}.`)
    loadState()
  }

  async function saveCustomQuote() {
    if (!draft.customQuote.trim()) {
      setMessage('Write the quote you want to keep.')
      return
    }
    const result = await post('/quotes/custom', {
      text: draft.customQuote.trim(),
      source: draft.customQuoteSource.trim() || 'saved by you',
    })
    setMessage(`Quote updated from ${result.source}.`)
    setDraft((current) => ({ ...current, customQuote: '', customQuoteSource: '' }))
    loadState()
  }

  async function handleSearch() {
    if (!draft.searchQuery.trim()) {
      setMessage('Type something to search.')
      return
    }
    const response = await fetch(`${apiBase}/search?q=${encodeURIComponent(draft.searchQuery.trim())}`)
    const payload = await response.json()
    setSearchResult(payload)
    setSelectedSource(null)
    setSourceSummary(null)
    setMessage(payload.message || 'Search finished.')
  }

  async function inspectSource(source, question = '') {
    setSelectedSource(source)
    setSourceSummary({ answer: 'Pulling details from this source...', source: `Source: ${source.title}` })
    const payload = await post('/search/source', {
      url: source.url,
      title: source.title,
      question,
    })
    setSourceSummary(payload)
    setMessage(question ? 'Here’s what I found in that source.' : 'Source summary ready.')
  }

  function clearSearch() {
    setSearchResult(null)
    setSelectedSource(null)
    setSourceSummary(null)
    setDraft((current) => ({ ...current, searchFollowUp: '' }))
  }

  async function deleteReminder(reminderId) {
    if (!window.confirm(`Delete reminder #${reminderId}?`)) {
      return
    }
    const result = await remove(`/reminders/${reminderId}`)
    setMessage(result.message)
    loadState()
  }

  async function addNote() {
    if (!draft.noteText.trim()) {
      setMessage('Write something for the sticky note.')
      return
    }
    const result = await post('/notes', { text: draft.noteText.trim(), color: 'wine' })
    setMessage(result.message)
    setDraft((current) => ({ ...current, noteText: '' }))
    loadState()
  }

  async function deleteNote(noteId) {
    const result = await remove(`/notes/${noteId}`)
    setMessage(result.message)
    loadState()
  }

  async function addProject() {
    if (!draft.projectName.trim()) {
      setMessage('Add a project name first.')
      return
    }
    const result = await post('/projects', {
      name: draft.projectName.trim(),
      detail: draft.projectDetail.trim(),
    })
    setMessage(result.message)
    setDraft((current) => ({ ...current, projectName: '', projectDetail: '' }))
    loadState()
  }

  async function toggleProject(projectId, currentStatus) {
    const nextStatus = currentStatus === 'active' ? 'paused' : 'active'
    const result = await patch(`/projects/${projectId}`, { status: nextStatus })
    setMessage(result.message)
    loadState()
  }

  async function completeProject(projectId) {
    const result = await patch(`/projects/${projectId}`, { status: 'completed' })
    setMessage(result.message)
    loadState()
  }

  async function togglePermission(name, enabled) {
    const result = await patch(`/permissions/${name}`, { enabled })
    setMessage(result.message)
    loadState()
  }

  if (loading && !state) {
    return <main className="shell loading">Preparing your private assistant…</main>
  }

  if (!state) {
    return <main className="shell loading">{message || 'Assistant is unavailable.'}</main>
  }

  const greeting = getGreeting()
  const nextReminder = state.reminders[0] ?? null
  const openCheckins = state.checkins.filter((item) => item.status === 'active' && !item.isDoneToday)
  const currentQuote = state.currentQuote

  return (
    <main className="shell">
      <section className="hero panel lift">
        <div className="hero-copy">
          <p className="eyebrow">Private Assistant</p>
          <h1>{greeting}. What needs my attention first?</h1>
          <p className="lede">
            Ask something, add a reminder, or check what still needs to get done today.
          </p>
          <div className="assistant-strip">
            <div className="assistant-chip">
              <span>Next reminder</span>
              <strong>{nextReminder ? nextReminder.text : 'Nothing queued'}</strong>
              <small>{nextReminder ? nextReminder.displayTime : 'You have a clear board right now.'}</small>
            </div>
            <div className="assistant-chip">
              <span>Still open today</span>
              <strong>{openCheckins.length} check-in{openCheckins.length === 1 ? '' : 's'}</strong>
              <small>{openCheckins.length ? 'They stay visible until you mark them done.' : 'Everything is marked done for today.'}</small>
            </div>
          </div>
        </div>
        <div className="hero-board">
          <div className="polaroid tall">
            <span className="pin" />
            <p>Current quote</p>
            <strong>{state.briefing.dayLabel}</strong>
            <small>{currentQuote.text}</small>
          </div>
          <div className="polaroid">
            <span className="pin olive" />
            <p>Today</p>
            <strong>{state.briefing.summary}</strong>
            <small>{state.stats.todaysReminders} reminder(s), {state.stats.openCheckins} open check-in(s).</small>
          </div>
          <div className="swatch-card">
            <span className="swatch clay" />
            <span className="swatch moss" />
            <span className="swatch oat" />
            <span className="swatch ink" />
          </div>
        </div>
      </section>

      <section className="search-band panel">
        <div className="search-band-head">
          <div>
            <p className="section-tag">Search</p>
            <h2>Ask a question, compare sources, then open the one you want.</h2>
          </div>
          {searchResult && (
            <button className="ghost close-search" onClick={clearSearch}>Close search</button>
          )}
        </div>
        <div className="hero-search search-band-form">
          <input
            value={draft.searchQuery}
            onChange={(event) => setDraft((current) => ({ ...current, searchQuery: event.target.value }))}
            placeholder="Ask a question, search a link, check a timing"
          />
          <button className="primary" onClick={handleSearch}>Search</button>
        </div>
        {searchResult && (
          <div className="search-result hero-result">
            <p>{searchResult.message}</p>
            {searchResult.results?.length > 0 && (
              <div className="search-sources">
                {searchResult.results.map((result) => (
                  <div className="source-card" key={result.url}>
                    <div>
                      <strong>{result.title}</strong>
                      <span>{result.domain}</span>
                      <p>{result.snippet}</p>
                    </div>
                    <div className="action-row">
                      <button className="ghost" onClick={() => inspectSource(result)}>Use this source</button>
                      <a className="source-link" href={result.url} target="_blank" rel="noreferrer">
                        <span>Open source</span>
                        <small>{result.domain}</small>
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {selectedSource && (
              <div className="source-workspace">
                <div className="source-head">
                  <strong>{selectedSource.title}</strong>
                  <span>{selectedSource.domain}</span>
                </div>
                <div className="field-row">
                  <input
                    value={draft.searchFollowUp}
                    onChange={(event) => setDraft((current) => ({ ...current, searchFollowUp: event.target.value }))}
                    placeholder="Ask about this source"
                  />
                  <button
                    className="primary"
                    onClick={() => inspectSource(selectedSource, draft.searchFollowUp.trim())}
                  >
                    Ask
                  </button>
                </div>
                {sourceSummary && (
                  <div className="search-answer">
                    <p>{sourceSummary.answer}</p>
                    <p className="source-line">{sourceSummary.source}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="grid overview-grid">
        <article className="panel note-card">
          <p className="section-tag">Today at a glance</p>
          <h2>{state.briefing.dayLabel}</h2>
          <p className="briefing-copy">
            {nextReminder
              ? `Next up: ${nextReminder.text} at ${nextReminder.displayTime}.`
              : 'No timed reminder is waiting at the moment.'}
          </p>
          <div className="mini-columns">
            <div>
              <span className="mini-label">Reminders today</span>
              <strong>{state.stats.todaysReminders}</strong>
            </div>
            <div>
              <span className="mini-label">Open check-ins</span>
              <strong>{state.stats.openCheckins}</strong>
            </div>
            <div>
              <span className="mini-label">Projects</span>
              <strong>{state.stats.activeProjects}</strong>
            </div>
          </div>
        </article>

        <article className="panel reminder-card compact-card">
          <p className="section-tag">Add reminder</p>
          <h2>Save something for later.</h2>
          <div className="field-row">
            <input
              value={draft.reminderText}
              onChange={(event) => setDraft((current) => ({ ...current, reminderText: event.target.value }))}
              placeholder="Call, leave, submit, pick up"
            />
            <input
              type="datetime-local"
              value={draft.reminderAt}
              onChange={(event) => setDraft((current) => ({ ...current, reminderAt: event.target.value }))}
            />
          </div>
          <button className="primary" onClick={handleReminderSave}>Add reminder</button>
        </article>
      </section>

      <section className="grid main-grid">
        <article className="panel checkin-card">
          <p className="section-tag">Daily check-ins</p>
          <h2>These stay here until you mark them done today.</h2>
          <div className="field-row">
            <input
              value={draft.checkinText}
              onChange={(event) => setDraft((current) => ({ ...current, checkinText: event.target.value }))}
              placeholder="Take vitamins, revise notes, reply to messages"
            />
            <input
              type="time"
              value={draft.checkinTime}
              onChange={(event) => setDraft((current) => ({ ...current, checkinTime: event.target.value }))}
            />
          </div>
          <button className="primary" onClick={handleCheckinSave}>Add check-in</button>
          <div className="stack-list">
            {state.checkins.map((item) => (
              <div className={`list-card ${item.isDoneToday ? 'done-card' : ''}`} key={item.id}>
                <div>
                  <strong>{item.text}</strong>
                  <span>{formatTime12h(item.time_of_day)} IST • {item.isDoneToday ? 'done today' : 'still open'}</span>
                </div>
                <div className="action-row">
                  <button className="ghost" onClick={() => markCheckinDone(item.id)}>Done</button>
                  <button className="ghost" onClick={() => toggleCheckin(item.id, item.status)}>
                    {item.status === 'active' ? 'Pause' : 'Resume'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="panel daily-card">
          <p className="section-tag">Daily map</p>
          <h2>Your day template with time slots already started.</h2>
          <textarea
            value={draft.dailyPlan}
            onChange={(event) => setDraft((current) => ({ ...current, dailyPlan: event.target.value }))}
          />
          <button className="primary" onClick={handleDailyPlanSave}>Save daily map</button>
        </article>

        <article className="panel weekly-card">
          <p className="section-tag">Weekly map</p>
          <h2>Your standing anchors across the week.</h2>
          <textarea
            value={draft.weeklyPlan}
            onChange={(event) => setDraft((current) => ({ ...current, weeklyPlan: event.target.value }))}
          />
          <button className="primary" onClick={handleWeeklyPlanSave}>Save weekly map</button>
        </article>

        <article className="panel quote-card">
          <p className="section-tag">Quote</p>
          <h2>Pick the line you want to keep close today.</h2>
          <blockquote>{currentQuote.text}</blockquote>
          <p className="source-line">Source: {currentQuote.source}</p>
          <div className="action-row">
            <button className="primary" onClick={fetchNewQuote}>Get a new quote</button>
          </div>
          <div className="field-stack">
            <input
              value={draft.customQuote}
              onChange={(event) => setDraft((current) => ({ ...current, customQuote: event.target.value }))}
            />
            <input
              value={draft.customQuoteSource}
              onChange={(event) => setDraft((current) => ({ ...current, customQuoteSource: event.target.value }))}
            />
            <button className="ghost" onClick={saveCustomQuote}>Use this quote</button>
          </div>
          <div className="history-strip">
            {state.quoteHistory.map((entry) => (
              <button
                key={entry.id}
                className="history-pill"
                onClick={() =>
                  post('/quotes/custom', { text: entry.quote_text, source: entry.source }).then(() => loadState())
                }
              >
                {entry.quote_text}
              </button>
            ))}
          </div>
        </article>

        <article className="panel notes-card">
          <p className="section-tag">Sticky notes</p>
          <h2>Loose thoughts that should stay visible.</h2>
          <div className="field-row single">
            <input
              value={draft.noteText}
              onChange={(event) => setDraft((current) => ({ ...current, noteText: event.target.value }))}
              placeholder="A quick note, a number, a thought, an errand"
            />
          </div>
          <button className="primary" onClick={addNote}>Add note</button>
          <div className="notes-grid">
            {state.notes.map((note) => (
              <div className="sticky-note" key={note.id}>
                <p>{note.text}</p>
                <button className="ghost" onClick={() => deleteNote(note.id)}>Remove</button>
              </div>
            ))}
          </div>
        </article>

        <article className="panel projects-card">
          <p className="section-tag">Projects</p>
          <h2>Things in motion that you want tracked here.</h2>
          <div className="field-stack">
            <input
              value={draft.projectName}
              onChange={(event) => setDraft((current) => ({ ...current, projectName: event.target.value }))}
              placeholder="Project name"
            />
            <input
              value={draft.projectDetail}
              onChange={(event) => setDraft((current) => ({ ...current, projectDetail: event.target.value }))}
              placeholder="Short note, next step, or context"
            />
            <button className="primary" onClick={addProject}>Add project</button>
          </div>
          <div className="stack-list">
            {state.projects.map((project) => (
              <div className="list-card" key={project.id}>
                <div>
                  <strong>{project.name}</strong>
                  <span className="project-detail">{project.detail || 'No detail yet'}</span>
                  <span className="project-status">{project.status}</span>
                </div>
                <div className="action-row">
                  {project.status !== 'completed' && (
                    <button className="ghost" onClick={() => completeProject(project.id)}>Done</button>
                  )}
                  {project.status !== 'completed' && (
                    <button className="ghost" onClick={() => toggleProject(project.id, project.status)}>
                      {project.status === 'active' ? 'Pause' : 'Resume'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="panel calendar-card">
          <p className="section-tag">Calendar</p>
          <h2>Show events here once Google Calendar is connected.</h2>
          <p className="briefing-copy">{state.calendar.message}</p>
          <div className="stack-list">
            {state.calendar.connectSteps.map((step) => (
              <div className="list-card" key={step}>
                <div>
                  <strong>{step}</strong>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="panel water-card">
          <p className="section-tag">Water reminders</p>
          <h2>Background nudges between 8am and 10pm IST.</h2>
          <div className="water-controls">
            <button
              className="ghost"
              onClick={() =>
                handleWaterUpdate({
                  intervalMinutes: state.waterSettings.intervalMinutes,
                  paused: !state.waterSettings.paused,
                })
              }
            >
              {state.waterSettings.paused ? 'Resume' : 'Pause'}
            </button>
            <button
              className="ghost"
              onClick={() =>
                handleWaterUpdate({
                  intervalMinutes: Math.max(60, state.waterSettings.intervalMinutes - 60),
                  paused: state.waterSettings.paused,
                })
              }
            >
              Shorter interval
            </button>
            <button
              className="ghost"
              onClick={() =>
                handleWaterUpdate({
                  intervalMinutes: state.waterSettings.intervalMinutes + 60,
                  paused: state.waterSettings.paused,
                })
              }
            >
              Longer interval
            </button>
          </div>
          <p className="microcopy">
            {state.waterSettings.paused
              ? 'Water reminders are paused right now.'
              : `Currently nudging every ${state.waterSettings.intervalMinutes} minutes.`}
          </p>
        </article>

        <article className="panel reminder-list-card">
          <p className="section-tag">Saved reminders</p>
          <h2>Everything you have asked me to remember.</h2>
          <div className="stack-list">
            {state.reminders.map((reminder) => (
              <div className="list-card" key={reminder.id}>
                <div>
                  <strong>{reminder.text}</strong>
                  <span>{reminder.displayTime}</span>
                </div>
                <button className="ghost" onClick={() => deleteReminder(reminder.id)}>Delete</button>
              </div>
            ))}
          </div>
        </article>
      </section>

      <footer className="status-bar">
        <span>{message || 'Local-first assistant ready.'}</span>
        <span>Private, local, and built around what you need today.</span>
      </footer>
    </main>
  )
}

export default App
