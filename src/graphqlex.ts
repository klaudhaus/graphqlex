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
export const noOpTag = (strings: TemplateStringsArray, ...exps: string[]) => {
  return strings.map((str, i) => str + (i in exps ? exps[i] : "")).join("")
}

/**
 * Provides support for IDE tooling by mimicking graphql-tag.
 * Is actually just a standard string interpolation tag.
 */
export const gql = noOpTag

export type Fetch = (url: RequestInfo, init?: RequestInit) => Promise<Response>

export type ApiOptions = {
  wsUrl?: string
  headers?: object
  fetch?: Fetch
  onError?: (msg: string, err: Error) => void
}

export type Subscription = {
  /**
   * Add a data handler to this Subscription.
   */
  onData: (handler: SubscriptionDataHandler) => Subscription

  /**
   * Close the subscription.
   */
  close: () => void
}

export type SubscriptionDataHandler = (data: any) => any

/**
 * Represents a remote GraphQL API connection.
 */
export class Api {

  url: string
  wsUrl: string
  fetch: Fetch
  headers: object
  socket: Socket

  onError: (msg: string, err?: Error) => void
  /**
   * Construct a new Api instance with the given http and websockets URLs.
   * Second parameter can specify options object for wsUrl and any additional headers.
   * If the websockets URL is not provided it is derived by replacing the protocol on the http URL.
   */
  constructor (url: string, apiOptions: string | ApiOptions = {}) {
    const options: ApiOptions = typeof apiOptions === "string"
      ? { wsUrl: apiOptions }
      : apiOptions
    if (!options.fetch && typeof window === "undefined") {
      throw new Error("No fetch implementation provided and not operating in browser context")
    }
    options.fetch = options.fetch || window.fetch.bind(window)
    const protocol = url.match(/^(https?):\/\//)[1]
    if (!protocol) throw new Error(`Unexpected API URL [${url}]`)
    const isSecure = protocol.match(/s$/)

    this.url = url
    this.wsUrl = options.wsUrl || [`ws${isSecure ? "s" : ""}:`, url.split("//").slice(1)].join("//")
    this.fetch = options.fetch
    this.headers = options.headers
    this.onError = (err: Error | string) => {
      const msg = typeof err === "string"
        ? err
        : (err?.message) || "GraphQL error. Try: Check network connection / Turn off ad blockers"
      if (typeof options.onError === "function") {
        options.onError(msg, <Error>err)
      }
      err = err instanceof Error ? err : new Error(msg)
      throw err
    }
  }

  get log () {
    return this.socket.log
  }

  set log (fn) {
    if (typeof fn === "function") {
      if (this.socket) this.socket.log = fn
    }
  }

  /**
   * Execute a query or mutation.
   * @param query
   * @param variables
   * @returns {Promise<void>}
   */
  async run (query: string, variables: object = {}) {
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

  subscribe (query: string, variables: object = {}, channelName = randChannelName()): Subscription {
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

    const socketSubscription: SocketSubscription = this.socket.subscriptions[channelName] = {}
    const result: Subscription = {
      onData (handler) {
        socketSubscription.dataHandler = handler
        return result
      },
      close () {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete this.socket.subscriptions[channelName]
      }
    }
    return result
  }
}

export type SocketSubscription = {
  dataHandler?: (data: any) => any
}

class Socket {

  log: (msg: string) => void
  webSocket: WebSocket
  subscriptions: { [id: string]: SocketSubscription }
  connected: boolean
  connectedHandlers: Array<() => void>

  /**
   * Construct a new Socket instance with the given websocket URL
   */
  constructor (wsUrl: string, headers: object = {}, onConnected = () => {}) {
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
        const msg = `GraphQL ${data.type} for channel ${data.id} ${(data?.payload.message) || ""}`
        throw new Error(msg)
      } else if (data.type === "data") {
        if (this.subscriptions[data.id] && typeof this.subscriptions[data.id].dataHandler === "function") {
          return this.subscriptions[data.id].dataHandler(data.payload.data)
        } else msg = `data received for channel [${data.id}] with no subscription handler`
      } else if (data.type !== "ka") {
        const messages: { [code: string]: string } = {
          connection_ack: `[${data.id}] connection_ack, the handshake is complete`,
          init_fail: `[${data.id}] init_fail returned from the WebSocket server`,
          subscription_success: `[${data.id}] subscription_success`
        }
        msg = messages[data.type]
        msg = msg || `unexpected message type [${data.type}] received from WebSocket server`
        if (data.type === "connection_ack" && typeof onConnected === "function") {
          this.connected = true
          this.connectedHandlers.forEach(connHandler => connHandler())
        }
      }

      if (msg && typeof this.log === "function") this.log(`graphqlx: ${msg}`)
    }
  }
}
