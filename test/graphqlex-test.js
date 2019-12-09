require = require("esm")(module)

const { gql, Api } = require("./graphqlex")
const fetchMock = require("fetch-mock")

require("chai").should()

describe("Module: graphqlx, Class: Api", () => {

  describe("Class: Api", () => {
    const httpUrl = "http://myhost:123/api"
    const wsUrl = "ws://myhost:123/api"

    it("has a constructor which takes two URLS and stores them on the object", () => {
      const api = new Api(httpUrl, wsUrl)

      api.should.have.property("url").which.equals(httpUrl)
      api.should.have.property("wsUrl").which.equals(wsUrl)
    })

    it("derives the websockets URL from the http URL if not provided", () => {
      const api = new Api(httpUrl)

      api.should.have.property("url").which.equals(httpUrl)
      api.should.have.property("wsUrl").which.equals(wsUrl)
    })

    describe("Method: exec", () => {

      it("returns data for a query", async () => {
        fetchMock.post("*", { data: { allPosts: { nodes: [ { headline: "Headline 1"} ] } } })

        const api = new Api(httpUrl)
        const response = await api.run(gql`
          query { allPosts ( offset: 0 ) { nodes { headline }}}
        `)
        response.should.have.property("allPosts")
        response.allPosts.should.have.property("nodes")
        response.allPosts.nodes.should.be.an("array").with.length(1)
        response.allPosts.nodes[0].should.have.property("headline").which.equals("Headline 1")
      })
    })
  })

})