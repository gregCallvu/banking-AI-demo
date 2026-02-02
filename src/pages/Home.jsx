import { useEffect, useMemo, useRef, useState } from 'react'

const products = [
  {
    title: 'Low-Interest Loans',
    description: 'Flexible personal and auto loans with competitive rates.',
    icon: '💸',
  },
  {
    title: 'Credit Card Rewards',
    description: 'Earn points on travel, dining, and everyday purchases.',
    icon: '💳',
  },
  {
    title: 'Mobile Banking App',
    description: 'Deposit checks, move money, and stay in control on the go.',
    icon: '📱',
  },
  {
    title: 'Savings Account Bonuses',
    description: 'Boost your savings with tiered bonuses and round-ups.',
    icon: '🏦',
  },
]

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
            type="text"
            value={input}
            onChange={onInputChange}
            placeholder="Type your message..."
            className="flex-1 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-finova-text outline-none transition focus:border-finova-accent focus:ring-2 focus:ring-finova-accent/20"
            disabled={isSending}
          />
          <button
            type="submit"
            disabled={isSending || input.trim().length === 0}
            className="rounded-full bg-[#4285F4] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white shadow-sm transition hover:bg-finova-primary/90 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {isSending ? 'Sending' : 'Send'}
          </button>
        </div>
      </form>
    </aside>
  )
}

function Home({ onSignIn }) {
  const [username, setUsername] = useState('greg@callvu.com')
  const [password, setPassword] = useState('securePassword_123')
  const [showPassword, setShowPassword] = useState(false)
  const [status, setStatus] = useState({ type: 'idle', message: '' })
  const [isChatOpen, setIsChatOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [chatInput, setChatInput] = useState('')
  const [messages, setMessages] = useState(initialMessages)
  const [isSendingChat, setIsSendingChat] = useState(false)
  const [offerIndex, setOfferIndex] = useState(0)
  const canSubmit = useMemo(() => {
    return username.trim().length > 0 && password.trim().length > 0
  }, [username, password])

  useEffect(() => {
    if (products.length <= 1) return

    const intervalId = setInterval(() => {
      setOfferIndex((prev) => (prev + 1) % products.length)
    }, 20000)

    return () => clearInterval(intervalId)
  }, [])

  const handleSubmit = async (event) => {
    event.preventDefault()

    if (!canSubmit) {
      setStatus({
        type: 'error',
        message: 'Please enter both a username and password.',
      })
      return
    }

    setIsSubmitting(true)
    setStatus({ type: 'success', message: 'Redirecting to your dashboard...' })
    setTimeout(() => {
      setIsSubmitting(false)
      onSignIn?.()
    }, 300)
  }

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
        button: payload.button
          ? {
              ...payload.button,
              label: payload.buttonText ?? payload.button.label,
            }
          : null,
        buttons: payload.buttons ?? null,
      }
      setMessages((prev) => [...prev, botMessage])
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

  const handleActionButton = async (button) => {
    if (button.url) {
      window.open(button.url, '_blank', 'noopener,noreferrer')
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
          <a
            href="#"
            className="flex items-center gap-2 text-lg font-semibold text-white hover:text-finova-accent"
            aria-label="Go to landing page"
          >
            Finova Bank
          </a>
          <nav className="hidden items-center gap-6 text-sm font-medium md:flex">
            {['Home', 'Products', 'Offers', 'About', 'Contact'].map((item) => (
              <a key={item} className="text-white hover:text-finova-accent" href="#">
                {item}
              </a>
            ))}
          </nav>
          <button className="text-sm font-medium text-finova-white md:hidden">
            Menu
          </button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-10">
        <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="flex flex-col justify-center gap-6 lg:col-span-7">
            <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-finova-accent via-finova-white to-finova-white p-8 shadow-sm">
              <p className="text-sm font-semibold uppercase tracking-wide text-finova-primary">
                Finova Bank
              </p>
              <h2 className="mt-3 text-3xl font-semibold text-finova-primary">
                Smart Banking Made Simple
              </h2>
              <p className="mt-4 text-sm text-finova-text">
                Manage your money, track goals, and stay ahead with personalized insights.
              </p>
              <div className="mt-4 rounded-xl border border-slate-200 bg-finova-accent px-4 py-3 text-sm text-finova-text">
                <span className="font-semibold text-finova-primary">
                  {products[offerIndex].title}
                </span>
                <span className="ml-2 text-finova-muted">
                  {products[offerIndex].description}
                </span>
              </div>
              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => onSignIn?.()}
                  className="rounded-full bg-[#4285F4] px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-finova-primary/90"
                >
                  Sign In
                </button>
                <button
                  type="button"
                  className="rounded-full border border-finova-primary bg-finova-white px-5 py-2 text-sm font-semibold text-finova-primary hover:bg-finova-accent"
                >
                  Open an Account
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {products.slice(0, 2).map((product) => (
                <div
                  key={product.title}
                  className="rounded-2xl border border-slate-200 bg-finova-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-finova-primary hover:bg-finova-accent hover:shadow-md"
                >
                  <div className="flex items-center gap-3 text-2xl">
                    <span>{product.icon}</span>
                    <h3 className="text-base font-semibold text-finova-primary">
                      {product.title}
                    </h3>
                  </div>
                  <p className="mt-3 text-sm text-finova-text">{product.description}</p>
                  <button className="mt-4 rounded-full border border-finova-primary bg-finova-white px-3 py-1 text-sm font-semibold text-finova-primary hover:bg-finova-accent">
                    Learn More
                  </button>
                </div>
              ))}
            </div>
          </div>

          <article className="rounded-2xl border border-slate-200 bg-finova-white p-6 shadow-sm lg:col-span-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-finova-primary">
                  Secure Access
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-finova-primary">
                  Sign in to Finova Bank
                </h2>
              </div>
              <div className="hidden h-10 w-10 items-center justify-center rounded-full bg-finova-accent text-sm font-semibold text-finova-primary md:flex">
                FB
              </div>
            </div>
            <p className="mt-2 text-sm text-finova-text">
              Access accounts, payments, and insights in one secure place.
            </p>

            <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <label className="text-sm font-medium text-finova-text" htmlFor="tile-username">
                  Username
                </label>
                <input
                  id="tile-username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-finova-white px-4 py-2 text-sm text-finova-text shadow-sm outline-none transition focus:border-finova-accent focus:ring-2 focus:ring-finova-accent/20"
                  placeholder="demo"
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-finova-text" htmlFor="tile-password">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="tile-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-finova-white px-4 py-2 pr-10 text-sm text-finova-text shadow-sm outline-none transition focus:border-finova-accent focus:ring-2 focus:ring-finova-accent/20"
                    placeholder="password123"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute inset-y-0 right-2 flex items-center text-finova-text/60 hover:text-finova-primary"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        className="h-5 w-5"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M3 3l18 18M10.8 10.9a3 3 0 004.3 4.3M9.9 4.3A9.1 9.1 0 0112 4c5.2 0 9.3 3.8 10 8-.2 1.4-.8 2.7-1.6 3.9M6.2 6.2C4.4 7.5 3.2 9.1 2 12c.8 3.6 4.1 8 10 8a10 10 0 004.2-.9"
                        />
                      </svg>
                    ) : (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        className="h-5 w-5"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M2 12s3.8-7 10-7 10 7 10 7-3.8 7-10 7-10-7-10-7Z"
                        />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
              <button
                type="submit"
                disabled={!canSubmit || isSubmitting}
                className="w-full rounded-lg bg-[#4285F4] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-finova-primary/90 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {isSubmitting ? 'Signing In...' : 'Sign In'}
              </button>
            </form>
            <button
              type="button"
              className="mt-4 w-full rounded-lg border border-finova-primary bg-finova-white px-4 py-2 text-sm font-semibold text-finova-primary shadow-sm transition hover:bg-finova-accent"
            >
              Open a New Account
            </button>
          </article>
        </section>

        <section className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {products.map((product) => (
            <article
              key={product.title}
              className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-finova-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-finova-primary hover:bg-finova-accent hover:shadow-md"
            >
              <div className="flex items-center gap-3 text-2xl">
                <span>{product.icon}</span>
                <h3 className="text-lg font-semibold text-finova-primary">
                  {product.title}
                </h3>
              </div>
              <p className="mt-3 text-sm text-finova-text">{product.description}</p>
              <button className="mt-6 rounded-full border border-finova-primary bg-finova-white px-3 py-1 text-sm font-semibold text-finova-primary hover:bg-finova-accent">
                Learn More
              </button>
            </article>
          ))}
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
        <div className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-[2px] pointer-events-none" />
      )}

      <ChatPanel
        isOpen={isChatOpen}
        messages={messages}
        input={chatInput}
        onInputChange={(event) => setChatInput(event.target.value)}
        onSend={handleSendMessage}
        onClose={() => setIsChatOpen(false)}
        isSending={isSendingChat}
        hasActionButton={messages.some(
          (message) => Boolean(message.button) || (message.buttons?.length ?? 0) > 0
        )}
        onActionButton={handleActionButton}
      />

    </div>
  )
}

export default Home
