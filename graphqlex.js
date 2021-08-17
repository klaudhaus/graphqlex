const standardOptions = {
  method: "POST",
  headers: {
    "Content-type": "application/json",
    Accept: "application/json"
  }
}

const randChannelName = () => Math.ceil(Math.random() * 1000000).toString()

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
   * @param onError A function with the signature (message: string, error: object) => void
   */
  constructor (url, {
    wsUrl,
    headers = {},
    fetch = window.fetch.bind(window),
    onError
  } = {}) {
    const protocol = url.match(/^(https?):\/\//)[1]
    if (!protocol) throw new Error(`Unexpected API URL [${url}]`)
    const isSecure = protocol.match(/s$/)

    this.url = url
    this.wsUrl = wsUrl || [`ws${isSecure ? "s" : ""}:`, url.split("//").slice(1)].join("//")
    this.fetch = fetch
    this.headers = headers
    this.onError = (err) => {
      const msg = typeof err === "string" ? err
        : (err && err.message) || "GraphQL error. Try: Check network connection / Turn off ad blockers"
      if (typeof onError === "function") {
        onError(msg, err)
      }
      err = err instanceof Error ? err : new Error(msg)
      throw err
    }
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

    let response
    try {
      response = await this.fetch(this.url, {
        ...standardOptions,
        headers,
        body: JSON.stringify({ query, variables })
      })
    } catch (err) {
      this.onError(err)
    }
    const { errors, data } = await response.json()
    if (Array.isArray(errors) && errors.length) {
      this.onError(errors[0])
    }
    return data
  }

  subscribe (query, variables = {}, channelName = randChannelName()) {
    const message = {
      id: channelName,
      type: "start",
      payload: {
        query,
        variables
      }
    }
    const startSub = () => this.socket.webSocket.send(JSON.stringify(message))

    if (this.socket) {
      if (this.socket.subscriptions[channelName]) {
        throw new Error(`Subscription already exists for channel [${channelName}]`)
      }
      if (this.socket.connected) {
        startSub()
      } else {
        this.socket.connectedHandlers.push(startSub)
      }
    } else {
      this.socket = new Socket(this.wsUrl, this.headers, startSub)
      if (this.log) this.socket.log = this.log
    }

    const subscription = this.socket.subscriptions[channelName] = {}
    return { onData: handler => { subscription.onData = handler } }
  }
}

class Socket {
  /**
   * Construct a new Socket instance with the given websocket URL
   * @param wsUrl
   * @param headers
   * @param onConnected
   */
  constructor (wsUrl, headers = {}, onConnected = () => {}) {
    this.connected = false

    this.connectedHandlers = onConnected ? [onConnected] : []

    this.subscriptions = {}

    this.webSocket = new WebSocket(wsUrl, "graphql-subscriptions")

    this.webSocket.onopen = () => {
      const message = {
        type: "connection_init",
        payload: headers
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
        if (data.type === "connection_ack" && typeof onConnected === "function") {
          this.connected = true
          this.connectedHandlers.forEach(handler => handler())
        }
      }

      if (msg && typeof this.log === "function") this.log(`graphqlx: ${msg}`)
    }
  }
}
