const standardOptions = {
  method: "POST",
  headers: {
    "Content-type": "application/json"
  }
}

const randChannelName = () => (new Date().getTime()).toString().slice(-5)

/**
 * A tagged template literal function that behaves like a non-tagged template.
 * This is used by this library to provide the `gql` tag.
 * Can also be useful in other cases, for example as a `css` tag
 * for computed styles during development - and to obtain a static version in the production build.
 * The point of using such tags instead of just a regular non-tagged literal
 * is to fool IDEs into providing language support for tagged content.
 *
 * @param strings
 * @param exps
 * @returns {string}
 */
export const noOpTag = (strings, ...exps) => {
  return strings.map((str, i) => str + (i in exps ? exps[i] : "")).join("")
}

/**
 * Provides support for IDE tooling by mimicking graphql-tag.
 * Is actually just a standard string interpolation tag.
 */
export const gql = noOpTag

/**
 * Represents a remote GraphQL API connection.
 */
export class Api {
  /**
   * Construct a new Api instance with the given http and websockets URLs.
   * Second parameter can specify options object for wsUrl and any additional headers.
   * If the websockets URL is not provided it is derived by replacing the protocol on the http URL.
   * @param url
   * @param wsUrl
   * @param headers
   * @param fetch Fetch API implementation, e.g. node-fetch in node, defaults to window.fetch
   */
  constructor (url, {
    wsUrl,
    headers = {},
    fetch
  } = {}) {
    const protocol = url.match(/^(https?):\/\//)[1]
    if (!protocol) throw new Error(`Unexpected API URL [${url}]`)
    this.url = url

    const isSecure = protocol.match(/s$/)
    this.wsUrl = wsUrl || [`ws${isSecure ? "s" : ""}:`, url.split("//").slice(1)].join("//")
    this.fetch = fetch

    this.headers = headers
  }

  set log (fn) {
    if (typeof fn === "function") {
      this._log = fn
      if (this.socket) this.socket.log = fn
    }
  }

  /**
   * Execute a query or mutation.
   * @param query
   * @param variables
   * @returns {Promise<void>}
   */
  async run (query, variables) {
    const headers = { ...standardOptions.headers, ...this.headers }

    const fetch = this.fetch || window.fetch
    const response = await fetch(this.url, {
      ...standardOptions,
      headers,
      body: JSON.stringify({ query, variables })
    })
    const { errors, data } = await response.json()
    if (Array.isArray(errors) && errors.length && errors[0].message) {
      throw new Error(`GraphQL Server Error: ${errors[0].message}`)
    }
    return data
  }

  subscribe (query, variables = {}, channelName = randChannelName()) {
    this.socket = this.socket || new Socket(this.wsUrl)
    if (this.log) this.socket.log = this.log

    if (this.socket.subscriptions[channelName]) {
      throw new Error(`Subscription already exists for channel [${channelName}]`)
    }

    const message = {
      id: channelName,
      type: "start",
      payload: {
        query,
        variables
      }
    }

    setTimeout(() => {
      this.socket.webSocket.send(JSON.stringify(message))
    }, 100)

    const subscription = this.socket.subscriptions[channelName] = {}
    return { onData: handler => { subscription.onData = handler } }
  }
}

class Socket {
  /**
   * Construct a new Socket instance with the given websocket URL
   * @param wsUrl
   */
  constructor (wsUrl) {
    this.subscriptions = {}

    this.webSocket = new WebSocket(wsUrl, "graphql-subscriptions")

    this.webSocket.onopen = () => {
      const message = {
        type: "connection_init",
        payload: {}
      }

      this.webSocket.send(JSON.stringify((message)))
    }

    this.webSocket.onmessage = event => {
      const data = JSON.parse(event.data)
      let msg

      if (["subscription_fail", "error"].includes(data.type)) {
        let msg = `GraphQL ${data.type} for channel ${data.id} `
        msg += (data.payload && data.payload.message) || ""
        throw new Error(msg)
      } else if (data.type === "data") {
        if (this.subscriptions[data.id] && typeof this.subscriptions[data.id].onData === "function") {
          return this.subscriptions[data.id].onData(data.payload.data)
        } else msg = `data received for channel [${data.id}] with no subscription handler`
      } else if (data.type !== "ka") {
        msg = {
          connection_ack: `[${data.id}] connection_ack, the handshake is complete`,
          init_fail: `[${data.id}] init_fail returned from the WebSocket server`,
          subscription_success: `[${data.id}] subscription_success`
        }[data.type]
        msg = msg || `unexpected message type [${data.type}] received from WebSocket server`
      }

      if (msg && typeof this.log === "function") this.log(`graphqlx: ${msg}`)
    }
  }
}
