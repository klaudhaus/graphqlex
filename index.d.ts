export function noOpTag (strings: TemplateStringsArray, ...exps: unknown[]) : string
export function gql (strings: TemplateStringsArray, ...exps: unknown[]) : string

type Fetch = (input: RequestInfo, init?: RequestInit) => Promise<Response>
type ApiOptions = {
  wsUrl?: string,
  headers?: object,
  fetch?: Fetch,
  onError?: (message: string, error: object) => any
}

export class Api {
  url: string
  wsUrl: string
  fetch: Fetch
  headers: object

  run: (query: string, variables?: object) => Promise<object>

  subscribe: (query: string, variables?: object, channelName?: string) => { onData: () => void }

  constructor( url: string, options?: ApiOptions )
}

export class Socket {
  subscriptions: object
  webSocket: WebSocket

  constructor(wsUrl: string)
}
