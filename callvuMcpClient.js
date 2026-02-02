const buildAuthHeaders = (token) => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
})

const normalizeBaseUrl = (baseUrl) => baseUrl.replace(/\/+$/, '')

export const createCallvuMcpClient = ({
  orgId = process.env.CALLVU_ORG_ID,
  token = process.env.CALLVU_MCP_TOKEN,
  baseUrl = process.env.CALLVU_MCP_BASE_URL,
} = {}) => {
  if (!orgId || !token || !baseUrl) {
    throw new Error('Callvu MCP configuration is missing.')
  }

  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)

  const request = async (path, options = {}) => {
    const response = await fetch(`${normalizedBaseUrl}${path}`, {
      ...options,
      headers: {
        ...buildAuthHeaders(token),
        ...options.headers,
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Callvu MCP request failed: ${response.status} ${errorText}`)
    }

    return response.json()
  }

  const listTools = () => request(`/orgs/${orgId}/tools`)

  const invokeTool = (toolName, payload = {}) =>
    request(`/orgs/${orgId}/tools/${toolName}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })

  return {
    orgId,
    request,
    listTools,
    invokeTool,
  }
}

