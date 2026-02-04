const buildAuthHeaders = (token) => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
})

const normalizeBaseUrl = (baseUrl) => baseUrl.replace(/\/+$/, '')
const normalizeToolEndpoint = (toolEndpoint) =>
  `/${String(toolEndpoint || 'api/tool/{tool}').replace(/^\/+/, '')}`
const normalizeMcpEndpoint = (endpoint) =>
  `/${String(endpoint || 'api/mcp/getFormDetails').replace(/^\/+/, '')}`

export const createCallvuMcpClient = ({
  orgId = process.env.CALLVU_ORG_ID,
  token = process.env.CALLVU_MCP_TOKEN,
  baseUrl = process.env.CALLVU_MCP_BASE_URL,
  toolEndpoint = process.env.CALLVU_MCP_TOOL_ENDPOINT,
  formDetailsEndpoint = process.env.CALLVU_MCP_FORM_DETAILS_ENDPOINT,
} = {}) => {
  if (!orgId || !token || !baseUrl) {
    throw new Error('Callvu MCP configuration is missing.')
  }

  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
  const normalizedToolEndpoint = normalizeToolEndpoint(toolEndpoint)
  const normalizedFormDetailsEndpoint = normalizeMcpEndpoint(formDetailsEndpoint)

  const request = async (path, options = {}) => {
    let response
    try {
      response = await fetch(`${normalizedBaseUrl}${path}`, {
        ...options,
        headers: {
          ...buildAuthHeaders(token),
          ...options.headers,
        },
      })
    } catch (error) {
      const networkError = new Error(`Callvu MCP request failed: ${error.message}`)
      networkError.status = 0
      throw networkError
    }

    const rawText = await response.text()
    if (!response.ok) {
      const httpError = new Error(
        `Callvu MCP request failed: ${response.status} ${rawText}`
      )
      httpError.status = response.status
      httpError.body = rawText
      throw httpError
    }
    if (!rawText) {
      return {}
    }
    try {
      return JSON.parse(rawText)
    } catch (error) {
      const parseError = new Error(`Callvu MCP response JSON parse failed: ${rawText}`)
      parseError.status = response.status
      parseError.body = rawText
      throw parseError
    }
  }

  const rpcRequest = async (method, params = {}) => {
    const payload = {
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params,
    }
    let response
    try {
      response = await fetch(normalizedBaseUrl, {
        method: 'POST',
        headers: buildAuthHeaders(token),
        body: JSON.stringify(payload),
      })
    } catch (error) {
      const networkError = new Error(`Callvu MCP request failed: ${error.message}`)
      networkError.status = 0
      throw networkError
    }
    const rawText = await response.text()
    if (!response.ok) {
      const httpError = new Error(
        `Callvu MCP request failed: ${response.status} ${rawText}`
      )
      httpError.status = response.status
      httpError.body = rawText
      throw httpError
    }
    if (!rawText) {
      return {}
    }
    let parsed
    try {
      parsed = JSON.parse(rawText)
    } catch (error) {
      const parseError = new Error(`Callvu MCP response JSON parse failed: ${rawText}`)
      parseError.status = response.status
      parseError.body = rawText
      throw parseError
    }
    if (parsed?.error) {
      const rpcError = new Error(
        `Callvu MCP request failed: ${JSON.stringify(parsed.error)}`
      )
      rpcError.status = response.status
      rpcError.body = parsed.error
      throw rpcError
    }
    return parsed?.result ?? parsed
  }

  const listTools = () => rpcRequest('tools/list')

  const buildToolUrl = (toolName) => {
    if (normalizedToolEndpoint.includes('{tool}')) {
      return `${normalizedBaseUrl}${normalizedToolEndpoint.replace(
        '{tool}',
        toolName
      )}`
    }
    return `${normalizedBaseUrl}${normalizedToolEndpoint}/${toolName}`
  }

  const callTool = async (
    toolName,
    payload = {},
    { logPayload = false, logResponse = false } = {}
  ) => {
    if (logPayload) {
      console.info('Callvu MCP tool request payload:', payload)
    }
    let response
    try {
      response = await fetch(buildToolUrl(toolName), {
        method: 'POST',
        headers: buildAuthHeaders(token),
        body: JSON.stringify(payload),
      })
    } catch (error) {
      const networkError = new Error(`Callvu MCP request failed: ${error.message}`)
      networkError.status = 0
      throw networkError
    }
    const rawText = await response.text()
    if (!response.ok) {
      const httpError = new Error(
        `Callvu MCP request failed: ${response.status} ${rawText}`
      )
      httpError.status = response.status
      httpError.body = rawText
      throw httpError
    }
    if (!rawText) {
      return {}
    }
    let parsed
    try {
      parsed = JSON.parse(rawText)
    } catch (error) {
      const parseError = new Error(`Callvu MCP response JSON parse failed: ${rawText}`)
      parseError.status = response.status
      parseError.body = rawText
      throw parseError
    }
    if (logResponse) {
      console.info('Callvu MCP tool response:', parsed)
    }
    return parsed
  }

  const getFormDetails = async (
    formId,
    { logPayload = false, logResponse = false } = {}
  ) => {
    const payload = { formId: String(formId) }
    if (logPayload) {
      console.info('Callvu MCP getFormDetails payload:', payload)
    }
    let response
    try {
      response = await fetch(`${normalizedBaseUrl}${normalizedFormDetailsEndpoint}`, {
        method: 'POST',
        headers: buildAuthHeaders(token),
        body: JSON.stringify(payload),
      })
    } catch (error) {
      const networkError = new Error(`Callvu MCP request failed: ${error.message}`)
      networkError.status = 0
      throw networkError
    }
    const rawText = await response.text()
    if (!response.ok) {
      const httpError = new Error(
        `Callvu MCP request failed: ${response.status} ${rawText}`
      )
      httpError.status = response.status
      httpError.body = rawText
      throw httpError
    }
    if (!rawText) {
      return {}
    }
    let parsed
    try {
      parsed = JSON.parse(rawText)
    } catch (error) {
      const parseError = new Error(`Callvu MCP response JSON parse failed: ${rawText}`)
      parseError.status = response.status
      parseError.body = rawText
      throw parseError
    }
    if (logResponse) {
      console.info('Callvu MCP getFormDetails response:', parsed)
    }
    return parsed
  }

  const invokeTool = (toolName, payload = {}) =>
    request(`/orgs/${orgId}/tools/${toolName}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })

  return {
    orgId,
    request,
    listTools,
    callTool,
    invokeTool,
    getFormDetails,
  }
}

