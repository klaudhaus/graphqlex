# graphqlex

A minimal client library for executing GraphQL APIs, supporting both HTTP queries/mutations and WebSockets subscriptions.

```bash
npm install graphqlex
```

## Usage

```js
import { gql, Api } from "graphqlex"

const api = new Api("http://localhost:5000/graphql")

// Sample query taken from postgraphile tutorial
const query = gql`
  query {
    allPosts ( offset: 0 ) {
      nodes { 
        headline 
      }
    }
  }
`

// Postgraphile tutorial extended with live queries
const subscription = gql`
  subscription {
    allPosts ( offset: 0 ) {
      nodes { 
        headline 
      }
    }
  }
`

// Run a query
const result = await api.run(query) // you can pass variables too
const posts = result.allPosts.nodes
// posts is an array of objects with property headline


// Subscribe to a live query
api.subscribe({
  query: subscription, 
  channelName: "posts", // If missing a random channel name is assigned 
  onData: data => {
  	console.log(data.allPosts.nodes)
	}
)
```



## Why?

There are more powerful and advanced GraphQL client libraries out there including Apollo Client, which has lots of power, such as being able to validate queries, cache results etc. But you may find that all you need is to execute queries and mutations and connect to subscriptions. In that case GraphQLEx is smaller, more straightforward, and can be loaded directly into a modern browser via ES6 without being transpiled or bundled.

`graphqlex` doesn't parse, process or introspect your queries - it just executes them and marshals their responses back to your app. Because of that, it adds less code, along with the time taken to download and parse it on page load, and to execute it on each GraphQL operation. In a modern, fast JS runtime on a high-speed network you and your users may well not notice the difference, so whether this is an advantage depends on your situation.

`graphqlex` is published as a single ES6 module, suitable for loading directly in a browser application. In development, you would typically use something like `es-dev-server` to enable "naked" imports as shown above, or maybe look into using *import maps* as support rolls out across modern browsers. For production you would generally use a bundler such as rollup to package `graphqlex` along with your application modules.