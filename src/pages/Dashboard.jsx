import { useEffect, useMemo, useRef, useState } from 'react'

const getDateDaysAgo = (daysAgo, today = new Date()) =>
  new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysAgo)

const investments = [
  {
    name: 'Growth Index Fund',
    balance: '$12,450.22',
    change: '+4.2%',
  },
  {
    name: 'Finova Tech ETF',
    balance: '$8,930.10',
    change: '+2.1%',
  },
  {
    name: 'Balanced Portfolio',
    balance: '$6,104.88',
    change: '+1.4%',
  },
]

const creditCards = [
  {
    name: 'Finova Platinum',
    balance: '$1,240.19',
    available: '$6,760.00',
  },
  {
    name: 'Finova Rewards',
    balance: '$410.55',
    available: '$3,590.00',
  },
]

const offers = [
  {
    title: 'Home Equity Boost',
    description: 'Tap into equity with rates as low as 5.1% APR.',
  },
  {
    title: 'Rewards Upgrade',
    description: 'Earn double points for 90 days when you upgrade.',
  },
  {
    title: 'Travel Perks',
    description: 'Unlock lounge access and travel insurance benefits.',
  },
]

const formatShortDate = (date) =>
  date.toLocaleDateString('en-US', { month: 'short', day: '2-digit' })

const getNextFifteenth = (today = new Date()) => {
  const year = today.getFullYear()
  const month = today.getMonth()
  const day = today.getDate()

  if (day <= 15) {
    return new Date(year, month, 15)
  }

  return new Date(year, month + 1, 15)
}

const initialMessages = [
  {
    id: 'welcome',
    role: 'bot',
    text: "Hello! I'm Finova Bank Assistant. How can I help you today?",
  },
]

function ChatPanel({
  isOpen,
  messages,
  input,
  onInputChange,
  onSend,
  onClose,
  isSending,
  hasActionButton,
  onActionButton,
  inputPlaceholder,
  inputHelperText,
  inputType,
  inputMode,
  inputMaxLength,
  isInputLocked,
}) {
  const endRef = useRef(null)

  useEffect(() => {
    if (!isOpen) return
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isOpen])

  if (!isOpen) return null

  return (
    <aside
      className={`fixed right-[10%] top-24 bottom-24 z-50 flex w-[92vw] max-w-md flex-col overflow-hidden rounded-2xl border bg-white text-finova-text shadow-2xl shadow-slate-900/10 md:w-[24rem] animate-in fade-in slide-in-from-bottom-6 duration-300 ${
        hasActionButton ? 'border-[#4285F4] ring-2 ring-[#4285F4]/20' : 'border-slate-200'
      }`}
    >
      <div className="flex items-center justify-between border-b border-[#4285F4] bg-[#4285F4] px-4 py-3 text-white">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-white">
            Finova Bank
          </p>
          <h4 className="text-sm font-semibold">Assistant</h4>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs font-semibold text-white hover:text-white/90"
        >
          Close
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto bg-white px-4 py-4">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${
              message.role === 'user' ? 'justify-end' : 'justify-start'
            }`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                message.role === 'user'
                  ? 'bg-slate-200 text-finova-text'
                  : 'bg-slate-100 text-finova-text'
              }`}
            >
              {message.text}
              {message.isLoading && (
                <span className="mt-2 inline-flex items-center gap-2 text-xs text-finova-muted">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-finova-primary border-t-transparent" />
                  Processing
                </span>
              )}
              {message.role === 'bot' && message.buttons?.length > 0 && (
                <div className="mt-3 flex flex-col gap-2">
                  {message.buttons.map((button) => (
                    <button
                      key={`${message.id}-${button.label}`}
                      type="button"
                      onClick={() => onActionButton?.(button)}
                      className="inline-flex w-full items-center justify-center rounded-full border border-[#4285F4] bg-white px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[#4285F4] shadow-sm transition hover:bg-finova-accent"
                    >
                      {button.label}
                    </button>
                  ))}
                </div>
              )}
              {message.role === 'bot' && message.button && (
                <a
                  href={message.button.url}
                  target={message.button.openInNewWindow ? '_blank' : '_self'}
                  rel="noreferrer"
                  onClick={(event) => {
                    event.preventDefault()
                    onActionButton?.(message.button)
                  }}
                  className="mt-3 inline-flex w-full items-center justify-center rounded-full bg-[#4285F4] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white shadow-sm transition hover:bg-finova-primary/90"
                >
                  {message.button.label}
                </a>
              )}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form
        className="border-t border-slate-200 bg-white px-4 py-3"
        onSubmit={onSend}
      >
        <div className="flex items-center gap-2">
          <input
            type={inputType ?? 'text'}
            value={input}
            onChange={onInputChange}
            placeholder={inputPlaceholder ?? 'Type your message...'}
            inputMode={inputMode}
            maxLength={inputMaxLength}
            className="flex-1 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-finova-text outline-none transition focus:border-finova-accent focus:ring-2 focus:ring-finova-accent/20"
            disabled={isSending || isInputLocked}
          />
          <button
            type="submit"
            disabled={isSending || isInputLocked || input.trim().length === 0}
            className="rounded-full bg-[#4285F4] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white shadow-sm transition hover:bg-finova-primary/90 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {isSending ? 'Sending' : 'Send'}
          </button>
        </div>
        {inputHelperText && (
          <p className="mt-2 text-xs text-finova-muted">{inputHelperText}</p>
        )}
      </form>
    </aside>
  )
}

function Dashboard({ onNavigateHome }) {
  const [isChatOpen, setIsChatOpen] = useState(false)
  const [chatInput, setChatInput] = useState('')
  const [messages, setMessages] = useState(initialMessages)
  const [isSendingChat, setIsSendingChat] = useState(false)
  const [activeInputRequest, setActiveInputRequest] = useState(null)
  const [isEligibilityLoading, setIsEligibilityLoading] = useState(false)
  const nextDueDate = formatShortDate(getNextFifteenth())
  const checkingLastActivity = formatShortDate(getDateDaysAgo(1))
  const savingsLastActivity = formatShortDate(getDateDaysAgo(7))

  const accounts = [
    {
      name: 'Finova Checking',
      balance: '$3,482.19',
      updated: `Last activity ${checkingLastActivity}`,
    },
    {
      name: 'Premier Savings',
      balance: '$18,905.44',
      updated: `Last activity ${savingsLastActivity}`,
    },
  ]

  const menuItems = useMemo(
    () => ['Home', 'Dashboard', 'Accounts', 'Offers', 'About', 'Contact'],
    []
  )

  const sendChatMessage = async ({ text, actionIntent }) => {
    const trimmed = text.trim()
    if (!trimmed) return

    const userMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      text: trimmed,
    }

    setMessages((prev) => [...prev, userMessage])
    setChatInput('')

    setIsSendingChat(true)
    try {
      const response = await fetch('http://localhost:3001/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: trimmed, actionIntent }),
      })

      const payload = await response.json()
      const botMessage = {
        id: `bot-${Date.now() + 1}`,
        role: 'bot',
        text:
          payload.reply ||
          'Sorry, I could not get a response from the assistant.',
        isLoading: Boolean(payload.loading),
        button: payload.button
          ? {
              ...payload.button,
              label: payload.buttonText ?? payload.button.label,
            }
          : null,
        buttons: payload.buttons ?? null,
      }
      setMessages((prev) => [...prev, botMessage])
      setActiveInputRequest(payload.inputRequest ?? null)

      if (payload.loading) {
        setIsEligibilityLoading(true)
        setActiveInputRequest(null)
        const duration = Number(payload.loading.durationMs) || 5000
        window.setTimeout(() => {
          setMessages((prev) => [
            ...prev,
            {
              id: `bot-${Date.now() + 2}`,
              role: 'bot',
              text: payload.loading.approvalMessage,
            },
          ])
          setIsEligibilityLoading(false)
        }, duration)
      } else {
        setIsEligibilityLoading(false)
      }
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: `bot-${Date.now() + 1}`,
          role: 'bot',
          text: 'Sorry, I could not get a response from the assistant.',
        },
      ])
    } finally {
      setIsSendingChat(false)
    }
  }

  const handleSendMessage = async (event) => {
    event.preventDefault()

    const trimmed = chatInput.trim()
    if (!trimmed) return
    await sendChatMessage({ text: trimmed })
  }

  const handleChatInputChange = (event) => {
    const nextValue = event.target.value
    if (activeInputRequest?.inputMode === 'numeric') {
      const digitsOnly = nextValue.replace(/\D/g, '')
      const maxLength = activeInputRequest?.maxLength ?? 4
      setChatInput(digitsOnly.slice(0, maxLength))
      return
    }
    setChatInput(nextValue)
  }

  const handleActionButton = async (button) => {
    if (button.url) {
      window.open(button.url, '_blank', 'noopener,noreferrer')
      setMessages((prev) => [
        ...prev,
        {
          id: `bot-${Date.now() + 1}`,
          role: 'bot',
          text: 'Is there anything else I can help you with today?',
        },
      ])
      return
    }
    if (button.actionIntent) {
      await sendChatMessage({ text: button.label, actionIntent: button.actionIntent })
    }
  }

  return (
    <div className="min-h-screen bg-finova-bg text-finova-text">
      <header className="border-b border-[#4285F4] bg-[#4285F4]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <button
            type="button"
            onClick={() => onNavigateHome?.()}
            className="flex items-center gap-2 text-lg font-semibold text-white hover:text-finova-accent"
            aria-label="Go to landing page"
          >
            Finova Bank
          </button>
          <nav className="hidden items-center gap-6 text-sm font-medium md:flex">
            {menuItems.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => {
                  if (item === 'Home') onNavigateHome?.()
                }}
                className={`relative hover:text-finova-accent ${
                  item === 'Dashboard' ? 'text-white' : 'text-white'
                }`}
              >
                {item}
                {item === 'Dashboard' && (
                  <span className="absolute -bottom-2 left-0 h-0.5 w-full rounded-full bg-finova-white" />
                )}
              </button>
            ))}
          </nav>
          <button className="text-sm font-medium text-finova-white md:hidden">
            Menu
          </button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-10">
        <section className="rounded-2xl border border-slate-200 bg-finova-white p-6 shadow-sm transition hover:shadow-md">
          <h2 className="text-2xl font-semibold text-finova-primary">
            Welcome back, Greg!
          </h2>
          <p className="mt-2 text-sm text-finova-muted">
            Here’s your financial snapshot.
          </p>
        </section>

        <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <article className="rounded-2xl border border-slate-200 bg-finova-white p-6 shadow-sm transition hover:border-finova-primary hover:bg-finova-accent hover:shadow-md">
            <div className="rounded-lg bg-finova-primary px-3 py-2 text-sm font-semibold text-finova-white">
              Banking
            </div>
            <div className="mt-4 space-y-3 text-sm">
              {accounts.map((account) => (
                <div
                  key={account.name}
                  className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"
                >
                  <div>
                    <p className="font-medium text-finova-text">{account.name}</p>
                    <p className="text-xs text-finova-muted">{account.updated}</p>
                  </div>
                  <p className="text-sm font-semibold text-finova-primary">
                    {account.balance}
                  </p>
                </div>
              ))}
            </div>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-finova-white p-6 shadow-sm transition hover:border-finova-primary hover:bg-finova-accent hover:shadow-md">
            <div className="flex items-center justify-between">
              <div className="rounded-lg bg-finova-primary px-3 py-2 text-sm font-semibold text-finova-white">
                Investments
              </div>
              <span className="rounded-full bg-finova-accent px-3 py-1 text-xs font-semibold text-finova-primary">
                Total $27,485.20
              </span>
            </div>
            <p className="mt-2 text-sm text-finova-muted">Gain/Loss +3.1%</p>
            <div className="mt-4 space-y-3 text-sm">
              {investments.map((item) => (
                <div
                  key={item.name}
                  className="flex items-center justify-between"
                >
                  <div>
                    <p className="font-medium text-finova-text">{item.name}</p>
                    <p className="text-xs text-finova-primary">{item.change} today</p>
                  </div>
                  <p className="text-sm font-semibold text-finova-primary">
                    {item.balance}
                  </p>
                </div>
              ))}
            </div>
          </article>
        </section>

        <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <article className="rounded-2xl border border-slate-200 bg-finova-white p-6 shadow-sm transition hover:border-finova-primary hover:bg-finova-accent hover:shadow-md">
            <div className="rounded-lg bg-finova-primary px-3 py-2 text-sm font-semibold text-finova-white">
              Credit Cards
            </div>
            <div className="mt-4 space-y-4 text-sm">
              {creditCards.map((card) => (
                <div
                  key={card.name}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"
                >
                  <p className="font-medium text-finova-text">{card.name}</p>
                  <p className="text-xs text-finova-muted">
                    Balance {card.balance}
                  </p>
                  <p className="text-xs text-finova-muted">
                    Available {card.available}
                  </p>
                </div>
              ))}
            </div>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-finova-white p-6 shadow-sm transition hover:border-finova-primary hover:bg-finova-accent hover:shadow-md">
            <div className="rounded-lg bg-finova-primary px-3 py-2 text-sm font-semibold text-finova-white">
              Auto Loan
            </div>
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm">
              <p className="font-medium text-finova-text">Auto Loan</p>
              <p className="text-xs text-finova-muted">Balance $12,840.00</p>
              <p className="text-xs text-finova-muted">Next payment $312.50</p>
              <p className="text-xs text-finova-muted">Due {nextDueDate}</p>
            </div>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-finova-white p-6 shadow-sm transition hover:border-finova-primary hover:bg-finova-accent hover:shadow-md">
            <div className="rounded-lg bg-gradient-to-r from-finova-secondary to-finova-accent px-3 py-2 text-sm font-semibold text-finova-white">
              Personalized Offers
            </div>
            <div className="mt-4 space-y-3 text-sm">
              {offers.map((offer) => (
                <div
                  key={offer.title}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"
                >
                  <p className="font-medium text-finova-text">{offer.title}</p>
                  <p className="text-xs text-finova-muted">{offer.description}</p>
                </div>
              ))}
            </div>
          </article>
        </section>
      </main>

      <button
        type="button"
        onClick={() => setIsChatOpen((prev) => !prev)}
        className={`fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-[#4285F4] text-white shadow-lg transition hover:bg-finova-accent ${
          isChatOpen ? '' : 'animate-pulse'
        }`}
        aria-label="Open chatbot"
      >
        <span className="text-xl">💬</span>
      </button>

      {isChatOpen && (
        <div className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-[2px] clown-overlay pointer-events-none" />
      )}

      <ChatPanel
        isOpen={isChatOpen}
        messages={messages}
        input={chatInput}
        onInputChange={handleChatInputChange}
        onSend={handleSendMessage}
        onClose={() => setIsChatOpen(false)}
        isSending={isSendingChat}
        isInputLocked={isEligibilityLoading}
        inputPlaceholder={activeInputRequest?.placeholder}
        inputHelperText={activeInputRequest?.helperText}
        inputType={activeInputRequest?.mask ? 'password' : 'text'}
        inputMode={activeInputRequest?.inputMode}
        inputMaxLength={activeInputRequest?.maxLength}
        hasActionButton={messages.some(
          (message) => Boolean(message.button) || (message.buttons?.length ?? 0) > 0
        )}
        onActionButton={handleActionButton}
      />
    </div>
  )
}

export default Dashboard
