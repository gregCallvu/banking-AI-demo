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

const usStates = [
  'AL',
  'AK',
  'AZ',
  'AR',
  'CA',
  'CO',
  'CT',
  'DE',
  'FL',
  'GA',
  'HI',
  'ID',
  'IL',
  'IN',
  'IA',
  'KS',
  'KY',
  'LA',
  'ME',
  'MD',
  'MA',
  'MI',
  'MN',
  'MS',
  'MO',
  'MT',
  'NE',
  'NV',
  'NH',
  'NJ',
  'NM',
  'NY',
  'NC',
  'ND',
  'OH',
  'OK',
  'OR',
  'PA',
  'RI',
  'SC',
  'SD',
  'TN',
  'TX',
  'UT',
  'VT',
  'VA',
  'WA',
  'WV',
  'WI',
  'WY',
]

const loanMockSteps = [
  {
    id: 'name',
    title: 'Name',
    fields: [
      { name: 'firstName', label: 'First Name', type: 'text' },
      { name: 'lastName', label: 'Last Name', type: 'text' },
    ],
  },
  {
    id: 'dob',
    title: 'Date of Birth',
    fields: [{ name: 'dateOfBirth', label: 'Date of Birth', type: 'date' }],
  },
  {
    id: 'ssn',
    title: 'Social Security Number',
    fields: [{ name: 'ssn', label: 'Social Security Number', type: 'ssn' }],
  },
  {
    id: 'address',
    title: 'Address',
    fields: [
      { name: 'addressLine1', label: 'Address Line 1', type: 'text' },
      { name: 'addressLine2', label: 'Address Line 2', type: 'text', optional: true },
      { name: 'city', label: 'City', type: 'text' },
      { name: 'state', label: 'State', type: 'select' },
      { name: 'zip', label: 'ZIP Code', type: 'zip' },
    ],
  },
  {
    id: 'employment',
    title: 'Employment Status',
    fields: [{ name: 'employmentStatus', label: 'Employment Status', type: 'radio' }],
  },
  {
    id: 'income',
    title: 'Annual Income',
    fields: [{ name: 'annualIncome', label: 'Annual Income', type: 'currency' }],
  },
]

const mockLoanPrefill = {
  firstName: 'Greg',
  lastName: 'Wilwerding',
  addressLine1: '123 Market Street',
  addressLine2: 'Suite 500',
  city: 'San Francisco',
  state: 'CA',
  zip: '94105',
}

const currencyFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 0,
})

const formatCurrencyValue = (value) => {
  if (value === null || value === undefined || value === '') return ''
  const numericValue = Number(value)
  if (Number.isNaN(numericValue)) return ''
  return `$${currencyFormatter.format(numericValue)}`
}

const formatSsnValue = (value) => {
  const digits = String(value ?? '').replace(/\D/g, '').slice(0, 9)
  if (digits.length <= 3) return digits
  if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`
}

const getMockLoanStepPrompt = (stepId) => {
  switch (stepId) {
    case 'name':
      return 'Let’s start with your name.'
    case 'dob':
      return 'What is your date of birth?'
    case 'ssn':
      return 'Please share your Social Security number.'
    case 'address':
      return 'What is your current address?'
    case 'employment':
      return 'What is your employment status?'
    case 'income':
      return 'What is your annual income?'
    default:
      return 'Please provide the next details.'
  }
}

const formatMockLoanFieldValue = (field, rawValue) => {
  if (rawValue === null || rawValue === undefined || rawValue === '') {
    return field.optional ? 'Not provided' : ''
  }
  if (field.type === 'ssn') {
    return formatSsnValue(rawValue)
  }
  if (field.type === 'currency') {
    return formatCurrencyValue(rawValue)
  }
  return String(rawValue)
}

const formatMockLoanSubmission = (stepConfig, data) => {
  if (!stepConfig) return ''
  const lines = stepConfig.fields
    .map((field) => formatMockLoanFieldValue(field, data?.[field.name]))
    .filter(Boolean)
  return lines.join('\n')
}

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
  isMcpActive,
  isMockLoanActive,
  mockLoanStepIndex,
  mockLoanData,
  onMockLoanChange,
  onMockLoanSubmit,
  isMockLoanLoading,
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
        {messages.map((message, index) => {
          const isActivePrompt =
            message.isMcpPrompt && index === messages.length - 1
          const isActiveMockStep =
            message.mockLoanStep != null && index === messages.length - 1
          const stepConfig =
            isActiveMockStep && mockLoanStepIndex != null
              ? loanMockSteps[mockLoanStepIndex]
              : null
          return (
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
                  : 'bg-[#97B9F4] text-finova-text'
              }`}
            >
              {message.text}
              {isActiveMockStep && stepConfig && (
                <form className="mt-3 space-y-3" onSubmit={onMockLoanSubmit}>
                  {stepConfig.fields.map((field) => {
                    if (field.type === 'radio') {
                      return (
                        <div key={field.name} className="space-y-2 text-xs">
                          <p className="font-semibold text-finova-text">
                            {field.label}
                          </p>
                          {['Employed', 'Self-Employed', 'Unemployed', 'Retired'].map(
                            (option) => (
                              <label
                                key={option}
                                className="flex items-center gap-2 text-finova-text"
                              >
                                <input
                                  type="radio"
                                  name={field.name}
                                  value={option}
                                  checked={mockLoanData?.[field.name] === option}
                                  onChange={(event) =>
                                    onMockLoanChange(
                                      field.name,
                                      event.target.value,
                                      field.type
                                    )
                                  }
                                />
                                {option}
                              </label>
                            )
                          )}
                        </div>
                      )
                    }

                    if (field.type === 'select') {
                      return (
                        <label key={field.name} className="space-y-1 text-xs">
                          <span className="font-semibold text-finova-text">
                            {field.label}
                          </span>
                          <select
                            value={mockLoanData?.[field.name] ?? ''}
                            onChange={(event) =>
                              onMockLoanChange(
                                field.name,
                                event.target.value,
                                field.type
                              )
                            }
                            className="w-full rounded-[8px] border border-slate-200 bg-white px-3 py-2 text-xs text-finova-text"
                          >
                            <option value="">Select</option>
                            {usStates.map((state) => (
                              <option key={state} value={state}>
                                {state}
                              </option>
                            ))}
                          </select>
                        </label>
                      )
                    }

                    const value = mockLoanData?.[field.name] ?? ''
                    const displayValue =
                      field.type === 'ssn'
                        ? formatSsnValue(value)
                        : field.type === 'currency'
                          ? formatCurrencyValue(value)
                          : value
                    const inputType = field.type === 'date' ? 'date' : 'text'
                    const inputMode =
                      field.type === 'ssn' ||
                      field.type === 'zip' ||
                      field.type === 'currency'
                        ? 'numeric'
                        : undefined
                    const placeholder = field.optional
                      ? 'Optional'
                      : field.type === 'ssn'
                        ? '###-##-####'
                        : field.type === 'zip'
                          ? '#####'
                          : field.type === 'currency'
                            ? '$0'
                            : ''
                    return (
                      <label key={field.name} className="space-y-1 text-xs">
                        <span className="font-semibold text-finova-text">
                          {field.label}
                        </span>
                        <input
                          type={inputType}
                          value={displayValue}
                          onChange={(event) =>
                            onMockLoanChange(
                              field.name,
                              event.target.value,
                              field.type
                            )
                          }
                          inputMode={inputMode}
                          placeholder={placeholder}
                          className="w-full rounded-[8px] border border-slate-200 bg-white px-3 py-2 text-xs text-finova-text"
                        />
                      </label>
                    )
                  })}
                  <button
                    type="submit"
                    disabled={isMockLoanLoading}
                    className="mt-2 w-full rounded-full bg-[#4285F4] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white shadow-sm transition hover:bg-finova-primary/90 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {mockLoanStepIndex === loanMockSteps.length - 1
                      ? 'Submit'
                      : 'Next'}
                  </button>
                </form>
              )}
              {isActivePrompt && (
                <form className="mt-3 space-y-2" onSubmit={onSend}>
                  <div className="flex items-center gap-2">
                    <input
                      type={inputType ?? 'text'}
                      value={input}
                      onChange={onInputChange}
                      placeholder={inputPlaceholder ?? 'Enter your response'}
                      inputMode={inputMode}
                      maxLength={inputMaxLength}
                      className="flex-1 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs text-finova-text outline-none transition focus:border-finova-accent focus:ring-2 focus:ring-finova-accent/20"
                      disabled={isSending || isInputLocked}
                    />
                    <button
                      type="submit"
                      disabled={isSending || isInputLocked || input.trim().length === 0}
                      className="rounded-full bg-[#4285F4] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white shadow-sm transition hover:bg-finova-primary/90 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      {isSending ? 'Sending' : 'Send'}
                    </button>
                  </div>
                  {inputHelperText && (
                    <p className="text-[11px] text-finova-muted">{inputHelperText}</p>
                  )}
                </form>
              )}
              {message.embedUrl && (
                <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
                  <iframe
                    title="Secure application"
                    src={message.embedUrl}
                    className="h-72 w-full bg-white"
                  />
                </div>
              )}
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
                  className={`mt-3 inline-flex w-full items-center justify-center rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-wide shadow-sm transition ${
                    message.button.variant === 'secondary'
                      ? 'border border-[#4285F4] bg-white text-[#4285F4] hover:bg-finova-accent'
                      : 'bg-[#4285F4] text-white hover:bg-finova-primary/90'
                  }`}
                >
                  {message.button.label}
                </a>
              )}
            </div>
          </div>
          )
        })}
        <div ref={endRef} />
      </div>

      {!isMcpActive && !isMockLoanActive && (
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
      )}
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
  const [isMockLoanActive, setIsMockLoanActive] = useState(false)
  const [mockLoanStepIndex, setMockLoanStepIndex] = useState(null)
  const [mockLoanData, setMockLoanData] = useState(mockLoanPrefill)
  const [isMockLoanLoading, setIsMockLoanLoading] = useState(false)
  const [mockLoanActionUrl, setMockLoanActionUrl] = useState(null)
  const lastPrefillFieldId = useRef(null)
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

  useEffect(() => {
    if (!activeInputRequest?.fieldId) return
    if (lastPrefillFieldId.current === activeInputRequest.fieldId) return
    lastPrefillFieldId.current = activeInputRequest.fieldId
    if (activeInputRequest.prefillValue !== undefined) {
      setChatInput(String(activeInputRequest.prefillValue))
    } else {
      setChatInput('')
    }
  }, [activeInputRequest])

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
      const mcpInput = activeInputRequest?.sessionId
        ? {
            sessionId: activeInputRequest.sessionId,
            fieldId: activeInputRequest.fieldId,
          }
        : null
      const response = await fetch('http://localhost:3001/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: trimmed,
          actionIntent,
          inputRequest: mcpInput,
        }),
      })

      const payload = await response.json()
      const isMockLoanStart = Boolean(payload.mockLoanFlow?.start)
      const botMessage = {
        id: `bot-${Date.now() + 1}`,
        role: 'bot',
        text:
          payload.reply ||
          'Sorry, I could not get a response from the assistant.',
        isLoading: Boolean(payload.loading),
        isMcpPrompt: Boolean(payload.inputRequest?.sessionId),
        mockLoanStep: isMockLoanStart ? 0 : null,
        button: payload.button
          ? {
              ...payload.button,
              label: payload.buttonText ?? payload.button.label,
            }
          : null,
        buttons: payload.buttons ?? null,
        embedUrl: payload.embedUrl ?? null,
      }
      setMessages((prev) => [...prev, botMessage])
      setActiveInputRequest(payload.inputRequest ?? null)

      if (isMockLoanStart) {
        setIsMockLoanActive(true)
        setMockLoanStepIndex(0)
        setMockLoanData(mockLoanPrefill)
        setIsMockLoanLoading(false)
        setMockLoanActionUrl(payload.mockLoanFlow?.actionUrl ?? null)
      }

      if (payload.loading) {
        setIsEligibilityLoading(true)
        setActiveInputRequest(null)
        const duration = Number(payload.loading.durationMs) || 5000
        window.setTimeout(() => {
          const approvalText =
            payload.loading.approvalMessage ?? 'Application result ready.'
          const completionText = payload.loading.completionMessage
          const followupText = completionText
            ? `${approvalText}\n\n${completionText}`
            : approvalText
          setMessages((prev) => [
            ...prev,
            {
              id: `bot-${Date.now() + 2}`,
              role: 'bot',
              text: followupText,
              button: payload.loading.completionButton ?? null,
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
      const maxLength = activeInputRequest?.maxLength
      setChatInput(
        Number.isFinite(maxLength) ? digitsOnly.slice(0, maxLength) : digitsOnly
      )
      return
    }
    setChatInput(nextValue)
  }

  const handleMockLoanChange = (name, value, type) => {
    let nextValue = value
    if (type === 'ssn') {
      nextValue = value.replace(/\D/g, '').slice(0, 9)
    } else if (type === 'zip') {
      nextValue = value.replace(/\D/g, '').slice(0, 5)
    } else if (type === 'currency') {
      nextValue = value.replace(/\D/g, '').slice(0, 9)
    }
    setMockLoanData((prev) => ({ ...prev, [name]: nextValue }))
  }

  const handleMockLoanSubmit = (event) => {
    event.preventDefault()
    if (isMockLoanLoading || mockLoanStepIndex == null) return

    const currentStep = loanMockSteps[mockLoanStepIndex]
    const submissionText = formatMockLoanSubmission(currentStep, mockLoanData)
    if (submissionText) {
      setMessages((prev) => [
        ...prev,
        {
          id: `user-${Date.now()}`,
          role: 'user',
          text: submissionText,
        },
      ])
    }

    if (mockLoanStepIndex < loanMockSteps.length - 1) {
      const nextIndex = mockLoanStepIndex + 1
      const nextStep = loanMockSteps[nextIndex]
      setMockLoanStepIndex(nextIndex)
      setMessages((prev) => [
        ...prev,
        {
          id: `bot-${Date.now() + 1}`,
          role: 'bot',
          text: getMockLoanStepPrompt(nextStep.id),
          mockLoanStep: nextIndex,
        },
      ])
      return
    }

    setIsMockLoanLoading(true)
    const loadingId = `bot-${Date.now() + 1}`
    setMessages((prev) => [
      ...prev,
      {
        id: loadingId,
        role: 'bot',
        text: 'Checking eligibility with our underwriting platform…',
        isLoading: true,
      },
    ])

    window.setTimeout(() => {
      setMessages((prev) => {
        const nextMessages = prev.map((message) =>
          message.id === loadingId ? { ...message, isLoading: false } : message
        )
        return [
          ...nextMessages,
          {
            id: `bot-${Date.now() + 2}`,
            role: 'bot',
            text:
              "You’ve been approved for a personal loan up to $25,000. Please click the link below to set your loan amount, see your interest rates, prove your identity, and sign loan documents in our Secure Loan Center.",
            button: mockLoanActionUrl
              ? {
                  label: 'Complete Loan Application',
                  url: mockLoanActionUrl,
                  openInNewWindow: true,
                }
              : null,
          },
        ]
      })
      setIsMockLoanLoading(false)
      setIsMockLoanActive(false)
      setMockLoanStepIndex(null)
    }, 5000)
  }

  const handleActionButton = async (button) => {
    if (button.url) {
      if (button.embedInChat) {
        setMessages((prev) => [
          ...prev,
          {
            id: `bot-${Date.now() + 1}`,
            role: 'bot',
            text: '',
            embedUrl: button.url,
          },
        ])
      } else {
        window.open(button.url, '_blank', 'noopener,noreferrer')
      }
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
        isInputLocked={isEligibilityLoading || isMockLoanLoading}
        isMcpActive={Boolean(activeInputRequest?.sessionId)}
        isMockLoanActive={isMockLoanActive}
        mockLoanStepIndex={mockLoanStepIndex}
        mockLoanData={mockLoanData}
        onMockLoanChange={handleMockLoanChange}
        onMockLoanSubmit={handleMockLoanSubmit}
        isMockLoanLoading={isMockLoanLoading}
        inputPlaceholder={activeInputRequest?.placeholder}
        inputHelperText={
          activeInputRequest?.helperText ||
          (activeInputRequest?.stepNumber && activeInputRequest?.totalSteps
            ? `Step ${activeInputRequest.stepNumber} of ${activeInputRequest.totalSteps}`
            : null)
        }
        inputType={
          activeInputRequest?.mask
            ? 'password'
            : activeInputRequest?.inputType ?? 'text'
        }
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
